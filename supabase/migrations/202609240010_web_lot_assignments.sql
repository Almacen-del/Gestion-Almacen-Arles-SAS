begin;
create table public.web_entry_lot_totals(movement_id text primary key,quantity_milli bigint not null check(quantity_milli>=0),original_fields jsonb not null default '{}');
create table public.web_lot_links(request_id uuid primary key references public.web_admin_writes(request_id),position_id uuid not null references public.stock_positions(id),movement_id text,quantity_milli bigint not null check(quantity_milli>0),received_at date not null);
alter table public.web_entry_lot_totals enable row level security;
alter table public.web_entry_lot_totals force row level security;
alter table public.web_lot_links enable row level security;
alter table public.web_lot_links force row level security;
revoke all on public.web_entry_lot_totals,public.web_lot_links from public,anon,authenticated;
-- Preserve previously assigned receipts, including assignments whose original
-- lot was explicitly left pending because its date was a demonstration.
insert into public.web_entry_lot_totals
select 'legacy:movimientos/'||(f#>>'{entrada_id,stringValue}'),
 (coalesce(f#>>'{cantidad_asignada,integerValue}',f#>>'{cantidad_asignada,doubleValue}')::numeric*1000)::bigint,f
from (select source_document->'fields' f from public.legacy_agroquimicos_documents where source_path like '%/asignaciones_entradas_agroquimicos/%')d;

create function public.web_assign_agro_lot(p_request_id uuid,p_product_id uuid,p_location text,p_existing_position uuid,p_lot text,p_expiration text,p_quantity_milli bigint,p_received_at date,p_entry_id text,p_link_only boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.web_admin_writes; payload jsonb; result jsonb; original jsonb; product public.products;
 target public.stock_positions; unassigned public.stock_positions; lot public.lots; expiry date; yr smallint;mo smallint;dy smallint; entry jsonb; assigned bigint; before_total numeric;
begin
 perform public.web_require_access(true);
 if not coalesce((select operational from public.web_settings where singleton),false) then raise exception 'Modo revisión';end if;
 if p_request_id is null or p_quantity_milli is null or p_quantity_milli not between 1 and 999999999999
 or p_link_only is null or p_received_at is null or length(trim(p_lot)) not between 1 and 100
 or p_expiration is null or p_expiration !~ '^[0-9]{4}-(0[1-9]|1[0-2])(-[0-9]{2})?$' then raise exception 'Datos de lote inválidos';end if;
 yr:=split_part(p_expiration,'-',1)::smallint;mo:=split_part(p_expiration,'-',2)::smallint;
 dy:=nullif(split_part(p_expiration,'-',3),'')::smallint;expiry:=make_date(yr,mo,coalesce(dy,1));
 payload:=jsonb_build_object('product',p_product_id,'location',p_location,'position',p_existing_position,'lot',p_lot,'expiration',p_expiration,'quantity',p_quantity_milli,'received',p_received_at,'entry',p_entry_id,'link',p_link_only);
 perform pg_advisory_xact_lock(hashtextextended('web-admin-request:'||p_request_id,0));
 select * into prior from public.web_admin_writes where request_id=p_request_id;
 if found then if prior.actor<>auth.uid() or prior.kind<>'LOT' or prior.payload<>payload then raise exception 'Solicitud reutilizada';end if;return prior.result;end if;
 select * into product from public.products where id=p_product_id and active and module_id='AGROQUIMICOS' for update;
 if not found then raise exception 'Producto no encontrado';end if;
 perform 1 from public.stock_positions where product_id=p_product_id order by id for update;
 if not exists(select 1 from public.stock_positions where product_id=p_product_id and location_code=p_location) then raise exception 'La bodega cambió; actualiza';end if;
 select sum(quantity_milli),jsonb_agg(to_jsonb(s) order by id) into before_total,original from public.stock_positions s where product_id=p_product_id and location_code=p_location;
 if p_entry_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('web-lot-entry:'||p_entry_id,0));
  select e into entry from jsonb_array_elements(public.web_entry_catalog())e where e->>'id'=p_entry_id;
  if entry is null or entry->>'module_id'<>'AGROQUIMICOS' or entry->>'valuation_id'<>(select public.web_valuation_key('POSITION',id) from public.stock_positions where product_id=p_product_id and location_code=p_location limit 1) then raise exception 'Entrada no vinculada al producto';end if;
  select coalesce(quantity_milli,0) into assigned from public.web_entry_lot_totals where movement_id=p_entry_id;
  if (entry->>'quantity')::numeric*1000<coalesce(assigned,0)+p_quantity_milli then raise exception 'La cantidad supera el pendiente de la entrada';end if;
 end if;
 if p_existing_position is not null then
  select * into target from public.stock_positions where id=p_existing_position and product_id=p_product_id and location_code=p_location and lot_id is not null;
  if not found then raise exception 'Lote existente no encontrado';end if;
  select * into lot from public.lots where id=target.lot_id;
  if lot.code<>trim(p_lot) or lot.expiry_year<>yr or lot.expiry_month<>mo or lot.expiry_day is distinct from dy then raise exception 'El lote o vencimiento cambió';end if;
 else
  if p_link_only then raise exception 'Selecciona el lote y la entrada para vincular';end if;
  insert into public.lots(product_id,code,expiry_year,expiry_month,expiry_day)values(p_product_id,trim(p_lot),yr,mo,dy)
   on conflict(product_id,code,expiry_year,expiry_month,expiry_day)do nothing;
  select * into lot from public.lots where product_id=p_product_id and code=trim(p_lot) and expiry_year=yr and expiry_month=mo and expiry_day is not distinct from dy;
  insert into public.stock_positions(product_id,lot_id,location_code)values(p_product_id,lot.id,p_location)on conflict(product_id,lot_id,location_code)do nothing;
  select * into target from public.stock_positions where product_id=p_product_id and lot_id=lot.id and location_code=p_location;
 end if;
 if p_link_only then
  if p_entry_id is null then raise exception 'Selecciona la entrada';end if;
 else
  select * into unassigned from public.stock_positions where product_id=p_product_id and location_code=p_location and lot_id is null;
  if unassigned.id is null or unassigned.quantity_milli<p_quantity_milli then raise exception 'La cantidad supera el saldo sin lote; no se aumenta el inventario';end if;
  update public.stock_positions set quantity_milli=quantity_milli-p_quantity_milli,revision=revision+1,updated_at=now() where id=unassigned.id;
  update public.stock_positions set quantity_milli=quantity_milli+p_quantity_milli,revision=revision+1,updated_at=now() where id=target.id;
 end if;
 if p_entry_id is not null then insert into public.web_entry_lot_totals(movement_id,quantity_milli)values(p_entry_id,p_quantity_milli)
  on conflict(movement_id)do update set quantity_milli=public.web_entry_lot_totals.quantity_milli+excluded.quantity_milli;end if;
 if before_total<>(select sum(quantity_milli) from public.stock_positions where product_id=p_product_id and location_code=p_location) then raise exception 'No se conservó el saldo';end if;
 result:=jsonb_build_object('operationId',p_request_id,'productDocumentId',p_product_id::text||':'||p_location,'lotId',target.id,'quantityLinked',p_quantity_milli::numeric/1000);
 insert into public.web_admin_writes values(p_request_id,auth.uid(),'LOT',payload,original,result,now());
 insert into public.web_lot_links values(p_request_id,target.id,p_entry_id,p_quantity_milli,p_received_at);
 return result;
end $$;
revoke all on function public.web_assign_agro_lot(uuid,uuid,text,uuid,text,text,bigint,date,text,boolean) from public,anon;
grant execute on function public.web_assign_agro_lot(uuid,uuid,text,uuid,text,text,bigint,date,text,boolean) to authenticated;
commit;

begin;
create table public.web_entry_valuations(
 movement_id text primary key,valuation_id text not null,entry_unit_value numeric not null check(entry_unit_value>=0),
 previous_average numeric not null check(previous_average>=0),new_average numeric not null check(new_average>=0),
 valued_at timestamptz,actor uuid references auth.users(id),original_fields jsonb not null default '{}'
);
alter table public.web_entry_valuations enable row level security;
alter table public.web_entry_valuations force row level security;
revoke all on public.web_entry_valuations from public,anon,authenticated;
insert into public.web_entry_valuations(movement_id,valuation_id,entry_unit_value,previous_average,new_average,valued_at,original_fields)
select 'legacy:movimientos/'||split_part(a.path,'/',2),f#>>'{valoracion_id,stringValue}',
 coalesce(f#>>'{valor_unitario_entrada,doubleValue}',f#>>'{valor_unitario_entrada,integerValue}')::numeric,
 coalesce(f#>>'{promedio_anterior,doubleValue}',f#>>'{promedio_anterior,integerValue}')::numeric,
 coalesce(f#>>'{promedio_nuevo,doubleValue}',f#>>'{promedio_nuevo,integerValue}')::numeric,
 (f#>>'{valorado_en,timestampValue}')::timestamptz,f
from public.web_admin_archive a join public.web_settings s using(source_hash)
cross join lateral(select a.raw_document::jsonb->'fields' f) d
where a.path like 'valoraciones_entradas/%';

create function public.web_entry_catalog() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 return coalesce((with historic as (
  select 'legacy:'||h.source_path id,
   case when h.module_id='ASEO' then 'productos_aseo__' else 'existencias__' end || coalesce(f#>>'{producto_id,stringValue}',f#>>'{documento_id,stringValue}') valuation_id,
   h.module_id,h.display_code code,h.product_name name,h.reference,h.unit_original unit,
   (f#>>'{creado_en,timestampValue}')::timestamptz created_at,
   coalesce(f#>>'{cantidad,doubleValue}',f#>>'{cantidad,integerValue}')::numeric quantity,
   coalesce(f#>>'{stock_anterior,doubleValue}',f#>>'{stock_anterior,integerValue}')::numeric previous_stock,
   coalesce(f#>>'{stock_nuevo,doubleValue}',f#>>'{stock_nuevo,integerValue}')::numeric new_stock
  from (select h.*,coalesce(p.code,h.source_code) display_code from public.historical_movements h left join public.products p on p.id=h.product_id) h
  join public.legacy_history_stage stage using(source_path)
  cross join lateral(select stage.source_json::jsonb->'fields' f) d
  where h.source_path like 'movimientos/%' and f#>>'{clase_movimiento,stringValue}'='entrada_stock'
   and translate(lower(concat_ws(' ',f#>>'{tipoMovimiento,stringValue}',f#>>'{tipo,stringValue}',f#>>'{clase,stringValue}',f#>>'{origen_movimiento,stringValue}')),'ó','o') !~ '(salida|devolucion|retorno|traslado)'
   and translate(lower(coalesce(f#>>'{observaciones,stringValue}','')),'ó','o') !~ '^(devolucion|retorno|traslado)( |:|$)'
   and not (coalesce(f#>>'{es_devolucion,booleanValue}','false')::boolean or coalesce(f#>>'{es_retorno,booleanValue}','false')::boolean or coalesce(f#>>'{es_traslado,booleanValue}','false')::boolean or coalesce(f#>>'{movimiento_entre_ubicaciones,booleanValue}','false')::boolean)
   and not (coalesce(f#>>'{ubicacion_origen,stringValue}','')<>'' and coalesce(f#>>'{ubicacion_destino,stringValue}','')<>'')
 ), current_entries as (
  select 'warehouse:'||m.id id,public.web_valuation_key('POSITION',s.id) valuation_id,p.module_id,p.code,p.name,p.reference,p.unit_id unit,
   m.confirmed_at created_at,m.quantity_milli::numeric/1000 quantity,
   (balance.amount-later.amount-m.quantity_milli)::numeric/1000 previous_stock,
   (balance.amount-later.amount)::numeric/1000 new_stock
  from public.movements m join public.stock_positions s on s.id=m.stock_position_id join public.products p on p.id=s.product_id
  cross join lateral(select coalesce(sum(quantity_milli),0) amount from public.stock_positions where product_id=s.product_id and location_code=s.location_code) balance
  cross join lateral(select coalesce(sum(case when n.kind='ENTRADA' then n.quantity_milli else -n.quantity_milli end),0) amount
   from public.movements n join public.stock_positions ns on ns.id=n.stock_position_id
   where ns.product_id=s.product_id and ns.location_code=s.location_code and (n.confirmed_at,n.id)>(m.confirmed_at,m.id)) later
  where m.kind='ENTRADA' and p.active
 ) select jsonb_agg(to_jsonb(r) order by r.created_at nulls first,r.id) from (select * from historic union all select * from current_entries) r),'[]'::jsonb);
end $$;
revoke all on function public.web_entry_catalog() from public,anon;
grant execute on function public.web_entry_catalog() to authenticated;

create function public.web_entry_values() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 return coalesce((select jsonb_agg(to_jsonb(r) order by movement_id) from
  (select movement_id,valuation_id,entry_unit_value,previous_average,new_average,valued_at from public.web_entry_valuations)r),'[]'::jsonb);
end $$;
revoke all on function public.web_entry_values() from public,anon;
grant execute on function public.web_entry_values() to authenticated;

create function public.web_save_entry_value(p_request_id uuid,p_movement_id text,p_expected_revision bigint,p_unit_value numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.web_profiles; request jsonb; prior public.web_valuation_writes; entry jsonb; entries jsonb;
 value public.web_valuations; old_average numeric; average numeric; result jsonb; entry_id text;
begin
 profile:=public.web_require_access(true);
 if not coalesce((select operational from public.web_settings where singleton),false) then raise exception 'Modo revisión'; end if;
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_unit_value is null or p_unit_value::text in ('NaN','Infinity','-Infinity') or p_unit_value<0 or p_unit_value>999999999999 then raise exception 'Valor no válido'; end if;
 request:=jsonb_build_object('kind','ENTRY','movement_id',p_movement_id,'revision',p_expected_revision,'value',p_unit_value);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into prior from public.web_valuation_writes where request_id=p_request_id;
 if found then
  if prior.actor<>auth.uid() or prior.payload<>request then raise exception 'Solicitud reutilizada con otros datos'; end if;
  return prior.result;
 end if;
 entries:=public.web_entry_catalog();
 select x into entry from jsonb_array_elements(entries)x where x->>'id'=p_movement_id;
 if entry is null or entry->>'valuation_id' is null then raise exception 'Entrada no identificada'; end if;
 entry_id:=entry->>'valuation_id';
 perform pg_advisory_xact_lock(hashtextextended(entry_id,1));
 if exists(select 1 from public.web_entry_valuations where movement_id=p_movement_id) then raise exception 'La entrada ya fue valorada'; end if;
 if entry->>'created_at' is null or entry->>'quantity' is null or entry->>'previous_stock' is null or entry->>'new_stock' is null
  or (entry->>'quantity')::numeric<=0 or (entry->>'previous_stock')::numeric<0
  or abs((entry->>'new_stock')::numeric-(entry->>'previous_stock')::numeric-(entry->>'quantity')::numeric)>0.000001 then raise exception 'Saldos de entrada no verificables'; end if;
 if exists(select 1 from jsonb_array_elements(entries)x where x->>'valuation_id'=entry_id and x->>'id'<>p_movement_id
  and (x->>'created_at' is null or ((x->>'created_at')::timestamptz,x->>'id')<((entry->>'created_at')::timestamptz,p_movement_id))
  and not exists(select 1 from public.web_entry_valuations v where v.movement_id=x->>'id')) then raise exception 'Primero valora la entrada anterior'; end if;
 select * into value from public.web_valuations where id=entry_id for update;
 if coalesce(value.revision,0)<>p_expected_revision then raise exception 'El promedio cambió. Actualiza antes de valorar.'; end if;
 if (entry->>'previous_stock')::numeric>0 and value.unit_value is null then raise exception 'Falta el promedio base'; end if;
 old_average:=case when (entry->>'previous_stock')::numeric=0 then 0 else value.unit_value end;
 average:=((entry->>'previous_stock')::numeric*old_average+(entry->>'quantity')::numeric*p_unit_value)/(entry->>'new_stock')::numeric;
 insert into public.web_valuations(id,unit_value,revision,updated_at,updated_by,updated_by_uid,origin)
 values(entry_id,average,1,now(),profile.display_name,auth.uid()::text,'entrada_stock')
 on conflict(id) do update set unit_value=excluded.unit_value,revision=web_valuations.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_uid=excluded.updated_by_uid,origin=excluded.origin;
 insert into public.web_entry_valuations(movement_id,valuation_id,entry_unit_value,previous_average,new_average,valued_at,actor)
 values(p_movement_id,entry_id,p_unit_value,old_average,average,now(),auth.uid());
 result:=jsonb_build_object('previousAverage',old_average,'newAverage',average);
 insert into public.web_valuation_writes(request_id,actor,payload,result)values(p_request_id,auth.uid(),request,result);
 insert into public.web_valuation_audit(request_id,valuation_id,actor,before_value,after_value,before_revision,after_revision)
 values(p_request_id,entry_id,auth.uid(),value.unit_value,average,coalesce(value.revision,0),coalesce(value.revision,0)+1);
 return result;
end $$;
revoke all on function public.web_save_entry_value(uuid,text,bigint,numeric) from public,anon;
grant execute on function public.web_save_entry_value(uuid,text,bigint,numeric) to authenticated;
commit;

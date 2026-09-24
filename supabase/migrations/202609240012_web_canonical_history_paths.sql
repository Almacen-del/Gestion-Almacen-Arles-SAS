begin;
create or replace function public.web_entry_catalog() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 return coalesce((with historic as (
  select 'legacy:movimientos/'||regexp_replace(h.source_path,'^.*/','') id,
   case when h.module_id='ASEO' then 'productos_aseo__' else 'existencias__' end || coalesce(f#>>'{producto_id,stringValue}',f#>>'{documento_id,stringValue}') valuation_id,
   h.module_id,h.display_code code,h.product_name name,h.reference,h.unit_original unit,
   (f#>>'{creado_en,timestampValue}')::timestamptz created_at,
   coalesce(f#>>'{cantidad,doubleValue}',f#>>'{cantidad,integerValue}')::numeric quantity,
   coalesce(f#>>'{stock_anterior,doubleValue}',f#>>'{stock_anterior,integerValue}')::numeric previous_stock,
   coalesce(f#>>'{stock_nuevo,doubleValue}',f#>>'{stock_nuevo,integerValue}')::numeric new_stock
  from (select h.*,coalesce(p.code,h.source_code) display_code from public.historical_movements h left join public.products p on p.id=h.product_id) h
  join public.legacy_history_stage stage using(source_path)
  cross join lateral(select stage.source_json::jsonb->'fields' f) d
  where h.source_path ~ '(^|/documents/)movimientos/[^/]+$' and f#>>'{clase_movimiento,stringValue}'='entrada_stock'
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


commit;

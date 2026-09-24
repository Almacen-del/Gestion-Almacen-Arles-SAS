begin;
create table public.web_monthly_closes(
 period text primary key check(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 request_id uuid unique not null, actor uuid not null references auth.users(id),
 fingerprint text not null, payload jsonb not null, documents jsonb not null,
 result jsonb not null, created_at timestamptz not null default now()
);
alter table public.web_monthly_closes enable row level security;
alter table public.web_monthly_closes force row level security;
revoke all on public.web_monthly_closes from public,anon,authenticated;

create function public.web_monthly_basis() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; entries jsonb; values jsonb; basis jsonb;
begin
 perform public.web_require_access(false);
 snapshot:=public.web_panel_snapshot();entries:=public.web_entry_catalog();values:=public.web_entry_values();
 basis:=jsonb_build_object('snapshot',snapshot-'read_at','entries',entries,'values',values);
 return jsonb_build_object('snapshot',snapshot,'entries',entries,'values',values,'fingerprint',md5(basis::text));
end $$;

create function public.web_save_monthly_close(p_request_id uuid,p_period text,p_fingerprint text,p_confirmation text,p_items jsonb,p_activity jsonb,p_reconstruction jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.web_profiles; current_period text; basis jsonb; prior public.web_monthly_closes;
 payload jsonb; docs jsonb; item jsonb; total numeric; valued integer; counts integer;
 summary jsonb; activity_meta jsonb; modules jsonb; response jsonb; instant timestamptz:=statement_timestamp();
begin
 profile:=public.web_require_access(true);
 if not coalesce((select operational from public.web_settings where singleton),false) then raise exception 'Modo revisión: guardado deshabilitado'; end if;
 if p_request_id is null or p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido'; end if;
 perform pg_advisory_xact_lock(hashtextextended('web-monthly:'||p_period,0));
 payload:=jsonb_build_object('period',p_period,'fingerprint',p_fingerprint,'confirmation',p_confirmation,'items',p_items,'activity',p_activity,'reconstruction',p_reconstruction);
 select * into prior from public.web_monthly_closes where request_id=p_request_id;
 if found then
  if prior.actor<>auth.uid() or prior.payload<>payload then raise exception 'Solicitud reutilizada con otros datos'; end if;
  return prior.result;
 end if;
 if exists(select 1 from public.web_monthly_closes where period=p_period)
 or exists(select 1 from public.web_admin_archive a join public.web_settings s using(source_hash)
 where a.path='cierres_valoracion_inventario/'||p_period) then raise exception 'El mes ya tiene un cierre; no se sobrescribe'; end if;
 current_period:=to_char(instant at time zone 'America/Bogota','YYYY-MM');
 if p_reconstruction is null then
  if p_period<>current_period then raise exception 'Solo se puede cerrar el mes actual'; end if;
  if (instant at time zone 'America/Bogota')::date<>(date_trunc('month',instant at time zone 'America/Bogota')+interval '1 month - 1 day')::date
   and p_confirmation is distinct from 'CERRAR '||p_period then raise exception 'Confirma el cierre anticipado'; end if;
 else
  if p_period>=current_period or p_confirmation is distinct from 'RECONSTRUIR '||p_period then raise exception 'Confirma la reconstrucción histórica'; end if;
 end if;
 basis:=public.web_monthly_basis();
 if p_fingerprint is distinct from basis->>'fingerprint' then raise exception 'El inventario cambió; actualiza antes de cerrar'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0
 or jsonb_typeof(p_activity->'rows') is distinct from 'array' or p_activity->>'period' is distinct from p_period
 or (p_activity->>'invalidDateCount')::integer<>0 or (p_activity->>'invalidQuantityCount')::integer<>0 then raise exception 'Detalle mensual incompleto'; end if;
 if exists(select 1 from jsonb_array_elements(basis->'entries') e where not exists(
  select 1 from jsonb_array_elements(basis->'values') v where v->>'movement_id'=e->>'id')) then raise exception 'Existen entradas pendientes de valorar'; end if;
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct x->>'valuationId') from jsonb_array_elements(p_items) x) then raise exception 'Productos repetidos'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if coalesce(item->>'valuationId','')='' or jsonb_typeof(item->'quantity') is distinct from 'number'
  or jsonb_typeof(item->'unitValue') is distinct from 'number' or jsonb_typeof(item->'totalValue') is distinct from 'number'
  or (item->>'quantity')::numeric<0 or (item->>'unitValue')::numeric<0
  or ((item->>'quantity')::numeric>0 and (item->>'unitValue')::numeric=0)
  or abs((item->>'totalValue')::numeric-(item->>'quantity')::numeric*(item->>'unitValue')::numeric)>.00001
  then raise exception 'Cantidad o valoración mensual inválida'; end if;
  if not exists(select 1 from public.web_valuations v where v.id=item->>'valuationId' and v.unit_value=(item->>'unitValue')::numeric)
  then raise exception 'La valoración mensual no coincide con el precio vigente'; end if;
 end loop;
 -- Current closes must contain exactly the server's active warehouse products.
 if p_reconstruction is null and exists(
  with expected as (select x->>'valuation_id' id,sum((x->>'quantity_milli')::numeric)/1000 quantity
    from jsonb_array_elements(basis#>'{snapshot,positions}') x group by x->>'valuation_id'),
  submitted as (select x->>'valuationId' id,(x->>'quantity')::numeric quantity from jsonb_array_elements(p_items) x)
  select 1 from expected e full join submitted s using(id) where e.id is null or s.id is null or e.quantity<>s.quantity
 ) then raise exception 'Los productos no coinciden con el inventario confirmado'; end if;
 if (select count(*) from jsonb_array_elements(p_activity->'rows'))<>(select count(distinct x->>'id') from jsonb_array_elements(p_activity->'rows') x)
 then raise exception 'Movimientos mensuales repetidos'; end if;
 select sum((x->>'totalValue')::numeric),count(*),count(*)filter(where (x->>'unitValue')::numeric>0)
 into total,counts,valued from jsonb_array_elements(p_items) x;
 select jsonb_object_agg(module,amount) into modules from (select x->>'moduleName' module,sum((x->>'totalValue')::numeric) amount from jsonb_array_elements(p_items) x group by x->>'moduleName') t;
 activity_meta:=(p_activity-'rows')||jsonb_build_object('version',1,'movementCount',jsonb_array_length(p_activity->'rows'),'estimatedExpense',coalesce((select sum((x->>'expense')::numeric) from jsonb_array_elements(p_activity->'rows') x),0));
 summary:=jsonb_build_object('estado','completo','fecha',instant,'usuario',profile.display_name,'usuario_uid',auth.uid(),'intento_id',p_request_id,
 'resumen',jsonb_build_object('valor_total',total,'cantidad_productos',counts,'productos_con_valor',valued,'productos_sin_valor',counts-valued,'porcentaje_valorado',valued::numeric*100/counts,'totales_modulo',modules),'actividad',activity_meta);
 if p_reconstruction is not null then summary:=summary||jsonb_build_object('reconstruccion',p_reconstruction); end if;
 docs:=jsonb_build_array(jsonb_build_object('path','cierres_valoracion_inventario/'||p_period,'format','plain','fields',summary));
 docs:=docs||coalesce((select jsonb_agg(jsonb_build_object('path','cierres_valoracion_inventario/'||p_period||'/items/'||(x->>'valuationId'),'format','plain','fields',jsonb_build_object('modulo',x->>'moduleName','codigo',x->>'code','referencia',x->>'reference','producto',x->>'product','cantidad',x->'quantity','unidad',x->>'unit','valor_unitario',x->'unitValue','valor_total',x->'totalValue'))) from jsonb_array_elements(p_items) x),'[]');
 docs:=docs||coalesce((select jsonb_agg(jsonb_build_object('path','cierres_valoracion_inventario/'||p_period||'/movimientos/'||(x->>'id'),'format','plain','fields',jsonb_build_object('detalle',x))) from jsonb_array_elements(p_activity->'rows') x),'[]');
 response:=jsonb_build_object('completedAt',instant,'itemCount',counts,'totalValue',total);
 insert into public.web_monthly_closes values(p_period,p_request_id,auth.uid(),p_fingerprint,payload,docs,response,instant);
 return response;
end $$;

create or replace function public.web_monthly_archive(p_period text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 if p_period is not null and p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido'; end if;
 return coalesce((select jsonb_agg(document order by document->>'path') from (
 select jsonb_build_object('path',a.path,'fields',a.raw_document::jsonb->'fields') document from public.web_admin_archive a join public.web_settings s using(source_hash)
 where (p_period is null and a.path ~ '^cierres_valoracion_inventario/[^/]+$') or (p_period is not null and a.path like 'cierres_valoracion_inventario/'||p_period||'/%')
 union all select d from public.web_monthly_closes c cross join lateral jsonb_array_elements(c.documents) d
 where (p_period is null and d->>'path'='cierres_valoracion_inventario/'||c.period) or (p_period=c.period and d->>'path'<>'cierres_valoracion_inventario/'||c.period)
 ) all_docs),'[]'::jsonb);
end $$;
revoke all on function public.web_monthly_basis(),public.web_save_monthly_close(uuid,text,text,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.web_monthly_basis(),public.web_save_monthly_close(uuid,text,text,text,jsonb,jsonb,jsonb) to authenticated;
commit;

begin;
create function public.web_monthly_archive(p_period text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 if p_period is not null and p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mes no válido'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('path',a.path,'fields',a.raw_document::jsonb->'fields') order by a.path)
  from public.web_admin_archive a join public.web_settings s using(source_hash)
  where (p_period is null and a.path ~ '^cierres_valoracion_inventario/[^/]+$')
   or (p_period is not null and a.path like 'cierres_valoracion_inventario/'||p_period||'/%')),'[]'::jsonb);
end $$;
revoke all on function public.web_monthly_archive(text) from public,anon;
grant execute on function public.web_monthly_archive(text) to authenticated;
commit;

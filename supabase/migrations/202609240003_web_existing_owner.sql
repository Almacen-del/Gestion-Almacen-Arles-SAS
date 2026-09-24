begin;
-- Preserve the existing web owner's access, verified against both archives and
-- the existing Supabase account. Do not create a user or change mobile roles.
do $$
begin
 if not exists(select 1 from public.web_settings s join public.web_admin_archive a on a.source_hash=s.source_hash
  where a.path='usuarios/2qNXe7FgNYQib0UVG77a1PpFgU52'
  and lower(a.raw_document::jsonb#>>'{fields,email,stringValue}')='almacen@arlessas.com'
  and a.raw_document::jsonb#>>'{fields,activo,booleanValue}'='true')
  or not exists(select 1 from auth.users u join public.operators o on o.user_id=u.id
  where u.id='5799fac7-852e-4261-9717-015a2d287463' and lower(u.email)='almacen@arlessas.com' and o.active)
 then raise exception 'No coincide la identidad autorizada; no se vincula el perfil'; end if;
end $$;
insert into public.web_profiles(user_id,legacy_uid,display_name,role,active)
values('5799fac7-852e-4261-9717-015a2d287463','2qNXe7FgNYQib0UVG77a1PpFgU52','Almacén','ADMIN',true);
commit;

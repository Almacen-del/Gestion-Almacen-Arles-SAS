begin;
-- Web approval does not activate mobile operators.
create or replace function public.web_require_access(p_manage boolean default false) returns public.web_profiles
language plpgsql security definer set search_path='' as $$
declare profile public.web_profiles;
begin
 select * into profile from public.web_profiles where user_id=auth.uid() and active and approved;
 if profile.user_id is null or (p_manage and profile.role not in ('ADMIN','MANAGER')) then raise exception 'Acceso no autorizado' using errcode='42501';end if;
 return profile;
end $$;
do $$declare definition text;begin
 select pg_get_functiondef('public.web_update_profile(uuid,uuid,text,text,text,boolean)'::regprocedure) into definition;
 if position('if p_active then update public.operators set active=true where user_id=p_user_id;end if;' in definition)=0 then raise exception 'Perfil inesperado';end if;
 definition:=replace(definition,'if p_active then update public.operators set active=true where user_id=p_user_id;end if;','');
 execute definition;
end $$;
create function public.web_evidence_access() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.web_profiles where user_id=auth.uid() and active and approved)
$$;
revoke all on function public.web_evidence_access() from public,anon;
grant execute on function public.web_evidence_access() to authenticated;
create policy web_evidence_read on storage.objects for select to authenticated using(bucket_id='movement-evidence' and public.web_evidence_access());
commit;

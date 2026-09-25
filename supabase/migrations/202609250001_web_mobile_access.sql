begin;
create function public.web_update_profile_access(p_request_id uuid,p_user_id uuid,p_role text,p_name text,p_job text,p_active boolean,p_mobile_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.web_profiles; target public.web_profiles; payload jsonb; prior public.web_admin_writes; result jsonb; mobile_before jsonb;
begin
 actor:=public.web_require_access(true);
 if actor.role<>'ADMIN' or not coalesce((select operational from public.web_settings where singleton),false) then raise exception 'Administración no habilitada' using errcode='42501'; end if;
 if p_request_id is null or p_user_id is null or p_role is null or p_name is null or p_job is null or p_role not in ('ADMIN','MANAGER','READER') or p_mobile_active is null or p_active is null or length(trim(p_name)) not between 1 and 160 or length(p_job)>160 then raise exception 'Perfil inválido'; end if;
 if p_user_id=auth.uid() and (not p_active or p_role<>'ADMIN') then raise exception 'No puedes desactivar tu propia administración'; end if;
 payload:=jsonb_build_object('id',p_user_id,'role',p_role,'name',p_name,'job',p_job,'active',p_active,'mobile_active',p_mobile_active);
 perform pg_advisory_xact_lock(hashtextextended('web-admin-request:'||p_request_id,0));
 select * into prior from public.web_admin_writes where request_id=p_request_id;
 if found then if prior.actor<>auth.uid() or prior.payload<>payload or prior.kind<>'PROFILE_ACCESS' then raise exception 'Solicitud reutilizada'; end if;return prior.result;end if;
 select * into target from public.web_profiles where user_id=p_user_id for update;
 if not found then raise exception 'El usuario debe solicitar acceso primero'; end if;
 select to_jsonb(o) into mobile_before from public.operators o where user_id=p_user_id for update;
 update public.web_profiles set display_name=trim(p_name),job_title=p_job,role=p_role,active=p_active,approved=true where user_id=p_user_id;
 -- A web grant never promotes the mobile role to ADMIN.
 insert into public.operators(user_id,display_name,role,active) values(p_user_id,trim(p_name),'OPERATOR',p_mobile_active)
 on conflict(user_id) do update set display_name=excluded.display_name,active=excluded.active;
 result:=jsonb_build_object('user_id',p_user_id,'active',p_active,'role',p_role,'mobile_active',p_mobile_active);
 insert into public.web_admin_writes values(p_request_id,auth.uid(),'PROFILE_ACCESS',payload,jsonb_build_object('web',to_jsonb(target),'mobile',mobile_before),result,now());return result;
end $$;

revoke all on function public.web_update_profile_access(uuid,uuid,text,text,text,boolean,boolean) from public,anon;
grant execute on function public.web_update_profile_access(uuid,uuid,text,text,text,boolean,boolean) to authenticated;
do $$ declare definition text;
begin
 select pg_get_functiondef('public.web_panel_snapshot()'::regprocedure) into definition;
 if position('w.approved,u.email from public.web_profiles w join auth.users u on u.id=w.user_id' in definition)=0 then raise exception 'Unexpected snapshot definition'; end if;
 definition:=replace(definition,'w.approved,u.email from public.web_profiles w join auth.users u on u.id=w.user_id',
 'w.approved,u.email,(u.email_confirmed_at is not null) as email_confirmed,coalesce(o.active,false) as mobile_active,o.role as mobile_role from public.web_profiles w join auth.users u on u.id=w.user_id left join public.operators o on o.user_id=w.user_id');
 execute definition;
end $$;
commit;

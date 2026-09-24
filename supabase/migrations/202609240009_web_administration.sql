begin;
create table public.web_admin_writes(request_id uuid primary key,actor uuid not null references auth.users(id),kind text not null,payload jsonb not null,before_data jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table public.web_admin_writes enable row level security;
alter table public.web_admin_writes force row level security;
revoke all on public.web_admin_writes from public,anon,authenticated;
alter table public.web_profiles add column job_title text not null default '';
alter table public.web_profiles add column approved boolean not null default true;

create function public.web_request_access(p_name text,p_job text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or length(trim(p_name)) not between 1 and 160 or length(p_job)>160
 or not exists(select 1 from auth.users where id=auth.uid() and lower(email) like '%@arlessas.com' and email_confirmed_at is not null)
 then raise exception 'Confirma tu correo corporativo antes de solicitar acceso' using errcode='42501'; end if;
 insert into public.operators(user_id,display_name,role,active)values(auth.uid(),trim(p_name),'OPERATOR',false)on conflict(user_id)do nothing;
 insert into public.web_profiles(user_id,display_name,job_title,role,active,approved)values(auth.uid(),trim(p_name),p_job,'READER',false,false)on conflict(user_id)do nothing;
end $$;

create function public.web_update_profile(p_request_id uuid,p_user_id uuid,p_role text,p_name text,p_job text,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.web_profiles; target public.web_profiles; payload jsonb; prior public.web_admin_writes; result jsonb;
begin
 actor:=public.web_require_access(true);
 if actor.role<>'ADMIN' or not coalesce((select operational from public.web_settings where singleton),false) then raise exception 'Administración no habilitada' using errcode='42501'; end if;
 if p_request_id is null or p_user_id is null or p_role not in ('ADMIN','MANAGER','READER') or p_active is null or length(trim(p_name)) not between 1 and 160 or length(p_job)>160 then raise exception 'Perfil inválido'; end if;
 if p_user_id=auth.uid() and (not p_active or p_role<>'ADMIN') then raise exception 'No puedes desactivar tu propia administración'; end if;
 payload:=jsonb_build_object('id',p_user_id,'role',p_role,'name',p_name,'job',p_job,'active',p_active);
 perform pg_advisory_xact_lock(hashtextextended('web-admin-request:'||p_request_id,0));
 select * into prior from public.web_admin_writes where request_id=p_request_id;
 if found then if prior.actor<>auth.uid() or prior.payload<>payload or prior.kind<>'PROFILE' then raise exception 'Solicitud reutilizada'; end if;return prior.result;end if;
 select * into target from public.web_profiles where user_id=p_user_id for update;
 if not found then raise exception 'El usuario debe solicitar acceso primero'; end if;
 update public.web_profiles set display_name=trim(p_name),job_title=p_job,role=p_role,active=p_active,approved=true where user_id=p_user_id;
 -- A web grant never promotes the mobile role to ADMIN.
 if p_active then update public.operators set active=true where user_id=p_user_id;end if;
 result:=jsonb_build_object('user_id',p_user_id,'active',p_active,'role',p_role);
 insert into public.web_admin_writes values(p_request_id,auth.uid(),'PROFILE',payload,to_jsonb(target),result,now());return result;
end $$;

create function public.web_set_workshop_status(p_request_id uuid,p_asset_id uuid,p_expected_total bigint,p_expected_loaned bigint,p_expected_maintenance bigint,p_maintenance boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target public.workshop_assets; prior public.web_admin_writes; payload jsonb; result jsonb; amount bigint;
begin
 perform public.web_require_access(true);
 if not coalesce((select operational from public.web_settings where singleton),false) then raise exception 'Modo revisión';end if;
 if p_request_id is null or p_maintenance is null then raise exception 'Solicitud inválida';end if;
 payload:=jsonb_build_object('id',p_asset_id,'total',p_expected_total,'loaned',p_expected_loaned,'maintenance',p_expected_maintenance,'next',p_maintenance);
 perform pg_advisory_xact_lock(hashtextextended('web-admin-request:'||p_request_id,0));
 select * into prior from public.web_admin_writes where request_id=p_request_id;
 if found then if prior.actor<>auth.uid() or prior.kind<>'STATUS' or prior.payload<>payload then raise exception 'Solicitud reutilizada';end if;return prior.result;end if;
 select * into target from public.workshop_assets where id=p_asset_id and active for update;
 if not found or target.total_milli is distinct from p_expected_total or target.loaned_milli is distinct from p_expected_loaned or target.maintenance_milli is distinct from p_expected_maintenance then raise exception 'La herramienta cambió; actualiza antes de guardar';end if;
 if p_maintenance and target.loaned_milli>0 then raise exception 'Registra primero la devolución de las unidades prestadas';end if;
 amount:=case when p_maintenance then target.total_milli else 0 end;
 update public.workshop_assets set maintenance_milli=amount where id=p_asset_id;
 result:=jsonb_build_object('asset_id',p_asset_id,'maintenance_milli',amount);
 insert into public.web_admin_writes values(p_request_id,auth.uid(),'STATUS',payload,to_jsonb(target),result,now());return result;
end $$;

create function public.web_change_agro_location(p_request_id uuid,p_product_id uuid,p_expected text,p_location text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.web_admin_writes; payload jsonb; original jsonb; result jsonb; product public.products;
begin
 perform public.web_require_access(true);
 if not coalesce((select operational from public.web_settings where singleton),false) then raise exception 'Modo revisión';end if;
 if p_request_id is null or p_location not in ('BODEGA AZUL','COP','PORTUGUESA') or p_expected is null then raise exception 'Ubicación inválida';end if;
 payload:=jsonb_build_object('id',p_product_id,'expected',p_expected,'location',p_location);
 perform pg_advisory_xact_lock(hashtextextended('web-admin-request:'||p_request_id,0));
 select * into prior from public.web_admin_writes where request_id=p_request_id;
 if found then if prior.actor<>auth.uid() or prior.kind<>'LOCATION' or prior.payload<>payload then raise exception 'Solicitud reutilizada';end if;return prior.result;end if;
 select * into product from public.products where id=p_product_id and module_id='AGROQUIMICOS' and active for update;
 if not found then raise exception 'Agroquímico no encontrado';end if;
 perform 1 from public.stock_positions where product_id=p_product_id order by id for update;
 if not exists(select 1 from public.stock_positions where product_id=p_product_id and location_code=p_expected) then raise exception 'La bodega cambió; actualiza antes de guardar';end if;
 if p_location<>p_expected and exists(select 1 from public.stock_positions where product_id=p_product_id and location_code=p_location) then raise exception 'Ya existe inventario del producto en la bodega destino; requiere un traslado';end if;
 select jsonb_agg(to_jsonb(s) order by id) into original from public.stock_positions s where product_id=p_product_id and location_code=p_expected;
 -- Preserve the location at the time of existing operational movements.
 update public.movements m set details=m.details||jsonb_build_object('location_code',p_expected)
 where not (m.details?'location_code') and m.stock_position_id in(select id from public.stock_positions where product_id=p_product_id and location_code=p_expected);
 update public.stock_positions set location_code=p_location,updated_at=now() where product_id=p_product_id and location_code=p_expected;
 update public.legacy_agroquimicos_mapping set location_code=p_location where product_id=p_product_id and location_code=p_expected;
 result:=jsonb_build_object('location',p_location);
 insert into public.web_admin_writes values(p_request_id,auth.uid(),'LOCATION',payload,original,result,now());return result;
end $$;
revoke all on function public.web_request_access(text,text),public.web_update_profile(uuid,uuid,text,text,text,boolean),public.web_set_workshop_status(uuid,uuid,bigint,bigint,bigint,boolean),public.web_change_agro_location(uuid,uuid,text,text) from public,anon;
grant execute on function public.web_request_access(text,text),public.web_update_profile(uuid,uuid,text,text,text,boolean),public.web_set_workshop_status(uuid,uuid,bigint,bigint,bigint,boolean),public.web_change_agro_location(uuid,uuid,text,text) to authenticated;
commit;

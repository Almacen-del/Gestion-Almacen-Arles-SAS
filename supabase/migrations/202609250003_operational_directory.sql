begin;
create table public.operational_directory(
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('WORKER','MACHINE')),
 code text not null check(length(code) between 1 and 40), name text not null check(length(name) between 1 and 120),
 job text not null default '', machine_type text not null default '', identifier text not null default '',
 meter_unit text not null default '' check(meter_unit in ('','h','km')), fuel text not null default '' check(fuel in ('','ACPM','Gasolina')),
 active boolean not null default true, revision integer not null default 1, updated_at timestamptz not null default now(),
 unique(kind,code),check(length(job)<=120 and length(machine_type)<=80 and length(identifier)<=40),
 check(kind<>'WORKER' or length(job)>0),check(kind<>'MACHINE' or (length(machine_type)>0 and length(identifier)>0))
);
create unique index operational_directory_name on public.operational_directory(kind,lower(name));
alter table public.operational_directory enable row level security;
alter table public.operational_directory force row level security;
revoke all on public.operational_directory from public,anon,authenticated;
create function public.operational_directory_list() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.operators where user_id=auth.uid() and active) and not exists(select 1 from public.web_profiles where user_id=auth.uid() and active and approved) then raise exception 'Acceso no habilitado' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(d) order by d.kind,d.name) from public.operational_directory d),'[]'::jsonb);
end $$;
create function public.operational_directory_save(p_request_id uuid,p_id uuid,p_expected_revision integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.web_profiles; old public.operational_directory; saved public.operational_directory; prior public.web_admin_writes; payload jsonb;
begin
 actor:=public.web_require_access(true);
 if actor.role<>'ADMIN' then raise exception 'Solo administración' using errcode='42501'; end if;
 if p_request_id is null or p_id is null or p_expected_revision is null or p_data is null or jsonb_typeof(p_data)<>'object' or p_data->>'kind' not in ('WORKER','MACHINE') then raise exception 'Datos inválidos'; end if;
 payload:=jsonb_build_object('id',p_id,'revision',p_expected_revision,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended('directory-request:'||p_request_id,0));
 select * into prior from public.web_admin_writes where request_id=p_request_id;
 if found then if prior.actor<>auth.uid() or prior.payload<>payload or prior.kind<>'DIRECTORY_SAVE' then raise exception 'Solicitud reutilizada'; end if;return prior.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('directory-item:'||p_id,0));
 select * into old from public.operational_directory where id=p_id for update;
 if (old.id is null and p_expected_revision<>0) or (old.id is not null and old.revision<>p_expected_revision) then raise exception 'El registro cambió. Actualiza antes de guardar.'; end if;
 if old.id is not null and (old.kind<>p_data->>'kind' or old.code<>upper(trim(p_data->>'code'))) then raise exception 'El tipo y código son permanentes'; end if;
 insert into public.operational_directory(id,kind,code,name,job,machine_type,identifier,meter_unit,fuel,active,revision)
 values(p_id,p_data->>'kind',upper(trim(p_data->>'code')),trim(p_data->>'name'),trim(coalesce(p_data->>'job','')),trim(coalesce(p_data->>'machine_type','')),trim(coalesce(p_data->>'identifier','')),coalesce(p_data->>'meter_unit',''),coalesce(p_data->>'fuel',''),coalesce((p_data->>'active')::boolean,true),coalesce(old.revision,0)+1)
 on conflict(id) do update set name=excluded.name,job=excluded.job,machine_type=excluded.machine_type,identifier=excluded.identifier,meter_unit=excluded.meter_unit,fuel=excluded.fuel,active=excluded.active,revision=excluded.revision,updated_at=now() returning * into saved;
 insert into public.web_admin_writes(request_id,actor,kind,payload,before_data,result) values(p_request_id,auth.uid(),'DIRECTORY_SAVE',payload,coalesce(to_jsonb(old),'{}'::jsonb),to_jsonb(saved));return to_jsonb(saved);
end $$;
revoke all on function public.operational_directory_list() from public,anon;
revoke all on function public.operational_directory_save(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.operational_directory_list() to authenticated;
grant execute on function public.operational_directory_save(uuid,uuid,integer,jsonb) to authenticated;
insert into public.operational_directory(kind,code,name,machine_type,identifier,meter_unit,fuel) values
('MACHINE','CAM221','Camioneta blanca 221','Camioneta','221','km','ACPM'),
('MACHINE','MOTO21G','Moto 21G','Moto','21G','km','Gasolina'),('MACHINE','MOTO32H','Moto 32H','Moto','32H','km','Gasolina'),('MACHINE','MOTO46H','Moto 46H','Moto','46H','km','Gasolina'),
('MACHINE','TRACTOR1','Tractor 1','Tractor','1','h','ACPM'),('MACHINE','TRACTOR3','Tractor 3','Tractor','3','h','ACPM'),('MACHINE','PLANTAROJA','Planta roja','Planta','Roja','h','ACPM');
insert into public.operational_directory(kind,code,name,job) values
('WORKER','W001','DANNY FERNEY CASTELLANOS','OPERADOR DE TRACTOR'),('WORKER','W002','DENNYS TATIANA BASTIDAS RUBIO','ASISTENTE DE VIVERO'),
('WORKER','W003','ELIO ENAI LOZADA FULA','JEFE DE CAMPO'),('WORKER','W004','FABIAN CONTRERAS','AUXILIAR DE CAMPO'),
('WORKER','W005','FABIO MORENO','DIR. SIEMBRAS NUEVAS'),('WORKER','W006','FERNEY GOMEZ GOMEZ','AUXILIAR DE CAMPO'),
('WORKER','W007','GUSTAVO DOMINGO PEREZ RODRIGUEZ','AUXILIAR DE CAMPO'),('WORKER','W008','HARBEY TORRES','AUXILIAR DE CAMPO'),
('WORKER','W009','JEFER DUVAN CASTELLANO','JEFE DE TALLER'),('WORKER','W010','JUAN FELIPE ESTRADA FALLA','AUXILIAR DE CAMPO'),
('WORKER','W011','LIZANDRO ARBOLEDA','AUXILIAR DE CAMPO'),('WORKER','W012','LUIS ENRIQUE SALCEDO','OPERADOR DE TRACTOR'),
('WORKER','W013','OSCAR MORENO','DIR. SIEMBRAS NUEVAS'),('WORKER','W014','RAFAEL FRANCO CUESTA','AUXILIAR DE CAMPO'),
('WORKER','W015','REINALDO FERLEY SOSA GAITAN','AUXILIAR DE CAMPO'),('WORKER','W016','REIVER ANDRES CALDERON','JEFE DE CAMPO'),
('WORKER','W017','ROGER ESNEIDER CALDERON','GESTOR DE SANIDAD'),('WORKER','W018','UBER ANTONIO VELAZQUEZ SUARES','AUXILIAR DE CAMPO'),
('WORKER','W019','WEIMAR IBARRA','AUXILIAR DE CAMPO'),('WORKER','W020','WILSON EDUARDO CARRILLO','AUXILIAR DE CAMPO'),
('WORKER','W021','YEILER AVILORIO','AUXILIAR DE CAMPO');
-- Extend only the allowed snapshot keys; existing queued movements remain compatible.
do $$ declare definition text; target text; old text;
begin
 for target,old in select * from (values
 ('public.register_warehouse_movement(uuid,uuid,bigint,uuid,text,bigint,timestamp with time zone,jsonb)', $keys$('supplier','document','recipient','machine','plate','meter','destination','task','position','notes','evidence_path')$keys$),
 ('public.register_warehouse_exit_batch(uuid,uuid,bigint,text,jsonb,timestamp with time zone,jsonb)', $keys$('recipient','destination','position','notes','evidence_path')$keys$)) as patches(signature,pattern)
 loop
  select pg_get_functiondef(target::regprocedure) into definition;
  if position(old in definition)=0 then raise exception 'Unexpected register function %',target; end if;
  definition:=replace(definition,old,left(old,length(old)-1)||$keys$,'worker_id','machine_id','machine_name','meter_unit')$keys$);
  execute definition;
 end loop;
end $$;
commit;

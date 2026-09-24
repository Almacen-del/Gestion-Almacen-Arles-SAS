begin;
create table public.web_settings (
 singleton boolean primary key default true check(singleton),
 operational boolean not null default false,
 source_hash text not null references public.web_admin_imports(source_hash)
);
create table public.web_profiles (
 user_id uuid primary key references auth.users(id),
 legacy_uid text unique,
 display_name text not null,
 role text not null check(role in ('ADMIN','MANAGER','READER')),
 active boolean not null default false
);
create table public.web_valuations (
 id text primary key,
 legacy_collection text,
 legacy_id text,
 unit_value numeric check(unit_value>=0 and unit_value<=999999999999),
 revision bigint not null default 1 check(revision>0),
 original_fields jsonb not null default '{}',
 updated_at timestamptz,
 updated_by text not null default '',
 updated_by_uid text not null default '',
 origin text not null default '',
 unique(legacy_collection,legacy_id)
);
create table public.web_valuation_writes (
 request_id uuid primary key,
 actor uuid not null references auth.users(id),
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now()
);
create table public.web_valuation_audit (
 request_id uuid primary key references public.web_valuation_writes(request_id),
 valuation_id text not null references public.web_valuations(id),
 actor uuid not null references auth.users(id),
 before_value numeric,
 after_value numeric not null,
 before_revision bigint not null,
 after_revision bigint not null,
 created_at timestamptz not null default now()
);
alter table public.web_settings enable row level security;
alter table public.web_settings force row level security;
alter table public.web_profiles enable row level security;
alter table public.web_profiles force row level security;
alter table public.web_valuations enable row level security;
alter table public.web_valuations force row level security;
alter table public.web_valuation_writes enable row level security;
alter table public.web_valuation_writes force row level security;
alter table public.web_valuation_audit enable row level security;
alter table public.web_valuation_audit force row level security;
revoke all on public.web_settings,public.web_profiles,public.web_valuations,public.web_valuation_writes,public.web_valuation_audit from public,anon,authenticated;

-- Called only by the administrator to promote one verified archive. No passwords,
-- accounts, inventory, movements or workshop settings are modified.
create function public.web_import_valuations(p_source_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from public.web_admin_imports where source_hash=p_source_hash and verified_at is not null) then raise exception 'Verifica primero el archivo'; end if;
 if exists(select 1 from public.web_settings) or exists(select 1 from public.web_valuations) then raise exception 'La preparación ya existe; no se sobrescriben valoraciones'; end if;
 if exists(select 1 from public.web_admin_archive where source_hash=p_source_hash and path like 'valoraciones_inventario/%' and (split_part(path,'/',2) like '%\%%' escape '\' or split_part(path,'/',2) !~ '^(existencias|productos_aseo|herramientas)__.+$')) then raise exception 'Identificador legado requiere conversión explícita'; end if;
 insert into public.web_valuations(id,legacy_collection,legacy_id,unit_value,original_fields,updated_at,updated_by,updated_by_uid,origin)
 select split_part(path,'/',2),split_part(split_part(path,'/',2),'__',1),substring(split_part(path,'/',2) from position('__' in split_part(path,'/',2))+2),
 coalesce(f#>>'{valor_unitario,doubleValue}',f#>>'{valor_unitario,integerValue}')::numeric,f,
 (f#>>'{actualizado_en,timestampValue}')::timestamptz,coalesce(f#>>'{actualizado_por,stringValue}',''),
 coalesce(f#>>'{actualizado_por_uid,stringValue}',''),coalesce(f#>>'{origen_actualizacion,stringValue}','')
 from (select path,raw_document::jsonb->'fields' f from public.web_admin_archive where source_hash=p_source_hash and path like 'valoraciones_inventario/%') source;
 get diagnostics n=row_count;
 if n=0 or exists(select 1 from public.web_valuations where unit_value is null) then raise exception 'Valoraciones incompletas'; end if;
 insert into public.web_settings(singleton,operational,source_hash) values(true,false,p_source_hash);
 return jsonb_build_object('valuations',n,'operational',false,'stock_writes',0);
end $$;
revoke all on function public.web_import_valuations(text) from public,anon,authenticated;

create function public.web_require_access(p_manage boolean default false) returns public.web_profiles
language plpgsql security definer set search_path='' as $$
declare profile public.web_profiles;
begin
 select * into profile from public.web_profiles where user_id=auth.uid() and active;
 if profile.user_id is null or not exists(select 1 from public.operators where user_id=auth.uid() and active)
 or (p_manage and profile.role not in ('ADMIN','MANAGER')) then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 return profile;
end $$;
revoke all on function public.web_require_access(boolean) from public,anon,authenticated;

create function public.web_panel_access() returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.web_profiles;
begin
 profile:=public.web_require_access(false);
 return jsonb_build_object('user_id',profile.user_id,'display_name',profile.display_name,'role',profile.role,
 'operational',coalesce((select operational from public.web_settings where singleton),false));
end $$;
revoke all on function public.web_panel_access() from public,anon;
grant execute on function public.web_panel_access() to authenticated;

-- Identity mapping is independent from the current display code. Each chemical
-- warehouse retains its own legacy valuation; lots in that warehouse share it.
create function public.web_valuation_key(p_entity text,p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare result text; matches integer;
begin
 if p_entity='POSITION' then
   select count(*),min(case
    when p.module_id='AGROQUIMICOS' and m.source_id is not null then 'existencias__'||m.source_id
    when p.module_id='AGROQUIMICOS' then 'products__'||p.id::text||'__'||encode(sha256(convert_to(s.location_code,'UTF8')),'hex')
    when p.legacy_id is not null and p.legacy_source='firestore:arles-gestion:productos_aseo' then 'productos_aseo__'||p.legacy_id
    when p.legacy_id is not null and p.legacy_source='firestore:arles-gestion:existencias' then 'existencias__'||p.legacy_id
    else 'products__'||p.id::text||'__'||encode(sha256(convert_to(s.location_code,'UTF8')),'hex') end)
   into matches,result from public.stock_positions s join public.products p on p.id=s.product_id
   left join public.legacy_agroquimicos_mapping m on p.module_id='AGROQUIMICOS' and m.product_id=p.id and m.location_code=s.location_code
   where s.id=p_id and p.active;
 elsif p_entity='ASSET' then
   select count(*),min(case when legacy_id is not null then 'herramientas__'||legacy_id else 'workshop__'||id::text end)
   into matches,result from public.workshop_assets where id=p_id and active;
 else raise exception 'Tipo de inventario no válido'; end if;
 if matches<>1 or result is null then raise exception 'No hay un vínculo único con el inventario vigente'; end if;
 return result;
end $$;
revoke all on function public.web_valuation_key(text,uuid) from public,anon,authenticated;

create function public.web_valuation_page(p_after text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 return coalesce((select jsonb_agg(to_jsonb(row) order by row.id collate "C") from (
 select id,unit_value,revision,updated_at,updated_by,updated_by_uid,origin from public.web_valuations
 where p_after is null or id collate "C">p_after collate "C" order by id collate "C" limit 200
 ) row),'[]'::jsonb);
end $$;
revoke all on function public.web_valuation_page(text) from public,anon;
grant execute on function public.web_valuation_page(text) to authenticated;

create function public.web_valuation_catalog(p_after text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 return coalesce((select jsonb_agg(to_jsonb(row) order by row.cursor collate "C") from (
   select base.*,v.unit_value,coalesce(v.revision,0) revision from (
    select 'POSITION:'||s.id::text cursor,'POSITION' entity,s.id entity_id,p.id product_id,p.module_id,
     p.code,p.name,p.reference,p.unit_id,s.location_code,s.quantity_milli,
     public.web_valuation_key('POSITION',s.id) valuation_id
    from public.stock_positions s join public.products p on p.id=s.product_id where p.active
    union all
    select 'ASSET:'||a.id::text,'ASSET',a.id,a.id,'TALLER',a.code,a.name,''::text,a.unit,a.section,a.total_milli,
     public.web_valuation_key('ASSET',a.id)
    from public.workshop_assets a where a.active
   ) base left join public.web_valuations v on v.id=base.valuation_id
   where p_after is null or base.cursor collate "C">p_after collate "C"
   order by base.cursor collate "C" limit 200
 ) row),'[]'::jsonb);
end $$;
revoke all on function public.web_valuation_catalog(text) from public,anon;
grant execute on function public.web_valuation_catalog(text) to authenticated;

create function public.web_save_manual_valuation(p_request_id uuid,p_entity text,p_entity_id uuid,p_expected_revision bigint,p_unit_value numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.web_profiles; request public.web_valuation_writes; current public.web_valuations;
 v_id text; v_payload jsonb; v_result jsonb; v_revision bigint;
begin
 profile:=public.web_require_access(true);
 if not coalesce((select operational from public.web_settings where singleton),false) then raise exception 'La web está en revisión; las escrituras aún no están activadas'; end if;
 if p_request_id is null or p_entity_id is null or p_expected_revision is null or p_expected_revision<0 or p_unit_value is null or p_unit_value::text in ('NaN','Infinity','-Infinity') or p_unit_value<0 or p_unit_value>999999999999 then raise exception 'Valor o revisión no válido'; end if;
 v_payload:=jsonb_build_object('entity',p_entity,'entity_id',p_entity_id,'revision',p_expected_revision,'value',p_unit_value);
 perform pg_advisory_xact_lock(hashtextextended('web-request:'||p_request_id::text,0));
 select * into request from public.web_valuation_writes where request_id=p_request_id;
 if found then
   if request.actor<>auth.uid() or request.payload<>v_payload then raise exception 'El identificador de operación ya se usó con otros datos'; end if;
   return request.result;
 end if;
 v_id:=public.web_valuation_key(p_entity,p_entity_id);
 perform pg_advisory_xact_lock(hashtextextended('web-valuation:'||v_id,0));
 select * into current from public.web_valuations where id=v_id for update;
 v_revision:=coalesce(current.revision,0);
 if v_revision<>p_expected_revision then return jsonb_build_object('status','conflict','valuation_id',v_id,'revision',v_revision,'unit_value',current.unit_value); end if;
 if current.id is not null and current.unit_value=p_unit_value then
   v_result:=jsonb_build_object('status','unchanged','valuation_id',v_id,'revision',v_revision,'unit_value',p_unit_value);
 else
   insert into public.web_valuations(id,unit_value,revision,updated_at,updated_by,updated_by_uid,origin)
   values(v_id,p_unit_value,v_revision+1,now(),profile.display_name,auth.uid()::text,'manual')
   on conflict(id) do update set unit_value=excluded.unit_value,revision=excluded.revision,updated_at=excluded.updated_at,
     updated_by=excluded.updated_by,updated_by_uid=excluded.updated_by_uid,origin=excluded.origin;
   v_result:=jsonb_build_object('status','saved','valuation_id',v_id,'revision',v_revision+1,'unit_value',p_unit_value);
 end if;
 insert into public.web_valuation_writes(request_id,actor,payload,result) values(p_request_id,auth.uid(),v_payload,v_result);
 if v_result->>'status'='saved' then
   insert into public.web_valuation_audit(request_id,valuation_id,actor,before_value,after_value,before_revision,after_revision)
   values(p_request_id,v_id,auth.uid(),current.unit_value,p_unit_value,v_revision,v_revision+1);
 end if;
 return v_result;
end $$;
revoke all on function public.web_save_manual_valuation(uuid,text,uuid,bigint,numeric) from public,anon;
grant execute on function public.web_save_manual_valuation(uuid,text,uuid,bigint,numeric) to authenticated;
commit;

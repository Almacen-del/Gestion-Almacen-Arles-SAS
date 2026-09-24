begin;
-- Private preservation area. Import verification does NOT activate the web,
-- grant roles, overwrite live inventory, or turn close rows into movements.
create table public.web_admin_imports (
 source_hash text primary key check(source_hash ~ '^[a-f0-9]{64}$'),
 source_read_time timestamptz not null,
 expected_count integer not null check(expected_count>0),
 archive_sha256 text not null check(archive_sha256 ~ '^[a-f0-9]{64}$'),
 counts jsonb not null,
 verified_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.web_admin_archive (
 source_hash text not null references public.web_admin_imports(source_hash),
 path text not null check(path ~ '^(usuarios|valoraciones_inventario|valoraciones_entradas|cierres_valoracion_inventario)/[^/]+$' or path ~ '^cierres_valoracion_inventario/[^/]+/(items|movimientos|recuperaciones)/[^/]+$'),
 raw_document text not null,
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 primary key(source_hash,path),
 check(encode(sha256(convert_to(raw_document,'UTF8')),'hex')=document_sha256),
 check(raw_document::jsonb->>'name'='projects/arles-gestion/databases/(default)/documents/'||path),
 check(jsonb_typeof(raw_document::jsonb->'fields')='object')
);
alter table public.web_admin_imports enable row level security;
alter table public.web_admin_imports force row level security;
alter table public.web_admin_archive enable row level security;
alter table public.web_admin_archive force row level security;
revoke all on public.web_admin_imports,public.web_admin_archive from public,anon,authenticated;

create function public.web_admin_verify_archive(p_source_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare expected public.web_admin_imports; actual_count integer; actual_hash text; actual_counts jsonb;
begin
 select * into strict expected from public.web_admin_imports where source_hash=p_source_hash for update;
 select count(*),encode(sha256(convert_to(string_agg(path||E'\t'||document_sha256||E'\n','' order by path collate "C"),'UTF8')),'hex')
 into actual_count,actual_hash from public.web_admin_archive where source_hash=p_source_hash;
 if actual_count<>expected.expected_count or actual_hash is distinct from expected.archive_sha256 then
   raise exception 'Archivo incompleto o diferente de la fuente. No se activa';
 end if;
 select jsonb_object_agg(group_name,n) into actual_counts from (
   select case when cardinality(string_to_array(path,'/'))=4 then split_part(path,'/',1)||'/'||split_part(path,'/',3) else split_part(path,'/',1) end group_name,count(*) n
   from public.web_admin_archive where source_hash=p_source_hash group by 1
 ) grouped;
 if actual_counts is distinct from expected.counts then raise exception 'Conteos administrativos no coinciden'; end if;
 if exists(select 1 from public.web_admin_archive child where child.source_hash=p_source_hash and cardinality(string_to_array(child.path,'/'))=4 and not exists(
   select 1 from public.web_admin_archive parent where parent.source_hash=p_source_hash and parent.path=split_part(child.path,'/',1)||'/'||split_part(child.path,'/',2)
 )) then raise exception 'Detalle sin cierre'; end if;
 update public.web_admin_imports set verified_at=now() where source_hash=p_source_hash;
 return jsonb_build_object('verified',true,'documents',actual_count,'counts',actual_counts,'stock_writes',0,'auth_changes',0);
end $$;
revoke all on function public.web_admin_verify_archive(text) from public,anon,authenticated;
commit;

-- User confirmed these three source cancellations on 2026-09-24.
-- Keep original documents and actual mobile receipts; adjust only the cancelled
-- quantities. No fabricated entry and no overwrite of the latest balance.
begin;
create table public.historical_annulments(
 source_path text primary key references public.historical_movements(source_path),
 stock_position_id uuid not null references public.stock_positions(id),
 correction_milli bigint not null check(correction_milli>0),
 before_milli bigint not null,after_milli bigint not null,
 reason text not null,confirmed_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 check(after_milli=before_milli+correction_milli)
);
alter table public.historical_annulments enable row level security;
alter table public.historical_annulments force row level security;
revoke all on public.historical_annulments from public,anon,authenticated;
do $$
declare expected record; position public.stock_positions; history public.historical_movements; ledger numeric; definition text;
begin
 perform 1 from public.stock_positions s join public.products p on p.id=s.product_id where p.module_id='COMBUSTIBLE' and p.code in ('ACPM2','GAS1') order by s.id for update of s;
 for expected in select * from (values('ACPM2',529190::bigint),('GAS1',103110::bigint))v(code,base) loop
  if (select count(*) from public.stock_positions s join public.products p on p.id=s.product_id where p.module_id='COMBUSTIBLE' and p.code=expected.code)<>1 then raise exception 'Identidad combustible ambigua';end if;
  select s.* into position from public.stock_positions s join public.products p on p.id=s.product_id where p.module_id='COMBUSTIBLE' and p.code=expected.code;
  select coalesce(sum(case when kind='ENTRADA' then quantity_milli else -quantity_milli end),0) into ledger from public.movements where stock_position_id=position.id;
  if position.quantity_milli<>expected.base+ledger then raise exception 'El saldo no coincide con la base y los recibos; no se modifica';end if;
 end loop;
 for expected in select * from (values
 ('BOfBWcIbML932opwqrh1','GAS1',1000::bigint),
 ('yEsRsOrSanM3Km5trmhs','GAS1',3000::bigint),
 ('MOV-INV-92c6a777-fb1d-47a2-b654-1799ee953433','ACPM2',13400::bigint))v(id,code,amount) loop
  select * into history from public.historical_movements where source_path='projects/arles-gestion/databases/(default)/documents/movimientos/'||expected.id;
  if history.source_path is null or history.module_id<>'COMBUSTIBLE' or history.source_code<>expected.code or history.quantity*1000<>expected.amount or lower(history.kind_original)<>'salida' then raise exception 'La salida original no coincide';end if;
  select s.* into position from public.stock_positions s join public.products p on p.id=s.product_id where p.module_id='COMBUSTIBLE' and p.code=expected.code;
  insert into public.historical_annulments values(history.source_path,position.id,expected.amount,position.quantity_milli,position.quantity_milli+expected.amount,'Anulación confirmada por el usuario; retirada también en Firebase','5799fac7-852e-4261-9717-015a2d287463',now());
  update public.stock_positions set quantity_milli=quantity_milli+expected.amount,revision=revision+1,updated_at=now() where id=position.id;
 end loop;
 select pg_get_functiondef('public.web_panel_snapshot()'::regprocedure) into definition;
 if position('left join public.historical_photo_evidence e using(source_path)' in definition)=0 then raise exception 'Versión del lector no reconocida';end if;
 execute replace(definition,'left join public.historical_photo_evidence e using(source_path)','left join public.historical_photo_evidence e using(source_path) where not exists(select 1 from public.historical_annulments cancelled where cancelled.source_path=h.source_path)');
 select pg_get_functiondef('public.warehouse_historical_movements(text,integer)'::regprocedure) into definition;
 if position('where h.module_id=p_module' in definition)=0 then raise exception 'Versión móvil no reconocida';end if;
 execute replace(definition,'where h.module_id=p_module','where not exists(select 1 from public.historical_annulments cancelled where cancelled.source_path=h.source_path) and h.module_id=p_module');
end $$;
commit;

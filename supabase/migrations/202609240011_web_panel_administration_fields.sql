begin;
-- One statement snapshot: stock, receipts and valuation identities describe the
-- same database state. No inventory replay or migration is performed here.
create or replace function public.web_panel_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.web_require_access(false);
 return jsonb_build_object(
 'version',1,'read_at',statement_timestamp(),
 'positions',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (
  select s.*,p.module_id,p.code,p.name,p.category,p.reference,p.unit_id,
   public.web_valuation_key('POSITION',s.id) valuation_id,
   l.code lot,l.expiry_year,l.expiry_month,l.expiry_day,coalesce((select min(received_at)::timestamptz from public.web_lot_links where position_id=s.id),l.created_at) lot_created_at
  from public.stock_positions s join public.products p on p.id=s.product_id
  left join public.lots l on l.id=s.lot_id where p.active
 )r),'[]'::jsonb),
 'assets',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (
  select a.*,case when active then public.web_valuation_key('ASSET',a.id) end valuation_id from public.workshop_assets a
 )r),'[]'::jsonb),
 'loans',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (
  select l.*,h.person,h.destination,h.due_at,h.created_at from public.workshop_loan_lines l
  join public.workshop_loans h on h.id=l.loan_id where l.returned_milli<l.quantity_milli
 )r),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (
  select m.*,s.product_id,s.location_code,p.module_id,p.code,p.name,p.reference,p.unit_id,
   l.code lot,o.display_name operator_name
  from public.movements m join public.stock_positions s on s.id=m.stock_position_id
  join public.products p on p.id=s.product_id join public.operators o on o.user_id=m.operator_id
  left join public.lots l on l.id=s.lot_id
 )r),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(r) order by r.source_path) from (
  select h.*,coalesce(p.code,h.source_code) display_code,e.evidence_path,e.status photo_status,
   s.source_json::jsonb->'fields' original_fields
  from public.historical_movements h join public.legacy_history_stage s using(source_path)
  left join public.products p on p.id=h.product_id left join public.historical_photo_evidence e using(source_path)
 )r),'[]'::jsonb),
 'workshop_history',coalesce((select jsonb_agg(to_jsonb(h) order by source_path) from public.workshop_history h),'[]'::jsonb),
 'workshop_operations',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (
  select w.*,o.display_name operator_name from public.workshop_operations w
  join public.operators o on o.user_id=w.actor
 )r),'[]'::jsonb),
 'valuations',coalesce((select jsonb_agg(to_jsonb(v) order by id) from public.web_valuations v),'[]'::jsonb),
 'entry_lot_totals',coalesce((select jsonb_agg(to_jsonb(t) order by movement_id) from public.web_entry_lot_totals t),'[]'::jsonb),
 'historical_profiles',coalesce((select jsonb_agg(jsonb_build_object('id',split_part(a.path,'/',2),'fields',jsonb_build_object('nombre',f->'nombre','nombres',f->'nombres','cargo',f->'cargo','email',f->'email'))) from (select a.*,a.raw_document::jsonb->'fields' f from public.web_admin_archive a join public.web_settings s using(source_hash) where a.path ~ '^usuarios/[^/]+$') a),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(to_jsonb(r) order by r.user_id) from (
  select w.user_id,w.legacy_uid,w.display_name,w.role,w.active,w.job_title,w.approved,u.email from public.web_profiles w join auth.users u on u.id=w.user_id
 )r),'[]'::jsonb)
 );
end $$;
revoke all on function public.web_panel_snapshot() from public,anon;
grant execute on function public.web_panel_snapshot() to authenticated;
commit;

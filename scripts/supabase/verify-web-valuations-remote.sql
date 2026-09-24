begin;
select set_config('request.jwt.claim.sub','5799fac7-852e-4261-9717-015a2d287463',true);
set local role authenticated;
with recursive pages as (
 select public.web_valuation_catalog(null) rows
 union all
 select public.web_valuation_catalog((p.rows->(jsonb_array_length(p.rows)-1))->>'cursor')
 from pages p where jsonb_array_length(p.rows)=200
), catalog as (select value from pages cross join lateral jsonb_array_elements(rows))
select public.web_panel_access() access,
 count(*) as positions_and_assets,
 count(*) filter(where value->>'entity'='ASSET') as workshop_assets,
 count(*) filter(where value->>'entity'='POSITION') as warehouse_positions,
 count(*) filter(where value->>'unit_value' is not null) as linked_prices,
 count(*) filter(where value->>'entity'='POSITION' and value->>'unit_value' is null) as warehouse_without_price,
 count(distinct value->>'valuation_id') as valuation_keys
from catalog;
rollback;

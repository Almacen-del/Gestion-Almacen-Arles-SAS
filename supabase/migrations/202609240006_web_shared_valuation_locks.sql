begin;
-- Manual and entry valuations must lock the same keys, including the first
-- price for a product that has no existing row to lock.
do $$ declare definition text;
begin
 definition:=pg_get_functiondef('public.web_save_entry_value(uuid,text,bigint,numeric)'::regprocedure);
 if position('hashtextextended(p_request_id::text,0)' in definition)=0
  or position('hashtextextended(entry_id,1)' in definition)=0 then raise exception 'Revisar versión de valoración de entradas'; end if;
 definition:=replace(definition,'hashtextextended(p_request_id::text,0)','hashtextextended(''web-request:''||p_request_id::text,0)');
 definition:=replace(definition,'hashtextextended(entry_id,1)','hashtextextended(''web-valuation:''||entry_id,0)');
 execute definition;
end $$;
commit;

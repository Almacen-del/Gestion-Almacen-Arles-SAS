import {describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {WebAdministration,currentValuationRows,type ValuationCatalogRow,type ManualValuationRequest} from './administration';
const request:ManualValuationRequest={requestId:'00000000-0000-4000-8000-000000000001',entity:'POSITION',entityId:'00000000-0000-4000-8000-000000000002',expectedRevision:1,unitValue:25.5};
function setup(){const rpc=vi.fn();return {rpc,api:new WebAdministration({rpc} as unknown as SupabaseClient)};}
function row(id:string){return {id,unit_value:25,revision:1,updated_at:null,updated_by:'Test',updated_by_uid:'legacy',origin:'manual'};}
describe('administrative operations',()=>{
 it('combines lots without duplicating products or inventing a workshop price',()=>{
  const base:ValuationCatalogRow={cursor:'POSITION:1',entity:'POSITION',entity_id:'1',product_id:'p',module_id:'AGROQUIMICOS',
   code:'FER056',name:'Producto',reference:'',unit_id:'GRAMO',location_code:'COP',quantity_milli:1000,valuation_id:'legacy-COP',unit_value:2,revision:1};
  const rows=currentValuationRows([base,{...base,cursor:'POSITION:2',entity_id:'2',quantity_milli:2500},
   {...base,cursor:'POSITION:3',entity_id:'3',location_code:'PORTUGUESA',valuation_id:'legacy-PORTUGUESA',quantity_milli:5000,unit_value:3}]);
  expect(rows).toHaveLength(2);expect(rows[0].quantity).toBe(3.5);expect(rows[0].totalValue).toBe(7);
  expect(rows[1].totalValue).toBe(15);
  expect(()=>currentValuationRows([base,{...base,cursor:'POSITION:4',product_id:'other'}])).toThrow('diferentes');
  expect(()=>currentValuationRows([base,base])).toThrow('repetida');
  const tool=currentValuationRows([{...base,cursor:'ASSET:5',entity:'ASSET',module_id:'TALLER',unit_value:null,revision:0}])[0];
  expect(tool.unitValue).toBe(0);expect(tool.includesOccupied).toBe(true);
 });
 it('loads the complete valuation history, keeping old identifiers',async()=>{
  const {rpc,api}=setup();const first=Array.from({length:200},(_,i)=>row(`existencias__${String(i).padStart(3,'0')}`));
  rpc.mockResolvedValueOnce({data:first,error:null}).mockResolvedValueOnce({data:[row('existencias__Q-FER056-COP')],error:null});
  expect(await api.valuations()).toHaveLength(201);
  expect(rpc).toHaveBeenLastCalledWith('web_valuation_page',{p_after:'existencias__199'});
 });
 it('rejects incomplete downloads and repeated cursors',async()=>{
  const {rpc,api}=setup();const page=Array.from({length:200},(_,i)=>row(String(i).padStart(3,'0')));
  rpc.mockResolvedValueOnce({data:page,error:null}).mockResolvedValueOnce({data:[row('199')],error:null});
  await expect(api.valuations()).rejects.toThrow('repetida');
  rpc.mockResolvedValue({data:null,error:{message:'private database details'}});
  await expect(api.valuations()).rejects.toThrow('No se pudo confirmar');
 });
 it('preserves request identity when retrying an uncertain save',async()=>{
  const {rpc,api}=setup();rpc.mockResolvedValueOnce({data:null,error:{message:'timeout'}})
   .mockResolvedValueOnce({data:{status:'saved',valuation_id:'existencias__OLD',revision:2,unit_value:25.5},error:null});
  await expect(api.saveManual(request)).rejects.toThrow();
  expect((await api.saveManual(request)).status).toBe('saved');
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
 });
 it('reports concurrent changes without turning them into successes',async()=>{
  const {rpc,api}=setup();rpc.mockResolvedValue({data:{status:'conflict',valuation_id:'old',revision:3,unit_value:60},error:null});
  expect((await api.saveManual(request)).status).toBe('conflict');
 });
 it('rejects invalid prices before making a request and mismatched confirmations',async()=>{
  const {rpc,api}=setup();await expect(api.saveManual({...request,unitValue:NaN})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({data:{status:'saved',valuation_id:'old',revision:99,unit_value:25.5},error:null});
  await expect(api.saveManual(request)).rejects.toThrow('no coincide');
 });
});

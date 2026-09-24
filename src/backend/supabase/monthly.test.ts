import {expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {MonthlyArchive,decodeFields} from './monthly';
vi.mock('../../firebase',()=>({db:{}}));
it('preserves nested original fields and exact decimal values',()=>{
 const data=decodeFields({resumen:{mapValue:{fields:{valor_total:{doubleValue:123.456789}}}},fecha:{timestampValue:'2026-08-31T20:00:00Z'}});
 expect(data.resumen).toEqual({valor_total:123.456789});
 expect((data.fecha as {toDate:()=>Date}).toDate().toISOString()).toBe('2026-08-31T20:00:00.000Z');
});
it('reads the existing monthly summary and detail without recomputing archived prices',async()=>{
 const summary={path:'cierres_valoracion_inventario/2026-08',fields:{estado:{stringValue:'completo'},resumen:{mapValue:{fields:{valor_total:{doubleValue:2.469134},cantidad_productos:{integerValue:'1'}}}}}};
 const item={path:'cierres_valoracion_inventario/2026-08/items/a',fields:{cantidad:{doubleValue:2},valor_unitario:{doubleValue:1.234567},valor_total:{doubleValue:2.469134},producto:{stringValue:'Original'}}};
 const rpc=vi.fn(async(_name:string,args?:Record<string,unknown>)=>({error:null,data:args?.p_period?[item]:[summary]}));
 const reader=new MonthlyArchive({rpc} as unknown as SupabaseClient);
 expect((await reader.summaries()).summaries[0].totalValue).toBe(2.469134);
 expect((await reader.items('2026-08'))[0].unitValue).toBe(1.234567);
});
it('rejects duplicate archived records and invalid numeric fields',async()=>{
 const row={path:'cierres_valoracion_inventario/2026-08',fields:{}};
 const reader=new MonthlyArchive({rpc:async()=>({data:[row,row],error:null})} as unknown as SupabaseClient);
 await expect(reader.summaries()).rejects.toThrow('repetidos');
 expect(()=>decodeFields({n:{doubleValue:'NaN'}})).toThrow('Número');
});

import type {SupabaseClient} from '@supabase/supabase-js';
import type {EntryStockMovement,EntryValuationRecord,SaveEntryValuationResult} from '../../valuation/entryValuation';
import {validateEntryStockNumbers} from '../../valuation/entryValuationMath';
import {moduleNames,assertModule} from './contracts';
type Row=Record<string,unknown>;
function list(value:unknown):Row[]{if(!Array.isArray(value)||value.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw Error('Respuesta de entradas incompleta.');return value;}
function text(row:Row,key:string){return typeof row[key]==='string'?row[key] as string:'';}
function numeric(row:Row,key:string){return typeof row[key]==='number'?row[key] as number:NaN;}
export interface EntryWrite {requestId:string;movementId:string;revision:number;unitValue:number}
export class EntryWriteRejected extends Error {}
export class EntryAdministration {
 constructor(private client:Pick<SupabaseClient,'rpc'>){}
 private async call(name:string,args:Record<string,unknown>={}){const {data,error}=await this.client.rpc(name,args);if(error){
  if(error.code==='P0001'||error.code==='42501')throw new EntryWriteRejected(error.code==='42501'?'Acceso no autorizado.':'La valoración fue rechazada por el servidor. Actualiza y revisa el orden de las entradas y el promedio actual.');
  throw Error('No se pudo confirmar la valoración. Reintenta el mismo valor.');
 }return data;}
 async catalog():Promise<EntryStockMovement[]>{
  const seen=new Set<string>();
  return list(await this.call('web_entry_catalog')).map(row=>{
   const id=text(row,'id'),module=text(row,'module_id');assertModule(module);
   if(!id||seen.has(id))throw Error('Entrada sin identidad única.');seen.add(id);
   const valuationId=text(row,'valuation_id'),quantity=numeric(row,'quantity'),previousStock=numeric(row,'previous_stock'),newStock=numeric(row,'new_stock');
   const time=Date.parse(text(row,'created_at'));let validationIssue='';
   try{validateEntryStockNumbers({quantity,previousStock,newStock});}catch(e){validationIssue=e instanceof Error?e.message:'Saldos inválidos';}
   if(!Number.isFinite(time))validationIssue='La fecha original no está confirmada.';
   if(!valuationId)validationIssue='No se pudo identificar la valoración de este producto.';
   return {id,productId:valuationId,productKey:valuationId||id,valuationId,moduleName:moduleNames[module],code:text(row,'code'),product:text(row,'name'),reference:text(row,'reference'),unit:text(row,'unit'),
    createdAt:Number.isFinite(time)?new Date(time):null,createdAtMs:Number.isFinite(time)?time:null,dateLabel:text(row,'created_at'),quantity,previousStock,newStock,validationIssue};
  });
 }
 async values():Promise<Record<string,EntryValuationRecord>>{
  const result:Record<string,EntryValuationRecord>={};
  for(const row of list(await this.call('web_entry_values'))){
   const id=text(row,'movement_id');if(!id||Object.hasOwn(result,id))throw Error('Valoración de entrada repetida.');
   const numbers=['entry_unit_value','previous_average','new_average'].map(key=>numeric(row,key));
   if(numbers.some(n=>!Number.isFinite(n)||n<0))throw Error('Promedio de entrada inválido.');
   const time=Date.parse(text(row,'valued_at'));
   result[id]={movementId:id,entryUnitValue:numbers[0],previousAverage:numbers[1],newAverage:numbers[2],valuedAt:Number.isFinite(time)?new Date(time):null};
  }
  return result;
 }
 async save(write:EntryWrite):Promise<SaveEntryValuationResult>{
  const result=await this.call('web_save_entry_value',{p_request_id:write.requestId,p_movement_id:write.movementId,p_expected_revision:write.revision,p_unit_value:write.unitValue});
  if(!result||!['previousAverage','newAverage'].every(key=>typeof result[key]==='number'&&Number.isFinite(result[key])&&result[key]>=0))throw Error('No se recibió confirmación válida.');
  return result;
 }
}

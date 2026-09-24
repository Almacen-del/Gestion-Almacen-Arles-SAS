import {parsePanelSnapshot} from './panel';
import {panelMonthlyRows,panelMonthlySources} from './monthlySources';
import {buildMonthlyActivity} from '../../valuation/monthlyActivity';
import {reconstructHistoricalMonthlyClose} from '../../valuation/historicalReconstruction';
import type {saveMonthlyValuationClose,subscribeMonthlyValuationPeriod} from '../../valuation/monthlyValuation';
import type {SupabaseClient} from '@supabase/supabase-js';
import {Timestamp} from 'firebase/firestore';
import {readMonthlySummary,type MonthlyValuationSummaryPage} from '../../valuation/monthlyValuation';
import type {MonthlyValuationItem} from '../../valuation/models';
import type {MonthlyActivityMetadata} from '../../valuation/monthlyActivityStorage';
import {readMonthlyActivityRow} from '../../valuation/monthlyActivityStorage';
import {summarizeMonthlyActivity} from '../../valuation/monthlyActivity';
import type {MonthlyActivitySnapshot} from '../../valuation/monthlyActivity';

function decode(value:unknown):unknown{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Campo archivado inválido.');
 const v=value as Record<string,unknown>;
 if('nullValue'in v)return null;
 if('stringValue'in v)return v.stringValue;
 if('booleanValue'in v)return v.booleanValue;
 if('integerValue'in v||'doubleValue'in v){const n=Number(v.integerValue??v.doubleValue);if(!Number.isFinite(n))throw Error('Número archivado inválido.');return n;}
 if('timestampValue'in v){const date=new Date(String(v.timestampValue));if(!Number.isFinite(date.getTime()))throw Error('Fecha archivada inválida.');return Timestamp.fromDate(date);}
 if('mapValue'in v)return decodeFields((v.mapValue as {fields?:unknown}).fields??{});
 if('arrayValue'in v)return ((v.arrayValue as {values?:unknown[]}).values??[]).map(decode);
 throw Error('Tipo archivado no soportado.');
}
export function decodeFields(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Documento archivado inválido.');
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
}
function decodePlainSummary(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Cierre inválido.');
 const result={...value as Record<string,unknown>};
 for(const key of ['fecha','pulso'])if(typeof result[key]==='string')result[key]=Timestamp.fromDate(new Date(result[key] as string));
 if(result.reconstruccion){const r={...result.reconstruccion as Record<string,unknown>};for(const key of ['fecha_corte','fecha_valoracion'])if(typeof r[key]==='string')r[key]=Timestamp.fromDate(new Date(r[key] as string));result.reconstruccion=r;}
 return result;
}
function rowSignature(rows:readonly {valuationId:string;quantity:number;unitValue:number}[]){return JSON.stringify(rows.map(r=>[r.valuationId,r.quantity,r.unitValue]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
export interface MonthlyReader {
 save?:typeof saveMonthlyValuationClose;
 subscribe?:typeof subscribeMonthlyValuationPeriod;
 summaries:(cursor?:string|null)=>Promise<MonthlyValuationSummaryPage>;
 items:(period:string)=>Promise<MonthlyValuationItem[]>;
 activity:(metadata:MonthlyActivityMetadata)=>Promise<MonthlyActivitySnapshot>;
}
export class MonthlyArchive implements MonthlyReader {
 constructor(private client:Pick<SupabaseClient,'rpc'>){}
 private pending=new Map<string,Record<string,unknown>>();
 subscribe:typeof subscribeMonthlyValuationPeriod=(period,onData,onError,onMetadata)=>{
  let active=true;
  const refresh=async()=>{try{const docs=await this.documents(null);const row=docs.find(d=>d.path===`cierres_valoracion_inventario/${period}`);if(active){onData(row?readMonthlySummary(period,row.fields):null);onMetadata?.({fromCache:false,hasPendingWrites:false});}}catch(e){if(active)onError(e instanceof Error?e:Error('No se pudo consultar el cierre.'));}};
  void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{active=false;clearInterval(timer);};
 };
 save:typeof saveMonthlyValuationClose=async input=>{
  if(!input.historyComplete)throw Error('El historial completo debe estar confirmado.');
  let request=this.pending.get(input.period);
  if(!request){
   const {data,error}=await this.client.rpc('web_monthly_basis');
   if(error||!data||typeof data.fingerprint!=='string')throw Error('No se pudo confirmar la base del cierre.');
   const snapshot=parsePanelSnapshot(data.snapshot),currentRows=panelMonthlyRows(snapshot),sources=panelMonthlySources(snapshot);
   const modules=[...new Set(currentRows.map(r=>r.moduleName))];
   const now=new Date(snapshot.readAt);
   const reconstructed=input.reconstruction?reconstructHistoricalMonthlyClose({period:input.period,currentRows,moduleOptions:modules,movements:sources,now}):null;
   if(reconstructed?.blockingIssues.length)throw Error(reconstructed.blockingIssues.join(' '));
   const rows=reconstructed?.rows??currentRows;
   if(rowSignature(rows)!==rowSignature(input.rows))throw Error('Los datos cambiaron desde la vista previa. Actualiza y revisa el cierre.');
   const activity=reconstructed?.activity??buildMonthlyActivity(input.period,rows,sources,now);
   request={p_request_id:crypto.randomUUID(),p_period:input.period,p_fingerprint:data.fingerprint,p_confirmation:input.earlyConfirmation,p_items:rows,p_activity:activity,p_reconstruction:reconstructed?{tipo:'precios_actuales',periodo_base:input.reconstruction!.sourcePeriod,fecha_corte:reconstructed.cutoffAt.toISOString(),fecha_valoracion:now.toISOString()}:null};
   this.pending.set(input.period,request);
  }
  input.onProgress(0,1);
  const {data,error}=await this.client.rpc('web_save_monthly_close',request);
  if(error){if(error.code==='P0001'||error.code==='42501'){this.pending.delete(input.period);throw Error('El servidor rechazó el cierre. Actualiza y revisa los valores y entradas pendientes.');}throw Error('No se pudo confirmar el cierre. Reintenta para consultar el mismo guardado.');}
  if(!data||!Number.isFinite(data.itemCount)||!Number.isFinite(data.totalValue)||!Number.isFinite(Date.parse(data.completedAt)))throw Error('Confirmación incompleta. Reintenta el mismo cierre.');
  this.pending.delete(input.period);input.onProgress(1,1);return {...data,completedAt:new Date(data.completedAt)};
 };
 private async documents(period:string|null){
  const {data,error}=await this.client.rpc('web_monthly_archive',{p_period:period});
  if(error||!Array.isArray(data))throw Error('No se pudo consultar el cierre mensual.');
  const seen=new Set<string>();
  return data.map(row=>{
   if(!row||typeof row.path!=='string'||seen.has(row.path))throw Error('Cierre con documentos repetidos.');
   seen.add(row.path);return {path:row.path as string,fields:row.format==='plain'?decodePlainSummary(row.fields):decodeFields(row.fields)};
  });
 }
 summaries=async(cursor:string|null=null):Promise<MonthlyValuationSummaryPage>=>{
  const summaries=(await this.documents(null)).map(row=>readMonthlySummary(row.path.split('/')[1],row.fields))
   .filter(row=>row.status==='completo'&&(!cursor||row.period<cursor)).sort((a,b)=>b.period.localeCompare(a.period));
  const page=summaries.slice(0,12);return {summaries:page,cursor:page.at(-1)?.period??cursor,hasMore:summaries.length>12};
 };
 items=async(period:string):Promise<MonthlyValuationItem[]>=>{
  const rows=(await this.documents(period)).filter(row=>row.path.split('/')[2]==='items').map(row=>{
   const f=row.fields;
   for(const key of ['cantidad','valor_unitario','valor_total'])if(typeof f[key]!=='number'||!Number.isFinite(f[key])||(f[key] as number)<0)throw Error('Valores de cierre inválidos.');
   return {id:row.path.split('/')[3],moduleName:String(f.modulo??''),code:String(f.codigo??''),reference:String(f.referencia??'N/A'),product:String(f.producto??''),quantity:f.cantidad as number,unit:String(f.unidad??''),unitValue:f.valor_unitario as number,totalValue:f.valor_total as number};
  });
  return rows.sort((a,b)=>a.moduleName.localeCompare(b.moduleName)||a.code.localeCompare(b.code,undefined,{numeric:true}));
 };
 activity=async(metadata:MonthlyActivityMetadata):Promise<MonthlyActivitySnapshot>=>{
  const rows=(await this.documents(metadata.period)).filter(row=>row.path.split('/')[2]==='movimientos').map(row=>{
   const item=readMonthlyActivityRow(row.fields.detalle);if(item.id!==row.path.split('/').slice(3).join('/'))throw Error('Identidad mensual inconsistente.');return item;
  });
  const totals=summarizeMonthlyActivity(rows);
  if(rows.length!==metadata.movementCount||Math.abs(totals.estimatedExpense-metadata.estimatedExpense)>.01)throw Error('El detalle no coincide con el cierre.');
  return {...metadata,rows};
 };
}

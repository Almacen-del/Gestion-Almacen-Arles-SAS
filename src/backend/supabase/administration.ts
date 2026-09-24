import type {SupabaseClient} from '@supabase/supabase-js';
import {moduleNames,quantityFromMilli} from './contracts';
import type {CurrentValuationRow} from '../../valuation/models';

export interface WebAccess {
  user_id:string; display_name:string; role:'ADMIN'|'MANAGER'|'READER'; operational:boolean;
}
export interface WebValuation {
  id:string; unit_value:number; revision:number; updated_at:string|null;
  updated_by:string; updated_by_uid:string; origin:string;
}
export type ManualValuationResult={
  status:'saved'|'unchanged'|'conflict'; valuation_id:string; revision:number; unit_value:number|null;
};
export type ManualValuationRequest={
  requestId:string; entity:'POSITION'|'ASSET'; entityId:string; expectedRevision:number; unitValue:number;
};
export interface ValuationCatalogRow {
  cursor:string;entity:'POSITION'|'ASSET';entity_id:string;product_id:string;module_id:string;
  code:string;name:string;reference:string;unit_id:string;location_code:string;quantity_milli:number;
  valuation_id:string;unit_value:number|null;revision:number;
}
type RpcClient=Pick<SupabaseClient,'rpc'>;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function object(value:unknown): Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Respuesta administrativa no válida.');
  return value as Record<string,unknown>;
}
function isPrice(value:unknown):value is number {
  return typeof value==='number' && Number.isFinite(value) && value>=0 && value<=999_999_999_999;
}

export class WebAccessDenied extends Error {}

export class WebAdministration {
  constructor(private readonly client:RpcClient){}

  private async call(name:string,args:Record<string,unknown>={}) {
    const {data,error}=await this.client.rpc(name,args);
    if(error) {
      if(error.code==='42501') throw new WebAccessDenied('Tu usuario no tiene acceso al panel.');
      throw new Error('No se pudo confirmar la operación en Supabase. Actualiza o reintenta la misma operación.');
    }
    return data as unknown;
  }

  async access():Promise<WebAccess> {
    const row=object(await this.call('web_panel_access'));
    if(typeof row.user_id!=='string' || !UUID.test(row.user_id) || typeof row.display_name!=='string' ||
      !['ADMIN','MANAGER','READER'].includes(row.role as string) || typeof row.operational!=='boolean')
      throw new Error('No se pudo verificar el perfil del panel.');
    return row as unknown as WebAccess;
  }

  async valuations():Promise<WebValuation[]> {
    const rows:WebValuation[]=[];
    const ids=new Set<string>();
    let cursor:string|null=null;
    for(;;) {
      const page=await this.call('web_valuation_page',{p_after:cursor});
      if(!Array.isArray(page) || page.length>200) throw new Error('Página de valoraciones no válida.');
      for(const value of page){
        const row=object(value);
        if(typeof row.id!=='string' || !row.id || ids.has(row.id) || (cursor!==null && row.id<=cursor) ||
          !isPrice(row.unit_value) || !Number.isSafeInteger(row.revision) || (row.revision as number)<1 ||
          !['updated_by','updated_by_uid','origin'].every(key=>typeof row[key]==='string') ||
          !(row.updated_at===null || (typeof row.updated_at==='string' && Number.isFinite(Date.parse(row.updated_at)))))
          throw new Error('Valoración incompleta o repetida. Se conserva la consulta anterior.');
        ids.add(row.id);cursor=row.id;rows.push(row as unknown as WebValuation);
      }
      if(page.length<200) return rows;
    }
  }

  async catalog():Promise<ValuationCatalogRow[]> {
    const rows:ValuationCatalogRow[]=[];
    const ids=new Set<string>();
    let cursor:string|null=null;
    for(;;){
      const page=await this.call('web_valuation_catalog',{p_after:cursor});
      if(!Array.isArray(page) || page.length>200) throw new Error('Página de inventario no válida.');
      for(const value of page){
        const row=object(value);
        if(!['POSITION','ASSET'].includes(row.entity as string) ||
          typeof row.entity_id!=='string' || !UUID.test(row.entity_id) || typeof row.product_id!=='string' || !UUID.test(row.product_id) ||
          row.cursor!==`${row.entity}:${row.entity_id}` || typeof row.cursor!=='string' || ids.has(row.cursor) ||
          (cursor!==null && row.cursor<=cursor) || !Number.isSafeInteger(row.revision) || (row.revision as number)<0 ||
          (row.revision===0 ? row.unit_value!==null : !isPrice(row.unit_value)) ||
          !['code','name','reference','unit_id','location_code','valuation_id'].every(key=>typeof row[key]==='string') || !row.valuation_id ||
          (row.entity==='ASSET' ? row.module_id!=='TALLER' : !Object.hasOwn(moduleNames,row.module_id as string)))
          throw new Error('Identidad o valoración del inventario no válida.');
        quantityFromMilli(row.quantity_milli as number);
        ids.add(row.cursor);cursor=row.cursor;rows.push(row as unknown as ValuationCatalogRow);
      }
      if(page.length<200) return rows;
    }
  }

  // The caller keeps this request (including UUID) across an uncertain network retry.
  async saveManual(request:ManualValuationRequest):Promise<ManualValuationResult> {
    if(!UUID.test(request.requestId) || !UUID.test(request.entityId) ||
      !['POSITION','ASSET'].includes(request.entity) || !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision<0 || !isPrice(request.unitValue)) throw new Error('Valor o revisión no válido.');
    const row=object(await this.call('web_save_manual_valuation',{
      p_request_id:request.requestId,p_entity:request.entity,p_entity_id:request.entityId,
      p_expected_revision:request.expectedRevision,p_unit_value:request.unitValue,
    }));
    if(!['saved','unchanged','conflict'].includes(row.status as string) ||
      typeof row.valuation_id!=='string' || !row.valuation_id || !Number.isSafeInteger(row.revision) ||
      (row.revision as number)<0 || !(isPrice(row.unit_value) || (row.status==='conflict' && row.unit_value===null)))
      throw new Error('Supabase no confirmó un resultado válido. Reintenta la misma operación.');
    if(row.status!=='conflict' && (row.unit_value!==request.unitValue ||
      row.revision!==(request.expectedRevision+(row.status==='saved'?1:0))))
      throw new Error('La confirmación no coincide con el cambio solicitado.');
    return row as ManualValuationResult;
  }
}

/** Input for the existing InventoryValuationModule. Lots share one unit price,
 * but never multiply the product count or cross product/unit boundaries. */
export function currentValuationRows(catalog:readonly ValuationCatalogRow[]):CurrentValuationRow[] {
  const groups=new Map<string,{first:ValuationCatalogRow;quantityMilli:number}>();
  const seen=new Set<string>();
  for(const row of catalog){
    if(seen.has(row.cursor)) throw new Error('Posición repetida en el inventario.');
    seen.add(row.cursor);
    quantityFromMilli(row.quantity_milli);
    const group=groups.get(row.valuation_id);
    if(group){
      if(['product_id','module_id','unit_id','unit_value','revision'].some(key=>group.first[key as keyof ValuationCatalogRow]!==row[key as keyof ValuationCatalogRow]))
        throw new Error('La misma valoración corresponde a productos o revisiones diferentes. Actualiza el catálogo.');
      group.quantityMilli+=row.quantity_milli;
      quantityFromMilli(group.quantityMilli);
    }else groups.set(row.valuation_id,{first:row,quantityMilli:row.quantity_milli});
  }
  return [...groups].map(([valuationId,{first,quantityMilli}])=>{
    const quantity=quantityFromMilli(quantityMilli),unitValue=first.unit_value??0;
    return {valuationId,productDocumentId:first.entity==='ASSET'?`herramienta-${first.entity_id}`:`${first.product_id}:${first.location_code}`,moduleName:first.module_id==='TALLER'?'TALLER':moduleNames[first.module_id as keyof typeof moduleNames],
      code:first.code,product:first.name,reference:first.reference,quantity,unit:first.unit_id,
      unitValue,totalValue:quantity*unitValue,includesOccupied:first.entity==='ASSET'};
  });
}

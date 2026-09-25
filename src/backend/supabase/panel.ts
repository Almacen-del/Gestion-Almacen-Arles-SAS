import {leerLotesSalidaReporte} from '../../reporteMovimientosExcel';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {InventoryItem,Movement,UserProfile,OccupiedUnitCard} from '../panelModels';
import type {AgrochemicalLot} from '../../agrochemicalLots';
import {assertModule,moduleNames,quantityFromMilli} from './contracts';
import {validateEvidencePath} from './client';
import type {EntryStockMovement,EntryValuationRecord} from '../../valuation/entryValuation';

type Row=Record<string,unknown>;
export interface PanelSnapshot {
  valuationTargets:Record<string,{entity:'POSITION'|'ASSET';entityId:string;revision:number}>;
  entryLotTotals:Record<string,number>;
  toolBalances:Record<string,{total:number;loaned:number;maintenance:number}>;
  occupiedCards:OccupiedUnitCard[];
  readAt:string; inventory:InventoryItem[]; aseo:InventoryItem[]; tools:InventoryItem[];
  movements:Movement[]; lots:AgrochemicalLot[]; users:Record<string,UserProfile>;
  valuations:Record<string,number>;
  entries:EntryStockMovement[]; entryValues:Record<string,EntryValuationRecord>;
}
function object(value:unknown):Row {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Respuesta incompleta del panel.');
  return value as Row;
}
function text(row:Row,key:string){return typeof row[key]==='string'?row[key] as string:'';}
function required(row:Row,key:string){const value=text(row,key);if(!value)throw new Error(`Falta ${key} en el panel.`);return value;}
function rows(value:unknown,key:string):Row[]{
  if(!Array.isArray(value))throw new Error(`Falta la fuente ${key}.`);
  const result=value.map(object),ids=new Set<string>();
  for(const row of result){const id=required(row,key);if(ids.has(id))throw new Error('Registros duplicados en el panel.');ids.add(id);}
  return result;
}
function quantity(row:Row,key:string){return quantityFromMilli(row[key] as number);}
function moduleName(row:Row){const id=required(row,'module_id');assertModule(id);return moduleNames[id];}
function photo(row:Row){const path=text(row,'evidence_path');if(!path)return '';validateEvidencePath(path);return `supabase:${path}`;}
function fields(value:unknown):Row {
  if(!value || typeof value!=='object' || Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).map(([key,raw])=>{
    const v=object(raw);
    return [key,decodeLegacyValue(v)];
  }));
}
function decodeLegacyValue(v:Row):unknown {
 if(v.mapValue)return fields(object(v.mapValue).fields);
 if(v.arrayValue)return ((object(v.arrayValue).values??[]) as unknown[]).map(value=>decodeLegacyValue(object(value)));
 return v.stringValue??v.timestampValue??(v.integerValue!==undefined?Number(v.integerValue):v.doubleValue)??v.booleanValue??null;
}
function firstText(row:Row,...keys:string[]){for(const key of keys){const value=text(row,key);if(value)return value;}return '';}
function details(row:Row):Row{return row.details && typeof row.details==='object'?object(row.details):{};}
function movement(id:string,modulo:string,row:Row,extra:Partial<Movement>):Movement {
  return {id,modulo,tipo:text(row,'kind'),codigo:text(row,'code'),descripcion:text(row,'name'),referencia:text(row,'reference'),
    cantidad:0,unidad:text(row,'unit_id')||'Unidad',fecha:text(row,'occurred_at'),solicitante:text(row,'solicitante')||text(row,'person')||text(row,'recipient'),
    cargo:text(row,'cargo'),usuario:text(row,'operator_name'),observaciones:text(row,'observaciones')||text(row,'notes'),fotoUrl:photo(row),
    ubicacion:firstText(row,'location_code','ubicacion'),zona:firstText(row,'zona_ejecucion','zona'),labor:firstText(row,'tipo_labor','labor','frente','task'),frente:firstText(row,'frente','labor_frente','frente_trabajo'),
    maquinaria:firstText(row,'maquinaria','equipo','maquina','vehiculo','machine'),horometro:firstText(row,'horometro','horómetro','horas','lectura_horometro','meter'),placaSerial:firstText(row,'placa_serial','placaSerial','placa','serial','plate'),
    proveedor:firstText(row,'proveedor','nombre_proveedor'),responsableEntrega:firstText(row,'responsable_entrega','registradoPor'),entregaEntrada:text(row,'responsable_entrega'),usuarioUid:firstText(row,'operator_id','usuario_uid','registrado_por_uid'),destinationLot:firstText(row,'lote_destino','loteDestino','lote_aplicacion','loteAplicacion','destination'),
    lote:firstText(row,'lot','numero_lote','lote','numeroLote'),lotesSalida:leerLotesSalidaReporte(row),fechaVencimiento:firstText(row,'fecha_vencimiento','fechaVencimiento','vencimiento'),monthlyOccurredAt:text(row,'occurred_at')||undefined,...extra};
}

export function parsePanelSnapshot(value:unknown):PanelSnapshot {
  const root=object(value);
  if(root.version!==1 || !Number.isFinite(Date.parse(required(root,'read_at'))))throw new Error('Versión de lectura no válida.');
  const positions=rows(root.positions,'id'),assets=rows(root.assets,'id'),loans=rows(root.loans,'id');
  const inventory=new Map<string,InventoryItem>(),lots:AgrochemicalLot[]=[];
  for(const p of positions){
    const modulo=moduleName(p),product=required(p,'product_id'),location=required(p,'location_code');
    const key=`${product}:${location}`,valuationId=required(p,'valuation_id'),amount=quantity(p,'quantity_milli');
    const current=inventory.get(key);
    if(current){
      if(current.valuationId!==valuationId || current.unidad!==p.unit_id)throw new Error('Identidad de producto inconsistente.');
      current.saldo=Math.round((current.saldo+amount)*1000)/1000;
    }else inventory.set(key,{id:key,valuationId,modulo,codigo:required(p,'code'),descripcion:required(p,'name'),
      referencia:text(p,'reference'),categoria:text(p,'category'),subcategoria:text(p,'category'),unidad:required(p,'unit_id'),saldo:amount,ubicacion:location});
    if(p.lot_id){
      const expiry=p.expiry_year==null?'':`${p.expiry_year}-${String(p.expiry_month).padStart(2,'0')}${p.expiry_day==null?'':`-${String(p.expiry_day).padStart(2,'0')}`}`;
      lots.push({id:required(p,'id'),productDocumentId:key,productCode:required(p,'code'),productName:required(p,'name'),
        lotNumber:required(p,'lot'),expirationDate:expiry,quantity:amount,initialQuantity:amount,unit:required(p,'unit_id'),location,
        receivedAt:text(p,'lot_created_at'),entryAssignments:[]});
    }
  }
  const assetMap=new Map(assets.map(a=>[required(a,'id'),a]));
  const tools:InventoryItem[]=assets.filter(a=>a.active===true).map(a=>{
    const total=quantity(a,'total_milli'),occupied=quantity(a,'loaned_milli'),maintenance=quantity(a,'maintenance_milli');
    if(occupied+maintenance>total)throw new Error('Saldo de Taller inconsistente.');
    const id=required(a,'id'),meta=a.metadata?object(a.metadata):{};
    return {id:`herramienta-${id}`,valuationId:required(a,'valuation_id'),modulo:'TALLER',codigo:required(a,'code'),descripcion:required(a,'name'),
      referencia:[text(meta,'category'),text(meta,'size'),text(meta,'brand')].filter(Boolean).join(' - '),marca:text(meta,'brand'),caracteristica:text(meta,'size'),categoria:required(a,'section'),subcategoria:text(meta,'category')||required(a,'section'),unidad:required(a,'unit'),saldo:total-occupied-maintenance,total,
      ocupados:occupied,estado:maintenance>0?'Mantenimiento':'Bueno',codigoQr:text(a,'qr'),requiereQr:!a.qr,
      responsable:[...new Set(loans.filter(l=>l.asset_id===id).map(l=>text(l,'person')))].join(', ')} satisfies InventoryItem;
  });
  const occupiedCards:OccupiedUnitCard[]=loans.flatMap(loan=>{
    const tool=tools.find(t=>t.id===`herramienta-${loan.asset_id}`);
    if(!tool)return [];
    const count=quantity(loan,'quantity_milli')-quantity(loan,'returned_milli');
    if(!Number.isInteger(count))throw Error('Un préstamo fraccionado requiere revisión antes de mostrar unidades.');
    return Array.from({length:count},(_,index)=>({id:`${loan.id}:${index}`,submodulo:tool.categoria,codigo:tool.codigoQr||tool.codigo,descripcion:tool.descripcion,subcategoria:tool.subcategoria,caracteristica:tool.caracteristica,solicitante:required(loan,'person'),unitIndex:index+1,unitTotal:count}));
  });
  const movements:Movement[]=rows(root.movements,'id').map(m=>movement(`warehouse:${m.id}`,moduleName(m),{...m,...details(m)},
    {cantidad:quantity(m,'quantity_milli'),productDocumentId:`${required(m,'product_id')}:${required(m,'location_code')}`,
      stockBefore:quantity(m,'stock_before_milli'),stockAfter:quantity(m,'stock_after_milli')}));
  for(const h of rows(root.history,'source_path')){
    if(h.quantity!==null && (typeof h.quantity!=='number' || !Number.isFinite(h.quantity)))throw new Error('Cantidad histórica no válida.');
    const original=fields(h.original_fields);
    const candidates=[...inventory.values()].filter(p=>p.id.startsWith(`${text(h,'product_id')}:`));
    const matched=candidates.length===1?candidates[0]:candidates.find(p=>p.ubicacion===text(original,'ubicacion'));
    movements.push(movement(`legacy:${String(h.source_path).replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//,'')}`,moduleName(h),{...original,...h}, {
      productDocumentId:matched?.id,documentId:firstText(original,'documento_id','producto_id'),
      tipo:required(h,'kind_original'),codigo:required(h,'display_code'),descripcion:text(h,'product_name'),
      cantidad:h.quantity===null?0:h.quantity as number,unidad:text(h,'unit_original'),fecha:text(h,'occurred_at')||text(h,'date_original'),
      solicitante:text(h,'recipient'),observaciones:[text(original,'observaciones'),h.quantity===null?'Cantidad no registrada en el origen.':''].filter(Boolean).join(' '),
      stockBefore:typeof original.stock_anterior==='number'?original.stock_anterior:undefined,
      stockAfter:typeof original.stock_nuevo==='number'?original.stock_nuevo:undefined,
    }));
  }
  for(const h of rows(root.workshop_history,'source_path')) movements.push(movement(`legacy:${String(h.source_path).replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//,'')}`,'TALLER',h,{
    descripcion:text(h,'item'),cantidad:quantity(h,'quantity_milli'),fecha:text(h,'occurred_at')||text(h,'original_date'),submodulo:required(h,'section'),
  }));
  const kinds:Record<string,string>={LOAN:'Prestamo',VEHICLE:'Salida',RETURN:'Devolucion',INPUT:'Entrada',EXIT:'Salida',TRANSFER:'Traslado',MAINTENANCE:'Mantenimiento',CREATE:'Entrada',EXTEND:'Prorroga',MARK_CONSUMABLE:'Clasificacion'};
  for(const op of rows(root.workshop_operations,'id')){
    const result=object(op.result),payload=object(op.payload),kind=required(result,'kind');
    if(!kinds[kind])throw new Error('Operación de Taller no reconocida.');
    const lines=Array.isArray(result.lines)?result.lines.map(object):[result];
    for(const [index,line] of lines.entries()){
      const asset=assetMap.get(text(line,'asset_id'));
      if(!asset && kind!=='EXTEND')throw new Error('Operación sin activo de Taller.');
      movements.push(movement(`workshop:${op.id}:${index}`,'TALLER',{...payload,...result,operator_name:payload.imported_operator_name??op.operator_name},
        {tipo:kinds[kind],codigo:asset?text(asset,'code'):'',descripcion:asset?text(asset,'name'):'Prórroga de préstamo',
          submodulo:asset?text(asset,'section'):'',cantidad:quantity(line,'quantity_milli'),fecha:required(op,'created_at'),monthlyOccurredAt:required(op,'created_at'),
          unidad:asset?text(asset,'unit'):'Unidad'}));
    }
  }
  const valuations:Record<string,number>={};
  for(const v of rows(root.valuations,'id')){
    if(typeof v.unit_value!=='number' || !Number.isFinite(v.unit_value) || v.unit_value<0)throw new Error('Precio inválido.');
    valuations[required(v,'id')]=v.unit_value;
  }
  const users:Record<string,UserProfile>={};
  for(const h of rows(root.historical_profiles??[],'id')){const original=fields(Object.fromEntries(Object.entries(object(h.fields)).filter(([,v])=>v!==null)));const id=required(h,'id');users[id]={id,nombre:firstText(original,'nombre','nombres'),cargo:text(original,'cargo'),email:text(original,'email'),rol:'lector',estado:'histórico',activo:false};}
  for(const u of rows(root.profiles,'user_id')){
    const id=required(u,'user_id'),profile:UserProfile={id,nombre:required(u,'display_name'),cargo:text(u,'job_title'),email:text(u,'email'),manageable:true,mobileActive:u.mobile_active===true,mobileRole:text(u,'mobile_role'),emailConfirmed:u.email_confirmed===true,
      rol:u.role==='ADMIN'?'admin':u.role==='MANAGER'?'almacenista':'lector',estado:u.approved===false?'pendiente':u.active?'activo':'inactivo',activo:u.active===true};
    users[id]=profile;if(u.legacy_uid)users[required(u,'legacy_uid')]=profile;
  }
  const valuationTargets:PanelSnapshot['valuationTargets']={};
  const versions=new Map(rows(root.valuations,'id').map(v=>[text(v,'id'),Number(v.revision)||0]));
  for(const p of positions)valuationTargets[text(p,'valuation_id')]={entity:'POSITION',entityId:text(p,'id'),revision:versions.get(text(p,'valuation_id'))??0};
  const toolBalances:PanelSnapshot['toolBalances']={};
  for(const a of assets.filter(a=>a.active===true)){valuationTargets[text(a,'valuation_id')]={entity:'ASSET',entityId:text(a,'id'),revision:versions.get(text(a,'valuation_id'))??0};toolBalances[text(a,'id')]={total:quantity(a,'total_milli')*1000,loaned:quantity(a,'loaned_milli')*1000,maintenance:quantity(a,'maintenance_milli')*1000};}
  const entryLotTotals=Object.fromEntries(rows(root.entry_lot_totals??[],'movement_id').map(r=>[required(r,'movement_id'),quantity(r,'quantity_milli')]));
  const all=[...inventory.values()];
  return {entryLotTotals,valuationTargets,toolBalances,occupiedCards,readAt:required(root,'read_at'),inventory:all.filter(i=>i.modulo!=='ASEO'),aseo:all.filter(i=>i.modulo==='ASEO'),tools,movements,lots,users,valuations,entries:[],entryValues:{}};
}

export async function loadPanelSnapshot(client:Pick<SupabaseClient,'rpc'>):Promise<PanelSnapshot>{
  const {data,error}=await client.rpc('web_panel_snapshot');
  if(error)throw new Error(error.code==='42501'?'Tu usuario no tiene acceso al panel.':'No se pudo cargar la lectura completa del panel.');
  return parsePanelSnapshot(data);
}

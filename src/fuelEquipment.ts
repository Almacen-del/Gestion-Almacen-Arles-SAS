import type {Movement} from './backend/panelModels';
import {fuelDateSerial,fuelTypeForReport} from './fuelDeliveryReport';
export type FleetIdentity={key:string;label:string;unit:'h'|'km'|null;identified:boolean};
// Current fleet and historical aliases confirmed by the warehouse operator on 2026-09-25.
export const currentFuelFleet: FleetIdentity[]=[
 {key:'Camioneta:221',label:'Camioneta blanca 221',unit:'km',identified:true},
 ...['21G','32H','46H'].map(id=>({key:`Moto:${id}`,label:`Moto ${id}`,unit:'km' as const,identified:true})),
 ...[1,3].map(id=>({key:`tractor:${id}`,label:`Tractor ${id}`,unit:'h' as const,identified:true})),
 {key:'plant:roja',label:'Planta roja',unit:'h',identified:true},
];

const norm=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').trim().toLowerCase().replace(/\s+/g,' ');
export function fuelEquipment(m:Pick<Movement,'maquinaria'|'placaSerial'>):FleetIdentity {
 const name=norm(m.maquinaria||''),plate=norm(m.placaSerial||''),combined=`${name} ${plate}`;
 const unknown=()=>({key:`review:${name}|${plate}`,label:[m.maquinaria||'Sin equipo',m.placaSerial].filter(Boolean).join(' · '),unit:null,identified:false} as FleetIdentity);
 if(/\by\b|[;/&]/.test(combined))return unknown();
 if(/\b(tractor|jhon deere|john deere|jonh deere|jd)\b/.test(name)) {
  const plateNumber=plate.match(/^#?\s*(\d+)$/)?.[1],nameNumber=name.match(/(?:tractor|deere|jd)\s*#?\s*(\d+)$/)?.[1];
  if(plateNumber&&nameNumber&&Number(plateNumber)!==Number(nameNumber))return unknown();
  const n=plateNumber||nameNumber;
  if(n)return {key:`tractor:${Number(n)}`,label:`Tractor ${Number(n)}`,unit:'h',identified:true};
 }
 if(/\b(planta|generador)\b/.test(name)) {
  const colors=[...combined.matchAll(/\b(roj[oa]|blanc[oa]|azul|verde|amarill[oa]|negr[oa])\b/g)].map(x=>x[1].replace(/o$/,'a'));
  const unique=[...new Set(colors)];if(unique.length===1)return {key:`plant:${unique[0]}`,label:`Planta ${unique[0]}`,unit:'h',identified:true};
 }
 if(name==='camioneta blanca'&&!plate)return currentFuelFleet[0];
 const type=/\bcamioneta\b/.test(name)?'Camioneta':/\bmoto\b/.test(name)?'Moto':null;
 if(type){
  const rawPlate=plate.toUpperCase().replace(/\s/g,'');
  const cleaned=type==='Moto'&&['H46','J46'].includes(rawPlate)?'46H':rawPlate;
  const valid=type==='Moto'?/^(?:[A-Z]{3})?\d{2}[A-Z]$/.test(cleaned):/^(?:[A-Z]{3})?\d{3}$/.test(cleaned);
  if(valid){const suffix=cleaned.slice(-3);return {key:`${type}:${suffix}`,label:type==='Camioneta'&&suffix==='221'?'Camioneta blanca 221':`${type} ${suffix}`,unit:'km',identified:true};}
 }
 return unknown();
}
export function isGallons(unit:string){return /^(gal|galon|galones|gallon|gallons)$/.test(norm(unit));}
export function meterReading(raw:string|undefined):number|null {
 const value=(raw||'').trim();if(!/^\d+(?:[.,]\d+)?$/.test(value))return null;
 const result=Number(value.replace(',','.'));return Number.isFinite(result)&&result>=0?result:null;
}
export const FUEL_CONTROL_START='2026-09-25';
export type FleetRow={movement:Movement;equipment:FleetIdentity;fuel:'ACPM'|'Gasolina';day:string;instant:number;reading:number|null;delta:number|null;previousDay:string|null;warning:string;historical?:boolean};
export function fleetRows(movements:Movement[],controlStart=FUEL_CONTROL_START):FleetRow[]{
 const seen=new Set<string>();const rows:FleetRow[]=[];
 for(const m of movements){
  if(seen.has(m.id)||m.hiddenFromOperationalHistory||!/^salida$/i.test(m.tipo.trim()))continue;seen.add(m.id);
  const fuel=fuelTypeForReport(m);if(!fuel)continue;
  let day='';let instant=0;try {const serial=fuelDateSerial(m.fecha);const utc=(serial-25569)*86400000;day=new Date(utc).toISOString().slice(0,10);instant=/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(m.fecha)?Date.parse(m.fecha):utc+5*3600000;}catch{ /* Keep undated history visible for review. */ }
  const equipment=fuelEquipment(m),reading=meterReading(m.horometro);
  rows.push({movement:m,equipment,fuel,day,instant,reading,delta:null,previousDay:null,warning:!day?'Fecha por revisar':!isGallons(m.unidad)?'Unidad por revisar: no incluida en total de galones':!Number.isFinite(m.cantidad)||m.cantidad<=0?'Cantidad por revisar':!equipment.identified?'Identificación por revisar':reading===null?(m.horometro?.trim()?'Lectura por revisar':'Sin lectura'):''});
 }
 rows.sort((a,b)=>a.instant-b.instant||a.movement.id.localeCompare(b.movement.id));
 const previous=new Map<string,FleetRow>();
 for(const row of rows){
  if(row.day&&row.day<controlStart){row.historical=true;row.warning='';continue;}
  if(!row.day||!row.equipment.identified||row.reading===null)continue;
  const prior=previous.get(row.equipment.key);
  if(prior){
   row.previousDay=prior.day;const delta=row.reading-prior.reading!;
   if(row.instant===prior.instant){row.warning='Lecturas con la misma fecha y hora: revisar orden';continue;}
   if(delta<0){row.warning='Lectura menor a la anterior: revisar error o cambio de contador';continue;}
   if(row.equipment.unit==='h'&&delta>(row.instant-prior.instant)/3600000+1){row.warning='Horas superiores al tiempo transcurrido: revisar lectura';continue;}
   row.delta=Math.round(delta*1000)/1000;
  }
  previous.set(row.equipment.key,row);
 }
 return rows;
}

import {FUEL_CONTROL_START,isGallons,type FleetRow} from '../fuelEquipment';
const num=(n:number)=>n.toLocaleString('es-CO',{maximumFractionDigits:2});
const iso=(d:Date)=>d.toISOString().slice(0,10);
export function fuelPeriodSummary(rows:FleetRow[],start:string,end:string,today:string){
 if(!start||!end||start>end)return [];
 const months=[];
 for(let date=new Date(`${start.slice(0,7)}-01T12:00:00Z`);iso(date)<=end;date.setUTCMonth(date.getUTCMonth()+1)){
  const first=iso(date),last=iso(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12)));
  const deliveries=rows.filter(r=>r.day>=start&&r.day<=end&&r.day.slice(0,7)===first.slice(0,7)&&isGallons(r.movement.unidad)&&Number.isFinite(r.movement.cantidad)&&r.movement.cantidad>0);
  const total=(fuel:string)=>deliveries.filter(r=>r.fuel===fuel).reduce((n,r)=>n+r.movement.cantidad,0);
  months.push({month:first.slice(0,7),quarter:`${date.getUTCFullYear()} · T${Math.floor(date.getUTCMonth()/3)+1}`,complete:first>=start&&last<=end&&last<today,acpm:total('ACPM'),gasoline:total('Gasolina')});
 }
 return months;
}
export default function FuelPeriodSummary({rows,stageRows,scope,from,to}:{rows:FleetRow[];stageRows:FleetRow[];scope:string;from:string;to:string}){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const earliest=stageRows.map(r=>r.day).filter(Boolean).sort()[0]||'';
 const stageStart=scope==='history'?earliest:FUEL_CONTROL_START;
 const stageEnd=scope==='history'?'2026-09-24':today;
 const start=from&&from>stageStart?from:stageStart,end=to&&to<stageEnd?to:stageEnd;
 const months=fuelPeriodSummary(rows,stageStart?start:'',end,today),complete=months.filter(m=>m.complete);
 const sum=(items:typeof months,key:'acpm'|'gasoline')=>items.reduce((n,m)=>n+m[key],0);
 const quarters=[...new Set(months.map(m=>m.quarter))];
 return <section className="fuel-chart fuel-period-summary" aria-label="Resumen mensual y trimestral"><h3>{scope==='history'?'Histórico orientativo':'Nueva etapa'} · Resumen mensual y trimestral</h3>
 <p>Galones entregados al equipo seleccionado o a toda la flota. Promedios basados únicamente en meses calendario completos dentro del periodo; los meses parciales se excluyen. Los meses completos sin entregas cuentan como cero.</p>
 {scope==='history'&&<p>Información histórica orientativa, desde el primer registro disponible; no certifica que el archivo esté completo y no utiliza los horómetros antiguos.</p>}
 <div className="fuel-equipment-summary"><span><b>{complete.length?num(sum(complete,'acpm')/complete.length)+' gal/mes':'Pendiente'}</b>Promedio mensual ACPM</span><span><b>{complete.length?num(sum(complete,'gasoline')/complete.length)+' gal/mes':'Pendiente'}</b>Promedio mensual gasolina</span><span><b>{complete.length}</b>meses completos utilizados</span></div>
 {!months.length?<p>Sin periodo disponible para estos filtros.</p>:<><div className="fuel-period-table"><table><caption>Totales mensuales</caption><thead><tr><th>Mes</th><th>ACPM (gal)</th><th>Gasolina (gal)</th><th>Periodo</th></tr></thead><tbody>{months.map(m=><tr key={m.month}><td>{m.month}</td><td>{num(m.acpm)}</td><td>{num(m.gasoline)}</td><td>{m.complete?'Completo':'Parcial'}</td></tr>)}</tbody></table></div>
 <div className="fuel-period-table"><table><caption>Trimestres calendario y promedio mensual</caption><thead><tr><th>Trimestre</th><th>ACPM (gal)</th><th>Gasolina (gal)</th><th>Promedio ACPM (gal/mes)</th><th>Promedio gasolina (gal/mes)</th><th>Base del promedio</th></tr></thead><tbody>{quarters.map(q=>{const all=months.filter(m=>m.quarter===q),full=all.filter(m=>m.complete);return <tr key={q}><td>{q} · {full.length===3?'Completo':'Parcial'}</td><td>{num(sum(all,'acpm'))}</td><td>{num(sum(all,'gasoline'))}</td><td>{full.length?num(sum(full,'acpm')/full.length):'Pendiente'}</td><td>{full.length?num(sum(full,'gasoline')/full.length):'Pendiente'}</td><td>{full.length} meses completos</td></tr>;})}</tbody></table></div><p>El total trimestral incluye las entregas de los meses parciales; su promedio mensual solo usa los meses completos. No se proyectan cantidades ni se calcula consumo real con estas cifras.</p></>}
 </section>;
}

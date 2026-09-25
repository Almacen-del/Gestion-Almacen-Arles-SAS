import {useMemo,useState} from 'react';
import {currentFuelFleet,isGallons,type FleetRow} from '../fuelEquipment';
const num=(n:number)=>n.toLocaleString('es-CO',{maximumFractionDigits:2});
export function fuelPeriod(day:string,mode:string){
 if(mode==='month')return day.slice(0,7);
 if(mode==='week'){const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
 return day;
}
export function fuelSeries(rows:FleetRow[],mode:string){
 const groups=new Map<string,{label:string;acpm:number;gasoline:number}>();
 for(const r of rows){if(!r.day||!isGallons(r.movement.unidad)||!Number.isFinite(r.movement.cantidad)||r.movement.cantidad<=0)continue;
  const key=fuelPeriod(r.day,mode),item=groups.get(key)||{label:key,acpm:0,gasoline:0};
  if(r.fuel==='ACPM')item.acpm+=r.movement.cantidad;else item.gasoline+=r.movement.cantidad;groups.set(key,item);
 }
 return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
function DeliveryBars({items,title}:{items:{label:string;acpm:number;gasoline:number}[];title:string}){
 const max=Math.max(1,...items.map(x=>x.acpm+x.gasoline));
 return <section className="fuel-chart" aria-label={title}><h3>{title}</h3><div className="fuel-chart-legend"><span>🟩 ACPM</span><span>🟦 Gasolina</span><span>Escala: 0–{num(max)} gal</span></div>
 {!items.length?<p>Sin entregas registradas para estos filtros.</p>:<div className="fuel-delivery-bars">{items.map(item=><div className="fuel-delivery-row" key={item.label}><span>{item.label}</span><div className="fuel-delivery-track" role="img" aria-label={`${item.label}: ACPM ${num(item.acpm)} gal; Gasolina ${num(item.gasoline)} gal`}>
 {item.acpm>0&&<span className="acpm" style={{width:`${100*item.acpm/max}%`}} title={`${num(item.acpm)} gal ACPM`}/>}{item.gasoline>0&&<span className="gasoline" style={{width:`${100*item.gasoline/max}%`}} title={`${num(item.gasoline)} gal Gasolina`}/>}</div><b>{num(item.acpm+item.gasoline)} gal</b></div>)}</div>}
 </section>;
}
function MeterChart({rows,equipment}:{rows:FleetRow[];equipment:string}){
 const group=currentFuelFleet.find(g=>g.key===equipment)!;
 const points=rows.filter(r=>r.day&&r.reading!==null).sort((a,b)=>a.instant-b.instant);
 const values=points.map(r=>r.reading!);const min=Math.min(...values),max=Math.max(...values),padding=Math.max((max-min)*.1,1);
 const low=Math.max(0,min-padding),high=max+padding;
 const start=points[0]?.instant??0,end=points.at(-1)?.instant??start;
 const x=(r:FleetRow)=>end===start?330:70+((r.instant-start)/(end-start))*520;
 const y=(r:FleetRow)=>170-(r.reading!-low)/(high-low)*135;
 return <section className="fuel-chart" aria-label="Evolución del contador"><h3>{group.unit==='h'?'Horómetro':'Kilometraje'} · {group.label}</h3>
 {!points.length?<p>Sin lecturas registradas. La gráfica comenzará con la primera lectura; no se dibujan ceros.</p>:<><svg viewBox="0 0 660 215" role="img" aria-label={`${group.label}: ${points.length} lecturas en ${group.unit}`}>
 {[0,.5,1].map(f=><g key={f}><line x1="70" x2="610" y1={170-f*135} y2={170-f*135} stroke="#dce7de"/><text x="62" y={174-f*135} textAnchor="end">{num(low+f*(high-low))}</text></g>)}
 {points.map((r,i)=><g key={r.movement.id}>{i>0&&!r.warning&&!points[i-1].warning&&<line x1={x(points[i-1])} x2={x(r)} y1={y(points[i-1])} y2={y(r)} stroke="#157f55" strokeWidth="2" strokeDasharray="4 3"/>}<circle cx={x(r)} cy={y(r)} r="5" fill={r.warning?'#bc3d24':'#157f55'}><title>{r.day} · {num(r.reading!)} {group.unit}{r.warning?` · ${r.warning}`:''}</title></circle></g>)}
 <text x="70" y="199">{points[0].day}</text>{points.length>1&&<text x="610" y="199" textAnchor="end">{points.at(-1)!.day}</text>}
 </svg><p>Puntos: lecturas originales. Rojo: requiere revisión. Las líneas discontinuas unen lecturas; no representan mediciones continuas.</p></>}
 </section>;
}
export default function FuelEquipmentCharts({rows,equipment}:{rows:FleetRow[];equipment:string}){
 const [mode,setMode]=useState('day');const series=useMemo(()=>fuelSeries(rows,mode),[rows,mode]);
 const comparison=currentFuelFleet.map(g=>{const totals=fuelSeries(rows.filter(r=>r.equipment.key===g.key),'month');return {label:g.label,acpm:totals.reduce((n,x)=>n+x.acpm,0),gasoline:totals.reduce((n,x)=>n+x.gasoline,0)};});
 return <section className="fuel-charts" aria-label="Gráficas de maquinaria"><label>Agrupar entregas<select value={mode} onChange={e=>setMode(e.target.value)}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></label>
 <p>Las gráficas respetan el equipo y las fechas seleccionados. {mode==='week'?'Cada semana comienza el lunes. ':''}Se muestran galones entregados, no rendimiento ni consumo medido. Los periodos sin registros se omiten.</p>
 <div className="fuel-charts-grid"><DeliveryBars items={series} title={`Entregas por ${mode==='day'?'día':mode==='week'?'semana':'mes'}`}/>{equipment?<MeterChart rows={rows} equipment={equipment}/>:<DeliveryBars items={comparison} title="Combustible entregado por equipo"/>}</div>
 {!equipment&&<p>Selecciona un equipo para ver la evolución de su horómetro o kilometraje. Las horas y los kilómetros se muestran por separado.</p>}
 </section>;
}

import FuelPeriodSummary from './FuelPeriodSummary';
import FuelEquipmentCharts from './FuelEquipmentCharts';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {Movement} from '../backend/panelModels';
import {fleetRows,isGallons,currentFuelFleet} from '../fuelEquipment';
import './fuelEquipment.css';
const number=(n:number)=>n.toLocaleString('es-CO',{maximumFractionDigits:3});
export default function FuelEquipmentPanel({movements}:{movements:Movement[]}) {
 const [scope,setScope]=useState('current'),[open,setOpen]=useState(false),[equipment,setEquipment]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const modal=useRef<HTMLElement>(null);
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement|null;modal.current?.focus();return ()=>previous?.focus();},[open]);
 const rows=useMemo(()=>fleetRows(movements).filter(r=>currentFuelFleet.some(g=>g.key===r.equipment.key)),[movements]);
 const groups=currentFuelFleet;
 const invalid=!!from&&!!to&&from>to;
 const selected=invalid?[]:rows.filter(r=>(scope==='history'?r.historical:!r.historical)&&(!equipment||r.equipment.key===equipment)&&(!from||!!r.day&&r.day>=from)&&(!to||!!r.day&&r.day<=to));
 const totals=(fuel:string)=>selected.filter(r=>r.fuel===fuel&&isGallons(r.movement.unidad)&&Number.isFinite(r.movement.cantidad)&&r.movement.cantidad>0).reduce((sum,r)=>sum+r.movement.cantidad,0);
 return <>
  <button className="fuel-equipment-open" type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Control por maquinaria · Horómetros y kilometraje</button>
  {open&&<div className="fuel-modal-backdrop"><section className="fuel-equipment fuel-equipment-modal" ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="fuel-equipment-title" onKeyDown={event=>{
   if(event.key==='Escape')setOpen(false);
   if(event.key==='Tab'){const controls=modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)');if(!controls?.length)return;const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  }}><header className="fuel-modal-header"><div><small>COMBUSTIBLES</small><h2 id="fuel-equipment-title">Control por maquinaria</h2></div><button type="button" aria-label="Cerrar control de maquinaria" onClick={()=>setOpen(false)}>✕</button></header><div className="fuel-modal-body"><p>Tractores y plantas: horas. Camioneta y motos: kilómetros. Solo se comparan lecturas de equipos identificados; los registros sin lectura no se convierten en cero.</p>
  <p>Nuevo control desde el 25/09/2026. La primera lectura de cada equipo inicia su nueva base. El historial anterior se conserva sin pendientes y no interviene en los nuevos avances.</p>
  <div className="fuel-equipment-filters">
   <label>Periodo de control<select value={scope} onChange={e=>setScope(e.target.value)}><option value="current">Control desde 25/09/2026</option><option value="history">Historial anterior al 25/09/2026</option></select></label>
   <label>Equipo<select value={equipment} onChange={e=>setEquipment(e.target.value)}><option value="">Los 7 equipos actuales</option>{groups.map(g=><option key={g.key} value={g.key}>{g.label}{g.identified?'':' · Por identificar'}</option>)}</select></label>
   <label>Desde<input type="date" aria-label="Maquinaria desde" value={from} onInput={e=>setFrom(e.currentTarget.value)}/></label>
   <label>Hasta<input type="date" aria-label="Maquinaria hasta" value={to} onInput={e=>setTo(e.currentTarget.value)}/></label>
   <button type="button" onClick={()=>{setFrom('');setTo('');setEquipment('');}}>Limpiar filtros</button>
  </div>
  {invalid&&<p role="alert">La fecha inicial debe ser anterior o igual a la final.</p>}
  <div className="fuel-equipment-summary"><span><b>{number(totals('ACPM'))} gal</b> ACPM entregado</span><span><b>{number(totals('Gasolina'))} gal</b> Gasolina entregada</span><span><b>{selected.filter(r=>r.warning).length}</b> registros por revisar o completar</span></div>
  <p>Los galones entregados no equivalen necesariamente al combustible consumido. El rendimiento requiere abastecimientos comparables de tanque lleno a tanque lleno.</p>
  <p>Solo se incluyen la camioneta blanca 221, las motos 21G/32H/46H, los tractores 1/3 y la planta roja. La camioneta gris, las motos del personal y los registros sin identificación suficiente permanecen en el historial general, fuera de estos totales.</p>
  <FuelPeriodSummary rows={selected} stageRows={rows.filter(r=>scope==='history'?r.historical:!r.historical)} scope={scope} from={from} to={to}/>
  <FuelEquipmentCharts rows={selected} equipment={equipment}/>
  <div className="fuel-equipment-cards">{groups.filter(g=>equipment?g.key===equipment:g.identified).map(g=>{
   const data=selected.filter(r=>r.equipment.key===g.key);
   const latest=[...data].reverse().find(r=>!r.historical&&r.reading!==null&&r.day);
   const validDeltas=data.filter(r=>r.delta!==null);
   return <article key={g.key}><h3>{g.label}</h3><p>{g.unit==='h'?'Horómetro':g.unit==='km'?'Kilometraje':'Identificación pendiente'} · {data.length} abastecimientos</p><strong>{latest?`${number(latest.reading!)} ${g.unit||''}`:'Sin lectura registrada'}</strong><small>Última lectura del periodo{latest?` · ${latest.day}`:''}{latest?.warning?' · Requiere revisión':''}</small><p>{validDeltas.length?`${number(validDeltas.reduce((sum,r)=>sum+r.delta!,0))} ${g.unit} de diferencia acumulada entre lecturas comparables`:'Sin intervalo comparable'}</p>{data.some(r=>r.previousDay&&from&&r.previousDay<from)&&<small>Incluye un intervalo iniciado antes del filtro.</small>}<button type="button" onClick={()=>setEquipment(g.key)}>Ver historial de {g.label}</button></article>;
  })}</div>
  <h3>Historial por equipo · {selected.length} abastecimientos</h3>
  {!selected.length&&<p>No hay abastecimientos para estos filtros.</p>}
  <ul className="fuel-equipment-history">{[...selected].reverse().map(r=><li key={r.movement.id}><strong>{r.day||'Sin fecha'} · {r.equipment.label}</strong><span>{number(r.movement.cantidad)} {r.movement.unidad} · {r.fuel} · {r.movement.solicitante||'Sin receptor'}</span><span>Lectura: {r.reading===null?(r.movement.horometro||'No registrada'):`${number(r.reading)} ${r.equipment.unit||''}`}{r.delta!==null?` · Avance: ${number(r.delta)} ${r.equipment.unit} desde ${r.previousDay}`:''}</span>{r.historical&&<small>Histórico · Fuera del nuevo control</small>}{r.warning&&<small className="fuel-equipment-warning">{r.warning}</small>}{r.movement.observaciones&&<small>{r.movement.observaciones}</small>}</li>)}</ul>
  </div></section></div>}
 </>;
}

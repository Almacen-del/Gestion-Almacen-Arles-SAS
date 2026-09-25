import ExcelJS from 'exceljs';
import {currentFuelFleet,FUEL_CONTROL_START,isGallons,type FleetRow} from '../fuelEquipment';
import {fuelPeriodSummary} from '../ui/FuelPeriodSummary';
import {downloadExcelFile} from './browserPlatform';
export type FuelExportOptions={rows:FleetRow[];scope:string;from:string;to:string;today?:string};
const green='145C3A',light='EDF5EF',numberFormat='#,##0.00;[Red]-#,##0.00;0.00';
export async function buildFuelEquipmentWorkbook({rows,scope,from,to,today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date())}:FuelExportOptions){
 if(from&&to&&from>to)throw new Error('Revisa el intervalo de fechas.');
 const historical=scope==='history';
 const stage=rows.filter(r=>currentFuelFleet.some(g=>g.key===r.equipment.key)&&(historical?r.historical:!r.historical));
 const first=historical?stage.map(r=>r.day).filter(Boolean).sort()[0]||'':FUEL_CONTROL_START;
 const start=from&&from>first?from:first,limit=historical?'2026-09-24':today,end=to&&to<limit?to:limit;
 const selected=stage.filter(r=>(!from||r.day>=from)&&(!to||r.day<=to)&&(!r.day||r.day<=limit));
 const book=new ExcelJS.Workbook();book.creator='ARLES S.A.S.';book.title='Control de combustible por maquinaria';book.subject=historical?'Histórico orientativo':'Nueva etapa';
 const total=(data:FleetRow[],fuel:string)=>data.filter(r=>r.fuel===fuel&&isGallons(r.movement.unidad)&&Number.isFinite(r.movement.cantidad)&&r.movement.cantidad>0).reduce((n,r)=>n+r.movement.cantidad,0);
 function sheet(name:string,data:FleetRow[],general=false){
  const ws=book.addWorksheet(name,{views:[{state:'frozen',ySplit:5,showGridLines:false}],properties:{tabColor:{argb:green}},pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
  ws.columns=[{width:23},{width:23},{width:20},{width:21},{width:22},{width:24},{width:24},{width:38}];
  function band(title:string,color=green){const row=ws.addRow([title]);ws.mergeCells(row.number,1,row.number,8);row.height=27;row.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:color}};row.getCell(1).font={name:'Arial',size:12,bold:true,color:{argb:'FFFFFF'}};return row;}
  function note(text:string){const r=ws.addRow([text]);ws.mergeCells(r.number,1,r.number,8);r.height=32;r.getCell(1).alignment={wrapText:true,vertical:'middle'};return r;}
  function table(headers:string[],values:(string|number|Date|null)[][]){const head=ws.addRow(headers);head.height=32;head.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:green}};c.font={name:'Arial',size:10,bold:true,color:{argb:'FFFFFF'}};c.alignment={wrapText:true,vertical:'middle',horizontal:'center'};});
   for(const [index,valuesRow] of values.entries()){const r=ws.addRow(valuesRow);r.height=32;r.eachCell(c=>{c.font={name:'Arial',size:10,color:{argb:'183B2B'}};c.alignment={wrapText:true,vertical:'middle',horizontal:typeof c.value==='number'?'right':'left'};if(index%2===0)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:light}};if(typeof c.value==='number')c.numFmt=numberFormat;if(c.value instanceof Date)c.numFmt='dd/mm/yyyy';});}return head.number;
  }
  band('ARLES S.A.S. · CONTROL DE COMBUSTIBLE');
  note(`${name} | ${historical?'Histórico orientativo':'Nueva etapa desde 25/09/2026'}`);
  note(`Periodo: ${first?start:'Sin fecha inicial disponible'} a ${end} | Fecha de corte: ${today} (Colombia)`);
  note('Reporte de galones entregados, no consumo medido. Valores al momento de exportar. Incluye los 7 equipos actuales; filtro de equipo de pantalla no aplicado.');
  note('Promedios: solo meses calendario completos del periodo. Meses completos sin entregas = 0; parciales excluidos del promedio.');
  band('RESUMEN');table(['ACPM entregado (gal)','Gasolina entregada (gal)','Registros','Lecturas pendientes'],[[total(data,'ACPM'),total(data,'Gasolina'),data.length,data.filter(r=>r.warning).length]]);
  const months=fuelPeriodSummary(data,first?start:'',end,today),full=months.filter(m=>m.complete);
  const sum=(items:typeof months,key:'acpm'|'gasoline')=>items.reduce((n,m)=>n+m[key],0);
  table(['Promedio ACPM (gal/mes)','Promedio gasolina (gal/mes)','Meses completos'],[[full.length?sum(full,'acpm')/full.length:'Pendiente',full.length?sum(full,'gasoline')/full.length:'Pendiente',full.length]]);
  ws.addRow([]);band('TOTALES MENSUALES');table(['Mes','ACPM (gal)','Gasolina (gal)','Periodo'],months.map(m=>[m.month,m.acpm,m.gasoline,m.complete?'Completo':'Parcial']));
  ws.addRow([]);band('TRIMESTRES CALENDARIO');table(['Trimestre','ACPM (gal)','Gasolina (gal)','Promedio ACPM (gal/mes)','Promedio gasolina (gal/mes)','Meses completos','Periodo'],[...new Set(months.map(m=>m.quarter))].map(q=>{const all=months.filter(m=>m.quarter===q),complete=all.filter(m=>m.complete);return [q,sum(all,'acpm'),sum(all,'gasoline'),complete.length?sum(complete,'acpm')/complete.length:'Pendiente',complete.length?sum(complete,'gasoline')/complete.length:'Pendiente',complete.length,complete.length===3?'Completo':'Parcial'];}));
  note('El total trimestral incluye los meses parciales; el promedio solo incluye meses completos. El histórico es orientativo y no valida la integridad del archivo.');
  if(general){ws.addRow([]);band('DISTRIBUCIÓN POR MAQUINARIA');table(['Equipo','ACPM (gal)','Gasolina (gal)','Registros'],currentFuelFleet.map(g=>{const items=data.filter(r=>r.equipment.key===g.key);return [g.label,total(items,'ACPM'),total(items,'Gasolina'),items.length];}));note('Consulte cada hoja de maquinaria para ver sus entregas, destinatarios y lecturas originales.');}
  else {ws.addRow([]);band('HISTORIAL DE ENTREGAS');const header=table(['Fecha','Combustible','Cantidad original','Unidad','Destinatario','Lectura original','Avance del contador','Estado / Observaciones'],data.map(r=>[r.day?new Date(`${r.day}T12:00:00Z`):'Sin fecha',r.fuel,Number.isFinite(r.movement.cantidad)?r.movement.cantidad:null,r.movement.unidad,r.movement.solicitante||'',r.reading===null?(r.movement.horometro||'No registrada'):`${r.reading} ${r.equipment.unit}`,r.delta===null?'No aplica':`${r.delta} ${r.equipment.unit} desde ${r.previousDay}`,[r.historical?'Histórico sin evaluación':r.warning||'Sin alerta',r.movement.observaciones].filter(Boolean).join(' · ')]));
   if(data.length)ws.autoFilter={from:{row:header,column:1},to:{row:ws.rowCount,column:8}};else note('Sin entregas registradas en el periodo.');
  }
  ws.eachRow(r=>r.eachCell(c=>{if(!c.font)c.font={name:'Arial',size:10};}));ws.pageSetup.printArea=`A1:H${ws.rowCount}`;ws.pageSetup.printTitlesRow='1:5';ws.headerFooter.oddFooter='&LARLES S.A.S. · Combustibles&R&P / &N';
 }
 sheet('General',selected,true);for(const g of currentFuelFleet)sheet(g.label,selected.filter(r=>r.equipment.key===g.key));
 return book;
}
export async function downloadFuelEquipmentWorkbook(options:FuelExportOptions){const book=await buildFuelEquipmentWorkbook(options);const bytes=await book.xlsx.writeBuffer();downloadExcelFile(new Uint8Array(bytes),`ARLES_Combustible_${options.scope==='history'?'Historico':'Nueva_etapa'}_${options.from||'inicio'}_${options.to||'corte'}.xlsx`);}

import ExcelJS from 'exceljs';
import type { ReporteMovimientosPayload, FilaMovimientoExcel } from '../reporteMovimientosExcel';

function movementDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value.trim());
  if (!match) throw new Error('Hay un movimiento EPP sin fecha válida.');
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Hay un movimiento EPP sin fecha válida.');
  return date;
}

export async function exportEppStatic(payload: ReporteMovimientosPayload): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  book.creator = payload.generatedBy;
  book.company = payload.companyName;
  book.title = 'Kardex EPP';
  function sheet(name: string, title: string, columns: string[], widths: number[], note: string) {
    const s = book.addWorksheet(name, {views:[{state:'frozen', ySplit:4}], pageSetup:{orientation:'landscape', paperSize:9, fitToPage:true, fitToWidth:1, fitToHeight:0}});
    s.columns = columns.map((_, i) => ({width:widths[i]}));
    s.mergeCells(1,1,1,columns.length); s.getCell('A1').value = `${payload.companyName} · ${title}`;
    s.getCell('A1').font = {name:'Calibri',size:16,bold:true,color:{argb:'FF14532D'}};
    s.mergeCells(2,1,2,columns.length); s.getCell('A2').value = note; s.getRow(2).height=32;
    s.getCell('A2').alignment={wrapText:true,vertical:'middle'};
    s.getRow(4).values=columns;
    s.getRow(4).eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF15803D'}};c.font={bold:true,color:{argb:'FFFFFFFF'}};});
    s.autoFilter={from:{row:4,column:1},to:{row:4,column:columns.length}};
    s.pageSetup.printTitlesRow='1:4';
    return s;
  }
  const general=sheet('EPP','Existencias actuales',['Código','Producto','Categoría','Unidad','Existencia actual'],[18,58,32,16,22],`Saldo actual de la web al exportar: ${payload.exportDate}. No se calcula a partir de los movimientos del período.`);
  const inventory=payload.categorias.flatMap(category=>category.consolidated.filter(r=>r.saldo_actual!==null).map(r=>({r,category:category.categoryLabel})));
  inventory.sort((a,b)=>a.r.codigo.localeCompare(b.r.codigo,'es',{numeric:true}));
  inventory.forEach(({r,category})=>{
    if(!Number.isFinite(r.saldo_actual)) throw new Error(`Saldo inválido para ${r.codigo}.`);
    general.addRow([r.codigo,r.nombre_producto,category,r.unidad,r.saldo_actual]);
  });
  function movements(name:string, rows:readonly FilaMovimientoExcel[], entry:boolean) {
    const s=sheet(name,entry?'Registro de entradas':'Registro de salidas',['Fecha','Código','Producto','Unidad','Cantidad','Responsable','Observaciones'],[17,18,58,16,16,32,48],`Movimientos: ${payload.periodLabel}. Exportado: ${payload.exportDate}.`);
    const data=rows.filter(r=>(entry?r.cantidad_entrada:r.cantidad_salida)>0).map(r=>({r,date:movementDate(r.fecha)})).sort((a,b)=>a.date.getTime()-b.date.getTime()||a.r.codigo.localeCompare(b.r.codigo,'es',{numeric:true}));
    data.forEach(({r,date})=>{
      const quantity=entry?r.cantidad_entrada:r.cantidad_salida;
      if(!Number.isFinite(quantity)) throw new Error(`Cantidad inválida para ${r.codigo}.`);
      const row=s.addRow([date,r.codigo,r.nombre_producto,r.unidad,quantity,r.responsable,r.observacion]);
      row.getCell(1).numFmt='dd/mm/yyyy';
    });
  }
  movements('R.S',payload.salidasGenerales,false);
  movements('R.E',payload.entradasGenerales,true);
  book.eachSheet(s=>{
    s.eachRow((row,index)=>{if(index<5)return; row.height=30; row.eachCell(c=>{
      c.font={name:'Calibri',size:11};c.alignment={vertical:'middle',wrapText:true};
      if(index%2) c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0FDF4'}};
      if(typeof c.value==='number') c.numFmt='0.###';
    });});
    s.pageSetup.printArea=`A1:${s.getColumn(s.columnCount).letter}${Math.max(4,s.rowCount)}`;
  });
  return new Uint8Array(await book.xlsx.writeBuffer());
}

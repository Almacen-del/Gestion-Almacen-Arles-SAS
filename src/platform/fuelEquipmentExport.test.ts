import {it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {buildFuelEquipmentWorkbook} from './fuelEquipmentExport';
import {fleetRows} from '../fuelEquipment';
import type {Movement} from '../backend/panelModels';
const m=(id:string,date:string,quantity:number,extra:Partial<Movement>={})=>({id,modulo:'Combustible',tipo:'Salida',codigo:'ACPM2',descripcion:'ACPM',referencia:'',cantidad:quantity,unidad:'GALON',fecha:date,solicitante:'=HYPERLINK("https://example.com")',cargo:'',usuario:'',observaciones:'',fotoUrl:'',maquinaria:'tractor',placaSerial:'1',horometro:'',...extra} as Movement);
it('exports eight readable sheets with isolated stages, numeric totals and literal recipient text',async()=>{
 const rows=fleetRows([m('a','2026-07-01',10),m('b','2026-08-01',20),m('new','2026-09-25',99)]);
 const book=await buildFuelEquipmentWorkbook({rows,scope:'history',from:'',to:'',today:'2026-09-25'});
 const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(await book.xlsx.writeBuffer());
 expect(reopened.worksheets).toHaveLength(8);
 const general=reopened.getWorksheet('General')!;expect(general.getCell('A8').value).toBe(30);expect(general.getCell('A10').value).toBe(15);
 const tractor=reopened.getWorksheet('Tractor 1')!;const flat=tractor.getSheetValues().flat(2);
 expect(flat).toContain('=HYPERLINK("https://example.com")');expect(flat).not.toContain(99);expect(tractor.autoFilter).toBeTruthy();expect(tractor.pageSetup.orientation).toBe('landscape');
 expect(reopened.getWorksheet('Moto 21G')!.getSheetValues().flat(2)).toContain('Sin entregas registradas en el periodo.');
 await book.xlsx.writeFile('outputs/fuel-export-preview.xlsx');
});
it('exports current stage and date filters without including the archive',async()=>{
 const rows=fleetRows([m('old','2026-09-24',800),m('a','2026-09-25',10),m('b','2026-09-26',20)]);
 const book=await buildFuelEquipmentWorkbook({rows,scope:'current',from:'2026-09-26',to:'2026-09-26',today:'2026-09-27'});
 expect(book.getWorksheet('General')!.getCell('A8').value).toBe(20);expect(book.getWorksheet('General')!.getCell('A10').value).toBe('Pendiente');
 await expect(buildFuelEquipmentWorkbook({rows,scope:'current',from:'2026-10-01',to:'2026-09-01'})).rejects.toThrow();
});

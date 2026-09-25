import {describe,it,expect} from 'vitest';
import {parsePanelSnapshot} from './panel';
const position={id:'p1',product_id:'product',module_id:'AGROQUIMICOS',code:'FER159',name:'Fertilizante',category:'Fertilizantes',reference:'',unit_id:'KG',location_code:'COP',valuation_id:'existencias__old',quantity_milli:1500,lot_id:null};
function source(){return {version:1,read_at:'2026-09-24T12:00:00Z',positions:[{...position}],assets:[],loans:[],movements:[],history:[],workshop_history:[],workshop_operations:[],valuations:[],profiles:[]};}
describe('existing panel Supabase mapping',()=>{
 it('groups lots within a warehouse and keeps distinct warehouses and prices',()=>{
  const input=source();input.positions.push({...position,id:'p2',quantity_milli:2500},{...position,id:'p3',location_code:'PORTUGUESA',valuation_id:'other'});
  const result=parsePanelSnapshot(input);
  expect(result.inventory).toHaveLength(2);expect(result.inventory[0].saldo).toBe(4);expect(result.inventory[1].saldo).toBe(1.5);
  expect(result.inventory[0].codigo).toBe('FER159');
 });
 it('rejects partial sources and duplicate positions instead of displaying partial balances',()=>{
  const input=source();input.positions.push({...position});expect(()=>parsePanelSnapshot(input)).toThrow('duplicados');
  expect(()=>parsePanelSnapshot({...source(),history:undefined})).toThrow('fuente');
 });
 it('rejects unsafe amounts and conflicting valuation identities',()=>{
  expect(()=>parsePanelSnapshot({...source(),positions:[{...position,quantity_milli:-1}]})).toThrow('Cantidad');
  const input=source();input.positions.push({...position,id:'p2',valuation_id:'wrong'});expect(()=>parsePanelSnapshot(input)).toThrow('Identidad');
 });
 it('preserves fractional movement amounts, stock anchors and private evidence paths',()=>{
  const result=parsePanelSnapshot({...source(),movements:[{...position,id:'m',kind:'SALIDA',operator_name:'Operador',stock_before_milli:2000,stock_after_milli:500,occurred_at:'2026-09-24T12:00:00Z',details:{solicitante:'Persona',evidence_path:'legacy/abc.jpg'}}]});
  expect(result.movements[0]).toMatchObject({cantidad:1.5,stockBefore:2,stockAfter:.5,solicitante:'Persona',fotoUrl:'supabase:legacy/abc.jpg'});
 });
 it('calculates available tools without losing units in maintenance and preserves loan recipients',()=>{
  const result=parsePanelSnapshot({...source(),assets:[{id:'a',active:true,code:'H1',name:'Herramienta',section:'Herramientas Taller',unit:'Unidad',valuation_id:'herramientas__1',total_milli:5000,loaned_milli:2000,maintenance_milli:1000}],loans:[{id:'l',asset_id:'a',person:'Receptor',quantity_milli:2000,returned_milli:0}]});
  expect(result.tools[0]).toMatchObject({total:5,ocupados:2,saldo:2,estado:'Mantenimiento',responsable:'Receptor'});
 });
 it('does not remove historical operations when an asset is inactive',()=>{
  const result=parsePanelSnapshot({...source(),assets:[{id:'a',active:false,code:'H1',name:'Herramienta',section:'Herramientas Taller',unit:'Unidad'}],workshop_operations:[{id:'o',created_at:'2026-09-24T12:00:00Z',payload:{},result:{kind:'RETURN',asset_id:'a',quantity_milli:1000}}]});
  expect(result.tools).toHaveLength(0);expect(result.movements[0]).toMatchObject({codigo:'H1',cantidad:1,tipo:'Devolucion'});
 });
 it('keeps original category and code, and marks unknown historical quantities',()=>{
  const result=parsePanelSnapshot({...source(),history:[{source_path:'movimientos/x',module_id:'EPP',kind_original:'Salida',display_code:'PV01',quantity:null,original_fields:{observaciones:{stringValue:'Original'}}}]});
  expect(result.movements[0].observaciones).toContain('Cantidad no registrada');expect(result.movements[0].codigo).toBe('PV01');
 });
});

it('reads the current mobile fuel fields without losing equipment, readings or recipient',()=>{
 const result=parsePanelSnapshot({...source(),movements:[{...position,module_id:'COMBUSTIBLE',id:'fuel',kind:'SALIDA',operator_name:'Almacen',stock_before_milli:2000,stock_after_milli:500,occurred_at:'2026-09-24T12:00:00Z',details:{machine:'planta eléctrica',plate:'Roja',meter:'16079.3',recipient:'Persona',task:'Energía',destination:'COP'}}]});
 expect(result.movements[0]).toMatchObject({maquinaria:'planta eléctrica',placaSerial:'Roja',horometro:'16079.3',solicitante:'Persona',labor:'Energía',destinationLot:'COP'});
});

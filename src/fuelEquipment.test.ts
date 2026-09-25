import {describe,it,expect} from 'vitest';
import {fuelEquipment,fleetRows,meterReading} from './fuelEquipment';
import type {Movement} from './backend/panelModels';
const movement=(id:string,date:string,reading:string,extra:Partial<Movement>={}):Movement=>({id,modulo:'Combustible',tipo:'Salida',codigo:'ACPM2',descripcion:'ACPM',referencia:'',cantidad:5,unidad:'GALON',fecha:date,solicitante:'Persona',cargo:'',usuario:'Almacén',observaciones:'',fotoUrl:'',maquinaria:'tractor',placaSerial:'#1',horometro:reading,...extra});
describe('equipment identities and meter intervals',()=>{
 it('groups explicit tractor aliases and plate suffixes without mixing uncertain identities',()=>{
  expect(fuelEquipment({maquinaria:'Jhon Deere 1'}).key).toBe(fuelEquipment({maquinaria:'tractor',placaSerial:'#1'}).key);
  expect(fuelEquipment({maquinaria:'moto',placaSerial:'ESJ 46H'}).key).toBe(fuelEquipment({maquinaria:'Moto',placaSerial:'46H'}).key);
  expect(fuelEquipment({maquinaria:'Moto',placaSerial:'H46'}).key).toBe('Moto:46H');
  expect(fuelEquipment({maquinaria:'Moto',placaSerial:'J46'}).key).toBe('Moto:46H');
  expect(fuelEquipment({maquinaria:'Moto y Motofumigadora',placaSerial:'21G'}).identified).toBe(false);
  expect(fuelEquipment({maquinaria:'Moto',placaSerial:'32H y 21G'}).identified).toBe(false);
  expect(fuelEquipment({maquinaria:'camioneta blanca'}).key).toBe('Camioneta:221');
  expect(fuelEquipment({maquinaria:'camioneta',placaSerial:'NZT 875'}).key).not.toBe('Camioneta:221');
  expect(fuelEquipment({maquinaria:'planta eléctrica',placaSerial:'Roja'}).key).toBe(fuelEquipment({maquinaria:'generador rojo'}).key);
 });
 it('retains zero but rejects missing, negative and ambiguous numeric formats',()=>{
  expect(meterReading('0')).toBe(0);expect(meterReading('16079,3')).toBe(16079.3);
  for(const value of ['', '-1','1.234,56','NaN','12 h'])expect(meterReading(value)).toBeNull();
 });
 it('compares independent equipment, skips missing readings and flags physically impossible hours without polluting the next baseline',()=>{
  const rows=fleetRows([movement('a','2026-09-01T12:00:00Z','100'),movement('b','2026-09-02T12:00:00Z',''),movement('c','2026-09-03T12:00:00Z','9000'),movement('d','2026-09-04T12:00:00Z','120'),movement('e','2026-09-05T12:00:00Z','119'),movement('f','2026-09-06T12:00:00Z','125'),movement('g','2026-09-07T12:00:00Z','50',{placaSerial:'#3'})]);
  expect(rows.map(r=>r.delta)).toEqual([null,null,null,20,null,5,null]);expect(rows[2].warning).toContain('tiempo transcurrido');expect(rows[4].warning).toContain('menor');
 });
 it('ignores entries, annulments, duplicates and urea; does not compare tied timestamps',()=>{
  const first=movement('a','2026-09-01T12:00:00Z','1');
  const rows=fleetRows([first,first,movement('b',first.fecha,'2'),movement('c',first.fecha,'3',{tipo:'Entrada'}),movement('d',first.fecha,'3',{descripcion:'Urea'}),movement('e',first.fecha,'3',{hiddenFromOperationalHistory:true})]);
  expect(rows).toHaveLength(2);expect(rows[1].delta).toBeNull();expect(rows[1].warning).toContain('misma fecha');
 });
});

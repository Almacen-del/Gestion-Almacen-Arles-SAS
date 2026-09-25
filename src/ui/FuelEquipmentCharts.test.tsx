// @vitest-environment jsdom
import {it,expect,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {fleetRows} from '../fuelEquipment';
import FuelEquipmentCharts,{fuelPeriod,fuelSeries} from './FuelEquipmentCharts';
import type {Movement} from '../backend/panelModels';
afterEach(cleanup);
const m=(id:string,day:string,quantity:number,reading='',fuel='ACPM'):Movement=>({id,modulo:'Combustible',tipo:'Salida',codigo:'x',descripcion:fuel,referencia:'',cantidad:quantity,unidad:'GALON',fecha:`${day}T12:00:00Z`,solicitante:'Persona',cargo:'',usuario:'',observaciones:'',fotoUrl:'',maquinaria:'tractor',placaSerial:'1',horometro:reading});
it('aggregates actual deliveries by calendar day, Monday week and month without filling gaps',()=>{
 const rows=fleetRows([m('a','2026-09-01',2),m('b','2026-09-01',3,'','Gasolina'),m('c','2026-09-07',4)]);
 expect(fuelPeriod('2026-09-06','week')).toBe('2026-08-31');
 expect(fuelSeries(rows,'day')).toEqual([{label:'2026-09-01',acpm:2,gasoline:3},{label:'2026-09-07',acpm:4,gasoline:0}]);
 expect(fuelSeries(rows,'month')).toEqual([{label:'2026-09',acpm:6,gasoline:3}]);
 expect(fuelSeries(rows,'week')).toHaveLength(2);
});
it('plots original zero and flagged meter values, but never invents missing readings',()=>{
 const rows=fleetRows([m('a','2026-09-01',2,'0'),m('b','2026-09-02',3),m('c','2026-09-03',4,'5000')]);
 const {container}=render(<FuelEquipmentCharts rows={rows} equipment="tractor:1"/>);
 expect(screen.getByRole('img',{name:'Tractor 1: 2 lecturas en h'})).toBeTruthy();
 expect(container.querySelectorAll('circle')).toHaveLength(2);
 expect(container.querySelector('circle[fill="#bc3d24"]')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Agrupar entregas'),{target:{value:'month'}});
 expect(screen.getByRole('region',{name:'Entregas por mes'})).toBeTruthy();
});
it('shows comparison for all equipment and a truthful empty meter chart',()=>{
 const {rerender}=render(<FuelEquipmentCharts rows={[]} equipment=""/>);
 expect(screen.getByRole('region',{name:'Combustible entregado por equipo'})).toBeTruthy();
 rerender(<FuelEquipmentCharts rows={[]} equipment="Moto:21G"/>);
 expect(screen.getByText(/Sin lecturas registradas/)).toBeTruthy();
 expect(screen.queryByRole('img',{name:/lecturas en km/})).toBeNull();
});

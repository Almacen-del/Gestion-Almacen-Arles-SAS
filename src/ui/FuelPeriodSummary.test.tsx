import {it,expect} from 'vitest';
import {fuelPeriodSummary} from './FuelPeriodSummary';
import type {FleetRow} from '../fuelEquipment';
const row=(day:string,quantity:number,fuel='ACPM')=>({day,fuel,movement:{cantidad:quantity,unidad:'GALON'}} as FleetRow);
it('keeps partial totals separate from complete-month averages and fills zero months',()=>{
 const result=fuelPeriodSummary([row('2026-09-25',100),row('2026-10-02',30),row('2026-12-01',12,'Gasolina')],'2026-09-25','2026-12-10','2026-12-10');
 expect(result.map(m=>m.complete)).toEqual([false,true,true,false]);
 expect(result.filter(m=>m.complete).reduce((n,m)=>n+m.acpm,0)/2).toBe(15);
 expect(result[0].quarter).toBe('2026 · T3');expect(result[3].gasoline).toBe(12);
});
it('respects filter boundaries, leap years, current day and excludes invalid quantities',()=>{
 const rows=[row('2028-02-01',4),row('2028-02-29',6),row('2028-02-28',-5)];
 expect(fuelPeriodSummary(rows,'2028-02-01','2028-02-29','2028-03-01')[0]).toMatchObject({complete:true,acpm:10});
 expect(fuelPeriodSummary(rows,'2028-02-02','2028-02-29','2028-03-01')[0]).toMatchObject({complete:false,acpm:6});
 expect(fuelPeriodSummary(rows,'2028-02-01','2028-02-29','2028-02-29')[0].complete).toBe(false);
 expect(fuelPeriodSummary(rows,'2028-03-01','2028-02-29','2028-03-01')).toEqual([]);
});

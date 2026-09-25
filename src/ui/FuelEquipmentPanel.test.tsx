// @vitest-environment jsdom
import {it,expect,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import FuelEquipmentPanel from './FuelEquipmentPanel';
import type {Movement} from '../backend/panelModels';
afterEach(cleanup);
it('shows missing mileage without zero and filters real deliveries by date',()=>{
 const m={id:'1',modulo:'Combustible',tipo:'Salida',codigo:'GAS1',descripcion:'Gasolina',referencia:'',cantidad:3,unidad:'GALON',fecha:'2026-09-20T12:00:00Z',solicitante:'Persona',cargo:'',usuario:'',observaciones:'',fotoUrl:'',maquinaria:'moto',placaSerial:'21G',horometro:''} satisfies Movement;
 render(<FuelEquipmentPanel movements={[m,{...m,id:'old',placaSerial:'87G',cantidad:90},{...m,id:'gray',maquinaria:'camioneta',placaSerial:'875',cantidad:90}]}/>);
 screen.getByRole('button',{name:/Control por maquinaria/}).focus();
 fireEvent.click(screen.getByRole('button',{name:/Control por maquinaria/}));
 expect(screen.getAllByText('Sin lectura registrada')[0]).toBeTruthy();expect(screen.getAllByText('3 gal')[0]).toBeTruthy();
 fireEvent.input(screen.getByLabelText('Maquinaria desde'),{target:{value:'2026-09-21'}});
 expect(screen.getByText('No hay abastecimientos para estos filtros.')).toBeTruthy();
 fireEvent.click(screen.getByText('Limpiar filtros'));expect(screen.getAllByText('Sin lectura registrada')[0]).toBeTruthy();
 const dialog=screen.getByRole('dialog',{name:'Control por maquinaria'});
 fireEvent.keyDown(dialog,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
 expect(document.activeElement).toBe(screen.getByRole('button',{name:/Control por maquinaria/}));
});

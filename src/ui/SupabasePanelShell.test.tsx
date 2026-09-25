// @vitest-environment jsdom
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {User} from 'firebase/auth';
import {AppShell,PendingUsersPanel} from '../App';
import {parsePanelSnapshot} from '../backend/supabase/panel';
const mocks=vi.hoisted(()=>({snapshot:vi.fn(),query:vi.fn(),write:vi.fn()}));
vi.mock('../firebase',()=>({db:{},auth:{},firebaseApp:{},firebaseProjectId:'demo'}));
vi.mock('firebase/firestore',async original=>({...await original<object>(),onSnapshot:mocks.snapshot,getDocsFromServer:mocks.query,updateDoc:mocks.write}));
vi.mock('./SupabaseValuations',()=>({default:()=> <p>Valoración conectada</p>}));
HTMLElement.prototype.scrollTo=vi.fn();
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('reuses the existing module navigation and tables without starting Firebase reads or writes',async()=>{
 const snapshot=parsePanelSnapshot({version:1,read_at:'2026-09-24T12:00:00Z',positions:[{id:'p',product_id:'product',module_id:'EPP',code:'PV01',name:'Gafas reales',category:'Protección visual (PV)',reference:'',unit_id:'UNIDAD',location_code:'SIN UBICACION',valuation_id:'v',quantity_milli:3000}],assets:[],loans:[],movements:[],history:[],workshop_history:[],workshop_operations:[],valuations:[{id:'v',unit_value:20}],profiles:[]});
 render(<AppShell user={{uid:'u',email:'almacen@arlessas.com'} as User} supabase={{snapshot,access:{user_id:'u',display_name:'Test',role:'ADMIN',operational:false},logout:vi.fn(),refresh:async()=>{}}}/>);
 fireEvent.click(screen.getByRole('button',{name:/^EPP$/}));
 await screen.findByText('Gafas reales');
 expect(mocks.snapshot).not.toHaveBeenCalled();expect(mocks.query).not.toHaveBeenCalled();expect(mocks.write).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Salir'})).toBeTruthy();
});

it('preserves the displayed role and name when saving an existing profile',async()=>{
 const profile={id:'owner',nombre:'Almacén',email:'almacen@arlessas.com',rol:'admin',cargo:'Almacén',estado:'activo',activo:true};
 const save=vi.fn(async()=>{});
 render(<PendingUsersPanel users={[profile]} onClose={vi.fn()} onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:/^Guardar$/}));
 expect(save).toHaveBeenCalledWith(profile,'admin','Almacén','Almacén','activo');
});

it('keeps mobile access explicit and shows email confirmation independently', async()=>{
 const profile={id:'new',nombre:'Persona',email:'persona@arlessas.com',rol:'lector',cargo:'Taller',estado:'activo',activo:true,mobileActive:false,emailConfirmed:false};
 const save=vi.fn(async()=>{});
 render(<PendingUsersPanel users={[profile]} mobileAccess onClose={vi.fn()} onSave={save}/>);
 expect(screen.getByText('Correo pendiente de confirmar')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Guardar'}));
 expect(save).toHaveBeenLastCalledWith(profile,'lector','Persona','Taller','activo',false);
 await screen.findByRole('button',{name:'Guardar'});
 fireEvent.change(screen.getByRole('combobox',{name:'Acceso móvil de persona@arlessas.com'}),{target:{value:'activo'}});
 fireEvent.click(screen.getByRole('button',{name:'Guardar'}));
 expect(save).toHaveBeenLastCalledWith(profile,'lector','Persona','Taller','activo',true);
});

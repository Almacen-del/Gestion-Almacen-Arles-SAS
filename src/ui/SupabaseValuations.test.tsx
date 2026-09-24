// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import SupabaseValuations from './SupabaseValuations';
const mocks=vi.hoisted(()=>({monthly:vi.fn()}));
vi.mock('../firebase',()=>({db:{},auth:{},firebaseApp:{},firebaseProjectId:'test'}));
vi.mock('../valuation/monthlyValuation',async original=>({...await original<object>(),subscribeMonthlyValuationPeriod:mocks.monthly}));
const uid='00000000-0000-4000-8000-000000000001';
const id='00000000-0000-4000-8000-000000000002';
const session={user:{id:uid,email:'almacen@arlessas.com'}} as Session;
const item={cursor:'POSITION:'+id,entity:'POSITION',entity_id:id,product_id:id,module_id:'EPP',code:'PV01',name:'Gafas de prueba',reference:'',unit_id:'UNIDAD',location_code:'',quantity_milli:3000,valuation_id:'existencias__old',unit_value:25,revision:1};
function connection(operational=true,signedIn=true){
 let notify:(_event:string,session:Session|null)=>void=()=>{};
 let current={...item};
 const rpc=vi.fn(async(name:string)=>{
  if(name==='web_entry_catalog'||name==='web_entry_values')return {data:[],error:null};
  if(name==='web_panel_access')return {data:{user_id:uid,display_name:'Almacén',role:'ADMIN',operational},error:null};
  if(name==='web_valuation_catalog')return {data:[{...current}],error:null};
  current={...current,unit_value:30,revision:2};
  return {data:{status:'saved',valuation_id:item.valuation_id,revision:2,unit_value:30},error:null};
 });
 const auth={onAuthStateChange:vi.fn(callback=>{notify=callback;return {data:{subscription:{unsubscribe:vi.fn()}}};}),
  getSession:vi.fn(async()=>({data:{session:signedIn?session:null},error:null})),
  signInWithPassword:vi.fn(async()=>{notify('SIGNED_IN',session);return {data:{session},error:null};}),
  signOut:vi.fn(async()=>{notify('SIGNED_OUT',null);return {error:null};})};
 return {rpc,auth,client:{rpc,auth} as unknown as SupabaseClient,notify:(value:Session|null)=>notify('SIGNED_OUT',value)};
}
beforeEach(()=>{mocks.monthly.mockReset();Object.defineProperty(navigator,'onLine',{configurable:true,value:true});});
afterEach(cleanup);
async function openEditor(){fireEvent.click(await screen.findByTitle('Editar valor unitario de Gafas de prueba'));await screen.findByRole('dialog');}
describe('Supabase connected valuation screen',()=>{
 it('signs in with Supabase, renders the existing table and never subscribes to Firebase closes',async()=>{
  const c=connection(true,false);render(<SupabaseValuations client={c.client}/>);
  fireEvent.change(await screen.findByLabelText('Correo'),{target:{value:'Almacen@ArlesSAS.com'}});
  fireEvent.change(screen.getByLabelText('Contraseña'),{target:{value:'local-test-password'}});
  fireEvent.click(screen.getByRole('button',{name:'Conectar'}));
  await screen.findByText('Gafas de prueba');
  expect(c.auth.signInWithPassword).toHaveBeenCalledWith({email:'almacen@arlessas.com',password:'local-test-password'});
  expect(mocks.monthly).not.toHaveBeenCalled();expect(screen.queryByText('Guardar corte del mes')).toBeNull();
 });
 it('uses the canonical entity and baseline revision to save from the existing modal',async()=>{
  const c=connection();render(<SupabaseValuations client={c.client}/>);await openEditor();
  fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'30'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar valor'}));
  await screen.findByText('Valor unitario guardado.');
  expect(c.rpc).toHaveBeenCalledWith('web_save_manual_valuation',expect.objectContaining({p_entity:'POSITION',p_entity_id:id,p_expected_revision:1,p_unit_value:30}));
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(()=>expect(screen.getByTitle('Editar valor unitario de Gafas de prueba').textContent).toContain('30'));
 });
 it('blocks real saves in review mode, while still allowing the edit preview',async()=>{
  const c=connection(false);render(<SupabaseValuations client={c.client}/>);await openEditor();
  expect((screen.getByRole('button',{name:'Guardar valor'}) as HTMLButtonElement).disabled).toBe(true);
  expect(c.rpc.mock.calls.some(([name])=>name==='web_save_manual_valuation')).toBe(false);
 });
 it('keeps the same UUID after an uncertain response',async()=>{
  const c=connection();let writes=0;const original=c.rpc.getMockImplementation()!;
  c.rpc.mockImplementation(async(name:string)=>name==='web_save_manual_valuation' && ++writes===1?{data:null,error:{message:'timeout'}} as never:original(name));
  render(<SupabaseValuations client={c.client}/>);await openEditor();fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'30'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar valor'}));await screen.findByRole('alert');
  await waitFor(()=>expect((screen.getByRole('button',{name:'Guardar valor'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Guardar valor'}));await screen.findByText('Valor unitario guardado.');
  const calls=c.rpc.mock.calls.filter(([name])=>name==='web_save_manual_valuation');expect(calls).toHaveLength(2);expect(calls[0]).toEqual(calls[1]);
 });
 it('shows a conflict and requires reloading before another save',async()=>{
  const c=connection();const original=c.rpc.getMockImplementation()!;
  c.rpc.mockImplementation(async(name:string)=>name==='web_save_manual_valuation'?{data:{status:'conflict',valuation_id:item.valuation_id,revision:2,unit_value:40},error:null}:original(name));
  render(<SupabaseValuations client={c.client}/>);await openEditor();fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'30'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar valor'}));await screen.findByText('Este valor cambió en otro equipo.');
  expect((screen.getByRole('button',{name:'Guardar valor'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('clears data when the session is lost',async()=>{
  const c=connection();render(<SupabaseValuations client={c.client}/>);await screen.findByText('Gafas de prueba');
  act(()=>c.notify(null));await screen.findByRole('button',{name:'Conectar'});expect(screen.queryByText('Gafas de prueba')).toBeNull();
 });
 it('blocks an open editor when the connection is lost',async()=>{
  const c=connection();render(<SupabaseValuations client={c.client}/>);await openEditor();
  Object.defineProperty(navigator,'onLine',{configurable:true,value:false});act(()=>window.dispatchEvent(new Event('offline')));
  expect((screen.getByRole('button',{name:'Guardar valor'}) as HTMLButtonElement).disabled).toBe(true);
  expect(c.rpc.mock.calls.some(([name])=>name==='web_save_manual_valuation')).toBe(false);
 });
 it('removes the catalog after the server revokes access',async()=>{
  const c=connection();render(<SupabaseValuations client={c.client}/>);await screen.findByText('Gafas de prueba');
  c.rpc.mockResolvedValue({data:null,error:{code:'42501'}} as never);
  fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));await screen.findByText('Tu usuario no tiene acceso al panel.');
  expect(screen.queryByText('Gafas de prueba')).toBeNull();
 });
});

import {canRefreshInBackground} from '../backend/supabase/refresh';
import {useEffect,useState,useCallback,useRef,type FormEvent} from 'react';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import type {User} from 'firebase/auth';
import {AppShell} from '../App';
import {webSupabaseClient} from '../backend/supabase/runtime';
import {signInToWeb} from '../backend/supabase/client';
import {WebAdministration,WebAccessDenied,type WebAccess} from '../backend/supabase/administration';
import {loadPanelSnapshot,type PanelSnapshot} from '../backend/supabase/panel';
import {EntryAdministration} from '../backend/supabase/entries';

/** Mount the existing panel only after access and a complete snapshot succeed. */
export default function SupabasePanel({client:provided}:{client?:SupabaseClient}){
  const [client]=useState(()=>provided??webSupabaseClient());
  const [session,setSession]=useState<Session|null>(null),[checking,setChecking]=useState(true);
  const [data,setData]=useState<{snapshot:PanelSnapshot;access:WebAccess}|null>(null);
  const [attempt,setAttempt]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refreshAction=useRef<()=>Promise<void>>(async()=>{});
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [register,setRegister]=useState(false),[name,setName]=useState(''),[job,setJob]=useState('');
  useEffect(()=>{
    let alive=true,events=0;
    const accept=(next:Session|null)=>{if(alive){setSession(next);setChecking(false);}};
    const {data}=client.auth.onAuthStateChange((_event,next)=>{events++;accept(next);});
    void client.auth.getSession().then(result=>{if(alive&&!events){if(result.error)setError('No se pudo recuperar la sesión.');accept(result.data.session);}})
      .catch(()=>{if(alive){setChecking(false);setError('No se pudo recuperar la sesión.');}});
    return()=>{alive=false;data.subscription.unsubscribe();};
  },[client]);
  useEffect(()=>{
    let alive=true; let inFlight:Promise<void>|null=null;
    setData(null);
    if(!session)return;
    const uid=session.user.id;
    async function refresh(){
      if(inFlight)await inFlight;
      if(!alive)return;
      const task=load();inFlight=task;await task;
      if(inFlight===task)inFlight=null;
    }
    async function load(){
      setBusy(true);
      try{
        const access=await new WebAdministration(client).access();
        if(access.user_id!==uid)throw new WebAccessDenied('La sesión cambió. Vuelve a ingresar.');
        const snapshot=await loadPanelSnapshot(client);
        const api=new EntryAdministration(client);
        const [entries,values]=await Promise.all([api.catalog(),api.values()]);
        snapshot.entries=entries.map(entry=>({...entry,productId:[...snapshot.inventory,...snapshot.aseo].find(p=>p.valuationId===entry.valuationId)?.id??entry.productId}));
        snapshot.entryValues=values;
        if(alive){setData({access,snapshot});setError('');}
      }catch(e){if(alive){if(e instanceof WebAccessDenied)setData(null);setError(e instanceof Error?e.message:'No se pudo actualizar el panel. Se conserva la última consulta.');}}
      finally{if(alive)setBusy(false);}
    }
    refreshAction.current=refresh;
    void refresh();
    const timer=window.setInterval(()=>{if(canRefreshInBackground())void refresh();},60000);
    const online=()=>void refresh();window.addEventListener('online',online);
    return()=>{alive=false;refreshAction.current=async()=>{};window.clearInterval(timer);window.removeEventListener('online',online);};
  },[client,session?.user.id,attempt]);
  const refresh=useCallback(async()=>{await refreshAction.current();},[]);
  async function logout(){const result=await client.auth.signOut({scope:'local'});if(result.error)setError('No se pudo cerrar la sesión.');else {setSession(null);setData(null);}}
  async function login(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{if(register){if(!/^[^\s@]+@arlessas\.com$/.test(email.trim().toLowerCase()))throw Error('Usa tu correo corporativo.');const result=await client.auth.signUp({email:email.trim().toLowerCase(),password,options:{emailRedirectTo:window.location.origin,data:{display_name:name,job_title:job}}});if(result.error)throw Error('No se pudo crear la cuenta. Revisa tus datos.');setError('Cuenta creada. Confirma tu correo y espera la aprobación del administrador.');setRegister(false);}else await signInToWeb(client,email,password);setPassword('');}catch(e){setError(e instanceof Error?e.message:'No se pudo ingresar.');}finally{setBusy(false);}}
  async function resendConfirmation(){
    if(!/^[^\s@]+@arlessas\.com$/.test(email.trim().toLowerCase())){setError('Escribe primero tu correo corporativo.');return;}
    setBusy(true);try{const {error}=await client.auth.resend({type:'signup',email:email.trim().toLowerCase(),options:{emailRedirectTo:window.location.origin}});
      setError(error?'No se pudo reenviar. Espera unos minutos o consulta al administrador.':'Si la cuenta tiene una confirmación pendiente, recibirás un correo. Revisa también spam.');
    }catch{setError('No se pudo reenviar. Revisa la conexión.');}finally{setBusy(false);}
  }
  async function requestAccess(e:FormEvent){e.preventDefault();setBusy(true);try{const {error}=await client.rpc('web_request_access',{p_name:name,p_job:job});if(error)throw Error('No se pudo solicitar acceso. Confirma primero el correo.');setError('Solicitud enviada. Un administrador debe aprobarla.');}catch(e){setError(e instanceof Error?e.message:'Error de solicitud.');}finally{setBusy(false);}}
  if(checking)return <main className="loading-screen">Verificando sesión…</main>;
  if(!session)return <main className="login-panel"><h1>Almacén Arles</h1><p>Panel web · Supabase</p><form className="login-form" onSubmit={login}>
    {register&&<><label>Nombre<input required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label><label>Cargo<input maxLength={160} value={job} onChange={e=>setJob(e.target.value)}/></label></>}
    <label>Correo<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error&&<p role="alert">{error}</p>}<button disabled={busy}>{register?'Crear cuenta':'Ingresar'}</button><button type="button" disabled={busy} onClick={()=>setRegister(!register)}>{register?'Volver al ingreso':'Solicitar una cuenta'}</button>
  {!register&&<button type="button" disabled={busy} onClick={()=>void resendConfirmation()}>Reenviar confirmación</button>}
  </form></main>;
  if(!data)return <main className="loading-screen"><p role={error?'alert':'status'}>{error||'Cargando inventario e historial…'}</p>
    {!busy&&<><button onClick={()=>setAttempt(n=>n+1)}>Reintentar</button><form onSubmit={requestAccess}><label>Nombre<input required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label><label>Cargo<input maxLength={160} value={job} onChange={e=>setJob(e.target.value)}/></label><button>Solicitar acceso al panel</button></form></>}<button onClick={()=>void logout()}>Cerrar sesión</button></main>;
  return <>{error&&<div role="status" className="form-error">{error} Se conserva la última consulta; se reintentará automáticamente.</div>}{!data.access.operational&&<div role="status" style={{padding:'8px 20px',background:'#fff2ca'}}>Supabase · revisión de integración. Las operaciones pendientes permanecen bloqueadas.</div>}
    <AppShell key={session.user.id} user={{uid:session.user.id,email:session.user.email??null,displayName:data.access.display_name} as User}
      supabase={{...data,logout:()=>void logout(),refresh}}/>
  </>;
}

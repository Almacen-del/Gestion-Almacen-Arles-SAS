import type {PanelSnapshot} from '../backend/supabase/panel';
import {panelMonthlySources} from '../backend/supabase/monthlySources';
import {buildMonthlyActivity,summarizeMonthlyActivity} from '../valuation/monthlyActivity';
import {currentValuationPeriod} from '../valuation/monthlyValuation';
import {isInventoryValuationModuleIncluded} from '../valuation/inventoryValuationScope';
import {MonthlyArchive} from '../backend/supabase/monthly';
import {HistoricalValuationView} from './InventoryValuationModule';
import PendingEntryValuations from './PendingEntryValuations';
import {EntryAdministration,EntryWriteRejected,type EntryWrite} from '../backend/supabase/entries';
import type {EntryStockMovement,EntryValuationRecord} from '../valuation/entryValuation';
import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import type {User} from 'firebase/auth';
import {CurrentValuationView} from './InventoryValuationModule';
import ValuationEditModal from './ValuationEditModal';
import {signInToWeb} from '../backend/supabase/client';
import {webSupabaseClient} from '../backend/supabase/runtime';
import {WebAdministration,currentValuationRows,type WebAccess,type ValuationCatalogRow,type ManualValuationRequest} from '../backend/supabase/administration';
import {createInitialFirestoreSourceStates} from '../valuation/firestoreSync';
import type {ManualValuationConflict} from '../valuation/manualValuation';
import type {ValuationSaveState} from '../valuation/models';

/** Uses the existing valuation view and edit modal. No Firebase write fallback. */
export default function SupabaseValuations({client:providedClient,snapshot}:{client?:SupabaseClient;snapshot?:PanelSnapshot}) {
  const [client]=useState(()=>providedClient??webSupabaseClient());
  const api=useMemo(()=>new WebAdministration(client),[client]);
  const monthlyApi=useMemo(()=>new MonthlyArchive(client),[client]);
  const entriesApi=useMemo(()=>new EntryAdministration(client),[client]);
  const [tab,setTab]=useState<'current'|'entries'|'history'>('current');
  const [entries,setEntries]=useState<EntryStockMovement[]>([]);
  const [entryValues,setEntryValues]=useState<Record<string,EntryValuationRecord>>({});
  const entryWrites=useRef(new Map<string,EntryWrite>());
  const [entriesError,setEntriesError]=useState('');
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);
  const [access,setAccess]=useState<WebAccess|null>(null);
  const [catalog,setCatalog]=useState<ValuationCatalogRow[]>([]);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [online,setOnline]=useState(()=>navigator.onLine);
  const [selected,setSelected]=useState<ValuationCatalogRow|null>(null);
  const [draft,setDraft]=useState('');
  const [saveState,setSaveState]=useState<ValuationSaveState>();
  const [conflict,setConflict]=useState<ManualValuationConflict>();
  const pending=useRef<ManualValuationRequest|null>(null);
  const saving=useRef(false);
  const generation=useRef(0);
  const activeUid=useRef<string|null>(null);

  useEffect(()=>{
    let alive=true,events=0;
    const accept=(next:Session|null)=>{
      if(!alive)return;
      activeUid.current=next?.user.id??null;
      setSession(next);setChecking(false);
    };
    const {data}=client.auth.onAuthStateChange((_event,next)=>{events++;accept(next);});
    void client.auth.getSession().then(({data,error})=>{
      if(!alive || events)return;
      if(error){setError('No se pudo recuperar la sesión.');accept(null);}else accept(data.session);
    }).catch(()=>{if(alive){setError('No se pudo recuperar la sesión.');setChecking(false);}});
    const update=()=>setOnline(navigator.onLine);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return()=>{alive=false;generation.current++;data.subscription.unsubscribe();window.removeEventListener('online',update);window.removeEventListener('offline',update);};
  },[client]);

  const refresh=useCallback(async()=>{
    const uid=activeUid.current;if(!uid)return;
    const ticket=++generation.current;setLoading(true);setError('');
    try{
      const profile=await api.access();
      if(profile.user_id!==uid)throw new Error('La sesión no corresponde al perfil del panel.');
      const next=await api.catalog();currentValuationRows(next);
      if(ticket!==generation.current || activeUid.current!==uid)return;
      setAccess(profile);setCatalog(next);
      try {
        const [entryRows,values]=await Promise.all([entriesApi.catalog(),entriesApi.values()]);
        if(ticket!==generation.current || activeUid.current!==uid)return;
        setEntries(entryRows);setEntryValues(values);setEntriesError('');
      } catch {if(ticket===generation.current){setEntries([]);setEntryValues({});setEntriesError('No se pudieron consultar las entradas por valorar.');}}
    }catch(error){
      if(ticket!==generation.current || activeUid.current!==uid)return;
      setAccess(null);setCatalog([]);setSelected(null);pending.current=null;
      setError(error instanceof Error?error.message:'No se pudo consultar Supabase.');
    }finally{if(ticket===generation.current)setLoading(false);}
  },[api,entriesApi]);

  useEffect(()=>{
    generation.current++;setAccess(null);setCatalog([]);setSelected(null);setEntries([]);setEntryValues({});entryWrites.current.clear();pending.current=null;
    if(!session?.user.id)return;
    void refresh();
    const timer=window.setInterval(()=>{if(navigator.onLine && !saving.current)void refresh();},60000);
    return()=>{generation.current++;window.clearInterval(timer);};
  },[session?.user.id,refresh]);

  async function login(event:FormEvent){
    event.preventDefault();setLoading(true);setError('');
    try{await signInToWeb(client,email,password);setPassword('');}
    catch(error){setError(error instanceof Error?error.message:'No se pudo iniciar sesión.');}
    finally{setLoading(false);}
  }
  async function logout(){
    if(saving.current)return;
    generation.current++;activeUid.current=null;setAccess(null);setCatalog([]);setSelected(null);pending.current=null;
    const {error}=await client.auth.signOut({scope:'local'});
    if(error){activeUid.current=session?.user.id??null;setError('No se pudo cerrar la sesión. Reintenta.');}else setSession(null);
  }
  function edit(id:string){
    const row=catalog.find(row=>row.valuation_id===id);if(!row)return;
    setSelected({...row});setDraft(String(row.unit_value??0));setConflict(undefined);setSaveState(undefined);pending.current=null;
  }
  async function save(){
    if(!selected || saving.current || !online || loading || !access?.operational || access.role==='READER')return;
    const amount=Number(draft.replace(',','.'));
    if(!draft.trim() || !Number.isFinite(amount) || amount<0){setError('Escribe un valor unitario válido.');return;}
    if(conflict)return;
    pending.current??={requestId:crypto.randomUUID(),entity:selected.entity,entityId:selected.entity_id,expectedRevision:selected.revision,unitValue:amount};
    const operation=pending.current,uid=activeUid.current;
    saving.current=true;setSaveState('saving');setError('');
    try{
      const result=await api.saveManual(operation);
      if(activeUid.current!==uid)return;
      if(result.valuation_id!==selected.valuation_id)throw new Error('El producto cambió de vínculo. Actualiza el inventario.');
      pending.current=null;
      if(result.status==='conflict'){
        setConflict({current:{exists:result.revision>0,unitValue:result.unit_value??0,updatedAtMillis:null,updatedByUid:'',updateOrigin:'supabase',lastMovementId:''}});
        setSaveState('conflict');
      }else{
        setSelected(null);setSaveState('saved');await refresh();
      }
    }catch(error){if(activeUid.current===uid){setSaveState('error');setError(error instanceof Error?error.message:'No se pudo confirmar el guardado.');}}
    finally{saving.current=false;}
  }
  async function reloadEditor(){
    if(!selected || saving.current)return;
    const id=selected.valuation_id,uid=activeUid.current;setLoading(true);
    try{
      const next=await api.catalog();currentValuationRows(next);
      if(activeUid.current!==uid)return;
      const row=next.find(row=>row.valuation_id===id);if(!row)throw new Error('El producto ya no aparece en el inventario.');
      setCatalog(next);setSelected({...row});setDraft(String(row.unit_value??0));setConflict(undefined);setSaveState(undefined);pending.current=null;setError('');
    }catch(error){setError(error instanceof Error?error.message:'No se pudo recargar el valor.');}
    finally{setLoading(false);}
  }
  const rows=useMemo(()=>currentValuationRows(catalog).filter(row=>isInventoryValuationModuleIncluded(row.moduleName)),[catalog]);
  const modules=useMemo(()=>[...new Set(rows.map(row=>row.moduleName))],[rows]);
  const monthlySources=useMemo(()=>snapshot?panelMonthlySources(snapshot):[],[snapshot]);
  const monthlyExpense=useMemo(()=>summarizeMonthlyActivity(buildMonthlyActivity(currentValuationPeriod(),rows,monthlySources,new Date()).rows),[rows,monthlySources]);
  const confirmedSources=createInitialFirestoreSourceStates();
  for(const source of Object.values(confirmedSources)){source.received=!!snapshot&&!loading&&!entriesError;source.fromCache=false;}
  const pendingEntries=entries.filter(e=>!entryValues[e.id]);

  if(checking)return <p role="status">Recuperando sesión del panel…</p>;
  if(!session)return <section className="login-panel" aria-label="Conectar valoraciones con Supabase">
    <h2>Valoraciones · Supabase</h2><p>Ingresa con la cuenta que utilizas en la nueva aplicación.</p>
    <form className="login-form" onSubmit={login}>
      <label>Correo<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
      <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <button disabled={loading} type="submit">{loading?'Ingresando…':'Conectar'}</button>
    </form>
  </section>;
  return <section className="valuation-dashboard" aria-label="Valoraciones conectadas a Supabase">
    <div className="valuation-current-toolbar"><strong>Valoraciones · Supabase</strong>
      <button className="tool-button" disabled={loading||!online||saveState==='saving'} onClick={()=>void refresh()}>Actualizar</button>
      <button className="tool-button" disabled={saveState==='saving'} onClick={()=>void logout()}>Cerrar sesión de Supabase</button>
    </div>
    {!access?.operational&&<p role="status">Modo revisión: puedes consultar y revisar los precios. El guardado se habilitará al activar la web.</p>}
    {!online&&<p role="status">Sin conexión. No se pueden guardar cambios.</p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    {saveState==='saved'&&<p role="status">Valor unitario guardado.</p>}
    {access&&<div className="valuation-tabs"><button onClick={()=>setTab('current')}>Valor actual</button><button onClick={()=>setTab('entries')}>Entradas por valorar</button><button onClick={()=>setTab('history')}>Histórico mensual</button></div>}
    {access&&tab==='history'&&<HistoricalValuationView repository={monthlyApi} canManage={!!snapshot&&access.operational&&access.role!=='READER'} sources={monthlySources} historyReady={!!snapshot&&!loading} currentRows={rows} moduleOptions={modules} online={online} user={{uid:session.user.id,email:session.user.email??null} as User}/>}
    {access&&tab==='entries'&&<PendingEntryValuations canManage={access.operational&&access.role!=='READER'} online={online} user={{uid:session.user.id,email:session.user.email??null} as User}
      currentAverages={Object.fromEntries(catalog.filter(r=>r.unit_value!==null).map(r=>[r.valuation_id,r.unit_value!]))}
      currentValuationIds={new Set(catalog.filter(r=>r.unit_value!==null).map(r=>r.valuation_id))} entries={entries} records={entryValues} loading={loading} loadError={entriesError}
      onSaveEntry={async input=>{
        if(saving.current||!access.operational||access.role==='READER'||!online)throw Error('El guardado no está habilitado.');
        const row=entries.find(e=>e.id===input.movementId),value=catalog.find(v=>v.valuation_id===row?.valuationId);
        if(!row||!value)throw Error('No se encontró el producto vigente.');
        let request=entryWrites.current.get(row.id);
        if(request&&request.unitValue!==input.entryUnitValue)throw Error('Reintenta primero el valor pendiente.');
        request??={requestId:crypto.randomUUID(),movementId:row.id,revision:value.revision,unitValue:input.entryUnitValue};entryWrites.current.set(row.id,request);
        saving.current=true;
        try {const result=await entriesApi.save(request);entryWrites.current.delete(row.id);await refresh();return result;}
        catch(e){if(e instanceof EntryWriteRejected){entryWrites.current.delete(row.id);await refresh();}throw e;}
        finally{saving.current=false;}
      }}/> }
    {access&&tab==='current'&&<CurrentValuationView monthlyRepository={monthlyApi} monthlyEnabled={!!snapshot&&access.operational} canManage={access.role!=='READER'} rows={rows} moduleOptions={modules}
      online={online} loading={loading} user={{uid:session.user.id,email:session.user.email??null} as User}
      firestoreSources={confirmedSources} pendingEntryCount={pendingEntries.filter(e=>!e.validationIssue).length} inconsistentEntryCount={pendingEntries.filter(e=>!!e.validationIssue).length}
      estimatedExitExpense={{estimatedTotal:monthlyExpense.estimatedExpense,exitCount:monthlyExpense.exitCount,valuedExitCount:monthlyExpense.exitCount-monthlyExpense.unpricedExitCount,unvaluedExitCount:monthlyExpense.unpricedExitCount,unresolvedExitCount:0,missingValuations:[]}}
      monthlyActivitySources={monthlySources} exitHistoryComplete={!!snapshot} exitHistoryLoading={loading} onEdit={edit} onOpenEntries={()=>setTab('entries')} onOpenHistory={()=>setTab('history')}/>}
    {loading&&!access&&<p role="status">Consultando el inventario completo…</p>}
    {selected&&<ValuationEditModal product={selected.name} code={selected.code} unit={selected.unit_id} moduleName={rows.find(row=>row.valuationId===selected.valuation_id)?.moduleName??''}
      quantity={rows.find(row=>row.valuationId===selected.valuation_id)?.quantity??0} value={draft} saveState={saveState} conflict={conflict}
      saveBlockedReason={!online?'No se puede guardar sin conexión.':loading?'Actualizando datos…':!access?.operational?'Modo revisión: el guardado aún no está habilitado.':access.role==='READER'?'Tu perfil permite solo consultar.':''}
      onChange={value=>{if(pending.current){setError('Reintenta el guardado pendiente antes de cambiar el valor.');return;}setDraft(value);}}
      onSave={()=>void save()} onReload={()=>void reloadEditor()} onClose={()=>{if(saving.current)return;setSelected(null);pending.current=null;setConflict(undefined);setSaveState(undefined);}}/>}
  </section>;
}

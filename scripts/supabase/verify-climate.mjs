import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const actor = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000003';
try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table operators(user_id uuid primary key, display_name text, role text, active boolean);
    create table web_profiles(user_id uuid primary key, display_name text, role text, active boolean);
    insert into auth.users values('${actor}'),('${other}');
    insert into operators values('${actor}','Operador de prueba','OPERATOR',true),('${other}','Otro','OPERATOR',true);
    insert into web_profiles values('${actor}','Operador de prueba','READER',true);`);
  // Use the real web authorization function from the existing migration.
  const base = await readFile('supabase/migrations/202609240002_web_valuations.sql','utf8');
  await db.exec(base.slice(base.indexOf('create function public.web_require_access('),base.indexOf('create function public.web_panel_access(')));
  await db.exec(await readFile('supabase/migrations/202609240014_agrochemical_climate.sql','utf8'));
  const call = (overrides = {}) => {
    const p = {id,period:'AM',t:25.5,h:60,date:'2026-01-01T13:00:00Z',notes:'',...overrides};
    return db.query('select climate_record_reading($1,$2,$3,$4,$5,$6) result',[p.id,p.period,p.t,p.h,p.date,p.notes]);
  };
  await db.exec(`set role anon`); await assert.rejects(()=>call(),/permission denied/);
  await db.exec(`reset role; select set_config('test.uid','${actor}',false); set role authenticated;`);
  assert.equal((await call()).rows[0].result.status,'confirmed'); await call();
  assert.equal((await db.query('select * from climate_readings_page()')).rows.length,1);
  assert.equal((await db.query("select * from climate_day_readings('2026-01-01')")).rows.length,1);
  await assert.rejects(()=>call({id:'00000000-0000-4000-8000-000000000004'}),/Ya existe/);
  await call({id:'00000000-0000-4000-8000-000000000005',period:'PM'});
  assert.equal((await db.query("select * from climate_day_readings('2026-01-01')")).rows.length,2);
  await assert.rejects(()=>call({t:26}),/Identificador/);
  for(const patch of [{t:null},{t:'NaN'},{t:'Infinity'},{h:101},{h:-1},{period:'OTHER'},{date:'infinity'},{date:'2999-01-01'},{notes:'x'.repeat(1001)}]) await assert.rejects(()=>call(patch),/inválida/);
  await assert.rejects(()=>db.query('select * from agrochemical_climate_readings'),/permission denied/);
  await assert.rejects(()=>db.query('delete from agrochemical_climate_readings'),/permission denied/);
  await db.exec(`reset role; select set_config('test.uid','${other}',false); set role authenticated;`);
  await assert.rejects(()=>call(),/Identificador/); await assert.rejects(()=>db.query('select * from climate_readings_page()'),/Acceso/);
  await db.exec(`reset role; update operators set active=false where user_id='${actor}'; select set_config('test.uid','${actor}',false); set role authenticated;`);
  await assert.rejects(()=>call(),/Acceso/); await assert.rejects(()=>db.query('select * from climate_readings_page()'),/Acceso/);
  await db.exec('reset role'); assert.equal((await db.query('select count(*)::integer n from agrochemical_climate_readings')).rows[0].n,2);
  console.log('PASS: SQL permissions, revocation, validation, immutable history, two daily periods and idempotent retry.');
} finally { await db.close(); }

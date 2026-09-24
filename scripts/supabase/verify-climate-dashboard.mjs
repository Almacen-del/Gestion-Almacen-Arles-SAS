import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const admin = '00000000-0000-4000-8000-000000000001', reader = '00000000-0000-4000-8000-000000000002', mobile = '00000000-0000-4000-8000-000000000003';
try {
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  create table operators(user_id uuid primary key, display_name text, role text, active boolean);
  create table web_profiles(user_id uuid primary key, display_name text, role text, active boolean, approved boolean);
  insert into auth.users values('${admin}'),('${reader}'),('${mobile}');
  insert into operators values('${mobile}','Mobile','OPERATOR',true);
  insert into web_profiles values('${admin}','Admin','ADMIN',true,true),('${reader}','Reader','READER',true,true);`);
  const access = await readFile('supabase/migrations/202609240015_web_access_scope.sql', 'utf8');
  await db.exec(access.slice(access.indexOf('create or replace function'), access.indexOf('do $$')));
  await db.exec(await readFile('supabase/migrations/202609240014_agrochemical_climate.sql', 'utf8'));
  // Legacy reading must remain distinguishable from newly versioned readings.
  await db.exec(`insert into agrochemical_climate_readings values('10000000-0000-4000-8000-000000000000','AM','2026-01-01',25,50,'2026-01-01T13:00:00Z','Legacy','${mobile}','Mobile',now());`);
  await db.exec(await readFile('supabase/migrations/202609240017_climate_dashboard.sql', 'utf8'));
  const session = async id => db.exec(`reset role; select set_config('test.uid','${id}',false); set role authenticated;`);
  const record = (name='climate_web_record_reading', patch={}) => {
    const p={ id:'20000000-0000-4000-8000-000000000000', period:'PM',t:32,h:78,date:'2026-01-01T19:00:00Z',notes:'',...patch };
    return db.query(`select ${name}($1,$2,$3,$4,$5,$6) result`,[p.id,p.period,p.t,p.h,p.date,p.notes]);
  };
  await session(admin); await record(); await record();
  await assert.rejects(()=>record(undefined,{ t:33 }),/Identificador/);
  await assert.rejects(()=>record(undefined,{ id:'30000000-0000-4000-8000-000000000000' }),/Ya existe/);
  const result=(await db.query("select climate_dashboard('2026-01-01','2026-01-31') result")).rows[0].result;
  assert.equal(result.can_record,true); assert.equal(result.readings.length,2);
  assert.equal(result.readings[0].criteria_version,null); assert.equal(result.readings[1].criteria_version,result.current_version);
  const rules=result.criteria[0].rules; assert.equal(rules.length,49); assert.equal(new Set(rules.map(r=>r.code)).size,49);
  assert.equal(rules.find(r=>r.code==='BIO006').h_max,78); assert.equal(rules.find(r=>r.code==='FER115').t_min,null);
  await assert.rejects(()=>db.query("select climate_dashboard('2025-01-01','2026-02-01')"),/Periodo/);
  await assert.rejects(()=>db.query('select * from climate_criteria_versions'),/permission denied/);
  await assert.rejects(()=>db.query('delete from agrochemical_climate_readings'),/permission denied/);
  for(const p of [{ t:'NaN' },{ h:101 },{ date:'infinity' },{ date:'2999-01-01' }]) await assert.rejects(()=>record(undefined,p),/inválida/);
  await session(reader); await assert.rejects(()=>record(),/Acceso/);
  assert.equal((await db.query("select climate_dashboard('2026-01-01','2026-01-31') result")).rows[0].result.can_record,false);
  await session(mobile); await record('climate_record_reading',{ id:'40000000-0000-4000-8000-000000000000',date:'2026-01-02T13:00:00Z',period:'AM' });
  await assert.rejects(()=>db.query("select climate_dashboard('2026-01-01','2026-01-31')"),/Acceso/);
  await db.exec('reset role');
  assert.equal((await db.query('select criteria_version from agrochemical_climate_readings order by measured_at desc limit 1')).rows[0].criteria_version,result.current_version);
  await assert.rejects(()=>db.query("update climate_criteria_versions set payload=payload"),/inmutables/);
  await db.exec(`update web_profiles set approved=false where user_id='${admin}'`); await session(admin); await assert.rejects(()=>record(),/Acceso/);
  await db.exec('reset role; set role anon'); await assert.rejects(()=>db.query("select climate_dashboard('2026-01-01','2026-01-31')"),/permission denied/);
  console.log('PASS: 49 exact criteria, persisted history/version, legacy distinction, web/mobile compatibility, permissions, duplicate/retry, validation.');
} finally { await db.close(); }

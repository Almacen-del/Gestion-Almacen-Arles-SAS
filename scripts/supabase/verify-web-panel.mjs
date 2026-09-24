import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
if(!process.env.PGLITE_MODULE||!process.env.WAREHOUSE_MIGRATIONS||!process.env.WORKSHOP_MIGRATIONS)throw Error('Configura los runtimes de comprobación.');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const name of ['202609220001_initial_foundation.sql','202609230012_history_foundation.sql','202609230017_history_photo_links.sql'])
  await db.exec(await readFile(process.env.WAREHOUSE_MIGRATIONS+'/'+name,'utf8'));
 for(const name of ['202609230019_taller_foundation.sql','202609230020_taller_special_operations.sql'])
  await db.exec(await readFile(process.env.WORKSHOP_MIGRATIONS+'/'+name,'utf8'));
 await db.exec('create table legacy_agroquimicos_mapping(source_id text primary key,product_id uuid,location_code text);');
 for(const name of ['202609240001_web_admin_archive.sql','202609240002_web_valuations.sql','202609240004_web_panel_snapshot.sql','202609240007_web_monthly_archive_reader.sql'])
  await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
 const uid='00000000-0000-4000-8000-000000000001';
 await db.exec(`insert into auth.users values('${uid}');insert into operators(user_id,display_name,role,active)values('${uid}','Test','OPERATOR',true);
 select set_config('test.uid','${uid}',false);set role authenticated;`);
 await assert.rejects(()=>db.query('select web_panel_snapshot()'),/autorizado/);
 await db.exec(`reset role;insert into web_profiles(user_id,display_name,role,active)values('${uid}','Test','READER',true);
 insert into products(id,module_id,code,name,unit_id) values('${uid}','EPP','PV01','Prueba','UNIDAD');
 insert into stock_positions(id,product_id,location_code,quantity_milli) values('${uid}','${uid}','SIN UBICACION',3000);
 set role authenticated;`);
 const snapshot=(await db.query('select web_panel_snapshot() value')).rows[0].value;
 assert.equal(snapshot.version,1);assert.equal(snapshot.positions.length,1);assert.equal(snapshot.positions[0].quantity_milli,3000);
 assert.equal(snapshot.movements.length,0);assert.equal(snapshot.assets.length,0);
 await assert.rejects(()=>db.query('select * from stock_positions'),/permission denied/);

 await db.exec('reset role;');
 await db.exec(await readFile('supabase/migrations/202609240005_web_entry_valuations.sql','utf8'));
 await db.exec(`insert into web_admin_imports(source_hash,source_read_time,expected_count,archive_sha256,counts) values(repeat('a',64),now(),1,repeat('b',64),'{}');
 insert into web_settings values(true,false,repeat('a',64));update web_profiles set role='ADMIN';
 insert into web_valuations(id,unit_value) values('existencias__test',10);`);
 await db.exec(await readFile('supabase/migrations/202609240006_web_shared_valuation_locks.sql','utf8'));
 const field=value=>typeof value==='number'?{doubleValue:value}:{stringValue:value};
 const original={fields:{clase_movimiento:field('entrada_stock'),producto_id:field('test'),cantidad:field(2),stock_anterior:field(3),stock_nuevo:field(5),creado_en:{timestampValue:'2026-09-24T10:00:00Z'}}};
 await db.query("insert into legacy_history_stage(source_path,module_id,document_kind,source_json,normalized)values('projects/arles-gestion/databases/(default)/documents/movimientos/test','EPP','MOVEMENT',$1,'{}')",[JSON.stringify(original)]);
 await db.query("insert into historical_movements(source_path,module_id,link_method,source_code,product_name,reference,kind_original,quantity,unit_original,date_original,operator_name,recipient)values('projects/arles-gestion/databases/(default)/documents/movimientos/test','EPP','TEST','PV01','Test','','Entrada',2,'UNIDAD','','Test','Test')");
 await db.exec('set role authenticated;');
 await db.exec('reset role;');await db.exec(await readFile('supabase/migrations/202609240012_web_canonical_history_paths.sql','utf8'));await db.exec('set role authenticated;');
 const entries=(await db.query('select web_entry_catalog() value')).rows[0].value;assert.equal(entries.length,1);
 const request='00000000-0000-4000-8000-000000000099';
 const save=()=>db.query("select web_save_entry_value($1,'legacy:movimientos/test',1,20) value",[request]);
 await assert.rejects(save,/revisión/);
 await db.exec('reset role;update web_settings set operational=true;set role authenticated;');
 const result=(await save()).rows[0].value;assert.equal(result.newAverage,14);assert.equal(result.previousAverage,10);
 assert.deepEqual((await save()).rows[0].value,result);
 await assert.rejects(()=>db.query("select web_save_entry_value($1,'legacy:movimientos/test',1,22)",[request]),/otros datos/);
 assert.equal((await db.query('select web_entry_values() value')).rows[0].value.length,1);
 await db.exec('reset role;');
 assert.equal((await db.query('select quantity_milli from stock_positions')).rows[0].quantity_milli,3000);
 assert.equal((await db.query('select count(*)::int n from web_valuation_audit')).rows[0].n,1);
 await db.exec('reset role;');
 await db.exec(await readFile('supabase/migrations/202609240008_web_monthly_closes.sql','utf8'));
 await db.exec(`insert into web_valuations(id,unit_value) values('position:'||'${uid}',10) on conflict do nothing;set role authenticated;`);
 const basis=(await db.query('select web_monthly_basis() value')).rows[0].value;
 const valuation=basis.snapshot.positions[0].valuation_id;
 await db.exec('reset role;');await db.query('insert into web_valuations(id,unit_value)values($1,10) on conflict(id)do update set unit_value=10',[valuation]);await db.exec('set role authenticated;');
 const confirmed=(await db.query('select web_monthly_basis() value')).rows[0].value;
 const period=(await db.query("select to_char(now() at time zone 'America/Bogota','YYYY-MM') period")).rows[0].period;
 const items=[{valuationId:valuation,moduleName:'EPP',code:'PV01',product:'Prueba',reference:'',quantity:3,unit:'UNIDAD',unitValue:10,totalValue:30}];
 const activity={period,cutoffAt:new Date().toISOString(),invalidDateCount:0,invalidQuantityCount:0,rows:[]};
 const closeId='00000000-0000-4000-8000-000000000088';
 const close=(fingerprint=confirmed.fingerprint)=>db.query('select web_save_monthly_close($1,$2,$3,$4,$5,$6) value',[closeId,period,fingerprint,'CERRAR '+period,JSON.stringify(items),JSON.stringify(activity)]);
 await assert.rejects(()=>close('stale'),/cambió/);
 const closed=(await close()).rows[0].value;assert.equal(closed.totalValue,30);assert.equal(closed.itemCount,1);assert.deepEqual((await close()).rows[0].value,closed);
 const summaries=(await db.query('select web_monthly_archive() value')).rows[0].value;assert.equal(summaries.length,1);assert.equal(summaries[0].fields.resumen.valor_total,30);
 await db.exec('reset role;');assert.equal((await db.query('select quantity_milli from stock_positions')).rows[0].quantity_milli,3000);
 await db.exec('reset role;alter table auth.users add column email text,add column email_confirmed_at timestamptz;create table legacy_agroquimicos_documents(source_path text primary key,source_document jsonb not null);');
 for(const name of ['202609240009_web_administration.sql','202609240010_web_lot_assignments.sql','202609240011_web_panel_administration_fields.sql'])await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
 const agro='00000000-0000-4000-8000-000000000002';
 await db.exec(`insert into products(id,module_id,code,name,unit_id) values('${agro}','AGROQUIMICOS','FER1','Prueba agro','UNIDAD');insert into stock_positions(id,product_id,location_code,quantity_milli)values('${agro}','${agro}','COP',10000);set role authenticated;`);
 const lotId='00000000-0000-4000-8000-000000000077';
 const assign=()=>db.query("select web_assign_agro_lot($1,$2,'COP',null,'L1','2028-05',3000,'2026-09-24',null,false) value",[lotId,agro]);
 const assignment=(await assign()).rows[0].value;assert.equal(assignment.productDocumentId,agro+':COP');assert.deepEqual((await assign()).rows[0].value,assignment);
 await assert.rejects(()=>db.query("select web_assign_agro_lot($1,$2,'COP',null,'L2','2028-05',8000,'2026-09-24',null,false)",['00000000-0000-4000-8000-000000000076',agro]),/supera/);
 await db.exec('reset role;');assert.equal(Number((await db.query('select sum(quantity_milli) n from stock_positions where product_id=$1',[agro])).rows[0].n),10000);
 assert.equal(Number((await db.query('select count(*) n from lots where product_id=$1',[agro])).rows[0].n),1);
 await db.exec('set role authenticated;');assert.equal((await db.query('select web_panel_snapshot() value')).rows[0].value.positions.length,3);
 await db.exec('reset role;');
 const fuelGas='00000000-0000-4000-8000-000000000031',fuelDiesel='00000000-0000-4000-8000-000000000032',receipt='00000000-0000-4000-8000-000000000033';
 await db.exec(`insert into auth.users(id)values('5799fac7-852e-4261-9717-015a2d287463') on conflict do nothing;insert into products(id,module_id,code,name,unit_id)values('${fuelGas}','COMBUSTIBLE','GAS1','Gasolina','GALON'),('${fuelDiesel}','COMBUSTIBLE','ACPM2','ACPM','GALON');insert into stock_positions(id,product_id,location_code,quantity_milli)values('${fuelGas}','${fuelGas}','SIN UBICACION',103110),('${fuelDiesel}','${fuelDiesel}','SIN UBICACION',514690);
 insert into sync_requests(event_id,operator_id,device_id,device_sequence,payload,status)values('${receipt}','${uid}','${receipt}',1,'{}','CONFIRMED');insert into movements(event_id,operator_id,stock_position_id,kind,quantity_milli,stock_before_milli,stock_after_milli,occurred_at)values('${receipt}','${uid}','${fuelDiesel}','SALIDA',14500,529190,514690,now());`);
 for(const [id,code,quantity]of [['BOfBWcIbML932opwqrh1','GAS1',1],['yEsRsOrSanM3Km5trmhs','GAS1',3],['MOV-INV-92c6a777-fb1d-47a2-b654-1799ee953433','ACPM2',13.4]]){
  const path='projects/arles-gestion/databases/(default)/documents/movimientos/'+id;
  await db.query("insert into legacy_history_stage(source_path,module_id,document_kind,source_json,normalized)values($1,'COMBUSTIBLE','MOVEMENT','{}','{}')",[path]);
  await db.query("insert into historical_movements(source_path,module_id,link_method,source_code,product_name,reference,kind_original,quantity,unit_original,date_original,operator_name,recipient)values($1,'COMBUSTIBLE','TEST',$2,'Test','','Salida',$3,'GALON','','Test','Test')",[path,code,quantity]);
 }
 await db.exec(await readFile('supabase/migrations/202609240013_confirmed_fuel_corrections.sql','utf8'));
 assert.equal(Number((await db.query('select quantity_milli from stock_positions where id=$1',[fuelDiesel])).rows[0].quantity_milli),528090);
 assert.equal(Number((await db.query('select quantity_milli from stock_positions where id=$1',[fuelGas])).rows[0].quantity_milli),107110);
 assert.equal(Number((await db.query('select count(*) n from historical_annulments')).rows[0].n),3);
 assert.equal(Number((await db.query('select count(*) n from movements where event_id=$1',[receipt])).rows[0].n),1);
 await db.exec('set role authenticated;');assert.equal((await db.query("select warehouse_historical_movements('COMBUSTIBLE') value")).rows[0].value.length,0);
 assert.equal((await db.query('select web_panel_snapshot() value')).rows[0].value.history.length,1);
 if(process.env.TALLER_DELTA_TEST){
  await db.exec("reset role;update workshop_settings set operational=false;create schema storage;create table storage.objects(bucket_id text,name text);insert into auth.users(id) values('5799fac7-852e-4261-9717-015a2d287463') on conflict do nothing;");
  const batch=JSON.parse(await readFile('outputs/supabase-web/taller-cutover/records.json','utf8'));
  for(const r of batch){
   await db.query("insert into workshop_assets(id,code,name,section,total_milli) values($1,$2,'Imported','Herramientas Taller',$3)",[r.asset_id,r.asset_id,r.expected_total]);
   if(r.payload.evidence_path)await db.query("insert into storage.objects(bucket_id,name) values('movement-evidence',$1)",[r.payload.evidence_path]);
  }
  const sql=await readFile('outputs/supabase-web/taller-cutover/import.sql','utf8');
  await db.exec(sql);await db.exec(sql);
  assert.equal(Number((await db.query('select sum(loaned_milli) n from workshop_assets where id=any($1::uuid[])',[batch.map(r=>r.asset_id)])).rows[0].n),4000);
  assert.equal(Number((await db.query('select count(*) n from workshop_loans where id=any($1::uuid[])',[batch.map(r=>r.id)])).rows[0].n),4);
 }
 await db.exec('reset role;update operators set active=false;set role authenticated;');
 await assert.rejects(()=>db.query('select web_panel_snapshot()'),/autorizado/);
 await db.exec('reset role;set role anon;');await assert.rejects(()=>db.query('select web_panel_snapshot()'),/permission denied/);
 console.log('PASS: coherent snapshot, linked prices, role checks, disabled operator, anon denial, atomic closes, lot conservation, reconciliation and no duplicate loans.');
}finally{await db.close();}

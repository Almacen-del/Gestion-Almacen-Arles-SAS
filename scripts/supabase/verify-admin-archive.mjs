import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {prepareAdminArchive,archiveSqlBatches,sqlString} from './admin-archive.mjs';

const runtime=process.env.PGLITE_MODULE;
if(!runtime) throw new Error('Indica PGLITE_MODULE al módulo local de PGlite.');
const {PGlite}=await import(pathToFileURL(runtime).href);
const raw=await readFile(process.argv[2],'utf8');
const source=JSON.parse(raw);
const plan=prepareAdminArchive(source,raw);
const db=new PGlite();
try {
 await db.exec('create role anon; create role authenticated;');
 await db.exec(await readFile('supabase/migrations/202609240001_web_admin_archive.sql','utf8'));
 await db.query('insert into web_admin_imports(source_hash,source_read_time,expected_count,archive_sha256,counts) values($1,$2,$3,$4,$5)',[plan.sourceHash,plan.readTime,plan.records.length,plan.archiveHash,JSON.stringify(plan.counts)]);
 await assert.rejects(()=>db.query('select web_admin_verify_archive($1)',[plan.sourceHash]));
 const batches=archiveSqlBatches(plan);
 for(const sql of batches) await db.exec(sql);
 // Retrying a batch must neither duplicate records nor change the archive.
 await db.exec(batches[0]);
 const result=(await db.query('select web_admin_verify_archive($1) result',[plan.sourceHash])).rows[0].result;
 assert.equal(result.documents,plan.records.length);
 assert.equal(result.verified,true);
 assert.deepEqual(result.counts,plan.counts);
 const stored=(await db.query('select path,raw_document from web_admin_archive order by path collate "C"')).rows;
 assert.deepEqual(stored,plan.records.map(row=>({path:row.path,raw_document:row.raw})));
 await assert.rejects(()=>db.exec(`update web_admin_archive set raw_document='{}' where source_hash=${sqlString(plan.sourceHash)}`));
 await db.exec('set role authenticated;');
 await assert.rejects(()=>db.query('select * from web_admin_archive'));
 await assert.rejects(()=>db.query('select web_admin_verify_archive($1)',[plan.sourceHash]));
 await db.exec('reset role;set role anon;');
 await assert.rejects(()=>db.query('select * from web_admin_imports'));
 assert.throws(()=>prepareAdminArchive({...source,documents:[source.documents[0],source.documents[0]]},raw),/duplicado/);
 assert.throws(()=>prepareAdminArchive({...source,project:'other'},raw),/Fuente/);
 console.log(JSON.stringify({result:'PASS',documents:stored.length,counts:result.counts,exactDocumentMatch:true,retrySafe:true,incompleteRejected:true,tamperingRejected:true,anonymousAndAuthenticatedDenied:true},null,2));
} finally {await db.close();}

import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {prepareAdminArchive, archiveSqlBatches, sqlString} from './admin-archive.mjs';

const input = process.argv[2];
if (!input) throw new Error('Indica el source.json de una lectura consistente.');
const sourceText = await readFile(input,'utf8');
const plan = prepareAdminArchive(JSON.parse(sourceText), sourceText);
const directory = resolve('outputs/supabase-web/admin-'+plan.sourceHash.slice(0,12));
await mkdir(directory,{recursive:true});
await writeFile(directory+'/manifest.json',JSON.stringify({...plan,records:plan.records.map(({path,sha256})=>({path,sha256}))},null,2));
await writeFile(directory+'/000-iniciar.sql',`begin;\ninsert into public.web_admin_imports(source_hash,source_read_time,expected_count,archive_sha256,counts) values (${sqlString(plan.sourceHash)},${sqlString(plan.readTime)},${plan.records.length},${sqlString(plan.archiveHash)},${sqlString(JSON.stringify(plan.counts))}::jsonb) on conflict(source_hash) do nothing;\ncommit;\n`);
const chunks=archiveSqlBatches(plan);
for(let i=0;i<chunks.length;i++) await writeFile(`${directory}/${String(i+1).padStart(3,'0')}-datos.sql`,chunks[i]);
await writeFile(directory+'/999-verificar.sql',`select public.web_admin_verify_archive(${sqlString(plan.sourceHash)});\n`);
console.log(JSON.stringify({directory,sourceReadTime:plan.readTime,documents:plan.records.length,counts:plan.counts,batches:chunks.length,stockWrites:0,authChanges:0},null,2));

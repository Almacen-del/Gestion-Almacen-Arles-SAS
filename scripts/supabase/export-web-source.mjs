import {execSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const token=execSync('gcloud auth print-access-token',{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const base='https://firestore.googleapis.com/v1/projects/arles-gestion/databases/(default)/documents';
async function query(collectionId,readTime,allDescendants=false){
 const response=await fetch(base+':runQuery',{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Goog-User-Project':'arles-gestion','Content-Type':'application/json'},body:JSON.stringify({...(readTime?{readTime}:{}),structuredQuery:{from:[{collectionId,allDescendants}]}}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`Read ${collectionId}: HTTP ${response.status}`);
 return response.json();
}
const first=await query('existencias');const readTime=first[0]?.readTime;if(!readTime)throw Error('Missing consistent read time');
const docs=new Map(first.filter(x=>x.document).map(x=>[x.document.name,x.document]));
const sources=['productos_aseo','herramientas','usuarios','movimientos','historial_movimientos','historial_cambios','operaciones_inventario','valoraciones_inventario','valoraciones_entradas','cierres_valoracion_inventario','lotes_agroquimicos','asignaciones_entradas_agroquimicos','items','recuperaciones'];
const counts={existencias:docs.size};
for(const collection of sources){
 const rows=(await query(collection,readTime,true)).filter(x=>x.document).map(x=>x.document);
 for(const row of rows)docs.set(row.name,row);counts[collection]=rows.length;
}
const directory='outputs/supabase-web/'+readTime.replace(/[:.]/g,'-');await mkdir(directory,{recursive:true});
const raw=JSON.stringify({project:'arles-gestion',readTime,documents:[...docs.values()]});
await writeFile(directory+'/source.json',raw,{flag:'wx'});
await writeFile(directory+'/manifest.json',JSON.stringify({readTime,counts,documents:docs.size,sha256:createHash('sha256').update(raw).digest('hex'),complete:true,remoteWrites:0},null,2),{flag:'wx'});
console.log(JSON.stringify({directory,readTime,counts,documents:docs.size,remoteWrites:0},null,2));

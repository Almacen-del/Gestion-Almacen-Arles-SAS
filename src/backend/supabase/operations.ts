import type {SupabaseClient} from '@supabase/supabase-js';
/** Preserve request identity until a definitive server response is received. */
export class WebOperations {
 private pending=new Map<string,{args:Record<string,unknown>;signature:string}>();
 constructor(private client:Pick<SupabaseClient,'rpc'>){}
 async save(name:string,key:string,args:Record<string,unknown>){
  const signature=JSON.stringify(args),id=`${name}:${key}`;
  let pending=this.pending.get(id);
  if(pending&&pending.signature!==signature)throw Error('Reintenta primero el cambio pendiente para confirmar su resultado.');
  if(!pending){pending={signature,args:{p_request_id:crypto.randomUUID(),...args}};this.pending.set(id,pending);}
  const {data,error}=await this.client.rpc(name,pending.args);
  if(error){
   if(error.code==='P0001'||error.code==='42501'){this.pending.delete(id);throw Error(error.code==='P0001'?error.message:'No tienes permiso para guardar este cambio.');}
   throw Error('No se pudo confirmar el cambio. Reintenta la misma operación.');
  }
  if(!data||typeof data!=='object')throw Error('Confirmación incompleta. Reintenta la misma operación.');
  this.pending.delete(id);return data;
 }
}

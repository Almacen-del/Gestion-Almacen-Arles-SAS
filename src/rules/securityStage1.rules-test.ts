import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {assertFails,assertSucceeds,initializeTestEnvironment,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDoc,runTransaction,writeBatch,serverTimestamp,type Firestore} from 'firebase/firestore';
import {saveMonthlyActivity,loadMonthlyActivity,monthlyActivityMetadata} from '../valuation/monthlyActivityStorage';
import type {MonthlyActivitySnapshot} from '../valuation/monthlyActivity';

let env:RulesTestEnvironment;
beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-arles-security-stage1',firestore:{rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,rol] of [['operator','operador'],['warehouse','almacenista'],['admin','admin']])await setDoc(doc(db,'usuarios',uid),{activo:true,rol});
  await setDoc(doc(db,'existencias/p1'),{modulo:'EPP',cantidad:100,stock_actual:100});
  await setDoc(doc(db,'productos_aseo/p1'),{modulo:'ASEO',cantidad:100,stock_actual:100});
  await setDoc(doc(db,'herramientas/t1'),{cantidad:3,cantidad_total:3,cantidad_disponible:2,cantidad_ocupada:1,estado:'Disponible'});
  await setDoc(doc(db,'movimientos/m1'),{tipo:'Salida',cantidad:2,producto_id:'p1',fecha:'2026-09-05',observaciones:'Original'});
 });
});
afterAll(async()=>{await env?.cleanup();});
const dbFor=(uid='operator')=>env.authenticatedContext(uid,{email:uid==='owner'?'almacen@arlessas.com':uid+'@arlessas.com'}).firestore() as unknown as Firestore;
const closePayload=(uid='warehouse',state='guardando',attempt='a1')=>({periodo:'2026-09',estado:state,usuario_uid:uid,intento_id:attempt,resumen:{valor_total:100,cantidad_productos:1},verificacion:{cantidad_items:0,verificado:false}});
async function seedClose(state='completo'){
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'cierres_valoracion_inventario/2026-09'),closePayload('warehouse',state));
  await setDoc(doc(ctx.firestore(),'cierres_valoracion_inventario/2026-09/items/p1'),{intento_id:'a1',valor_total:100});
  await setDoc(doc(ctx.firestore(),'cierres_valoracion_inventario/2026-09/movimientos/m1'),{intento_id:'a1',detalle:{expense:10}});
 });
}

describe('Stage 1: append-only movement history and inventory safety',()=>{
 it.each(['operator','warehouse','admin','owner'])('%s cannot edit or delete existing movements',async uid=>{
  const ref=doc(dbFor(uid),'movimientos/m1');
  await assertFails(updateDoc(ref,{cantidad:999}));
  await assertFails(updateDoc(ref,{observaciones:'Changed'}));
  await assertFails(deleteDoc(ref));
 });
 it('permits identical retries without mutating the original movement',async()=>{
  const ref=doc(dbFor(),'movimientos/m1');const data=(await getDoc(ref)).data();await assertSucceeds(setDoc(ref,data!));
 });
 it.each(['cantidad','stock_actual','stock','saldo'])('rejects negative or invalid %s in an inventory update',async field=>{
  const ref=doc(dbFor(),'existencias/p1');
  await assertFails(updateDoc(ref,{[field]:-1}));await assertFails(updateDoc(ref,{[field]:'-1'}));
 });
 it.each(['existencias/p1','productos_aseo/p1','herramientas/t1'])('does not permit destructive deletion of %s',async path=>{
  await assertFails(deleteDoc(doc(dbFor(),path)));await assertFails(deleteDoc(doc(dbFor('owner'),path)));
  await assertFails(setDoc(doc(dbFor(),path),{}));
  await assertFails(setDoc(doc(dbFor(),path),{cantidad:0}));
 });
 it('rejects NaN/infinite stock and refuses operator lot assignment',async()=>{
  const db=dbFor();await assertFails(updateDoc(doc(db,'existencias/p1'),{cantidad:Infinity}));
  await assertFails(updateDoc(doc(db,'existencias/p1'),{cantidad:NaN}));
  await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'existencias/agro'),{modulo:'Agroquimicos',cantidad:10});});
  await assertFails(setDoc(doc(db,'existencias/agro/lotes_agroquimicos/L1'),{producto_id:'agro',numero_lote:'L1',fecha_vencimiento:'2027-01',cantidad_inicial:10,cantidad_disponible:10,unidad:'GRAMO'}));
 });
 it('retains mobile entry transactions, timestamps, decimals and stock aliases',async()=>{
  const db=dbFor();const ref=doc(db,'existencias/p1');const movement=doc(db,'movimientos/mobile-entry');
  await assertSucceeds(runTransaction(db,async tx=>{
   const p=await tx.get(ref);const before=p.data()!.cantidad;
   tx.set(ref,{cantidad:before+3.5,stock_actual:before+3.5},{merge:true});
   tx.set(movement,{tipo:'Entrada',clase_movimiento:'entrada_stock',modulo:'EPP',cantidad:3.5,producto_id:'p1',documento_id:'p1',stock_anterior:before,stock_nuevo:before+3.5,stock_actualizado:true,creado_en:serverTimestamp()});
  }));
  expect((await getDoc(ref)).data()!.cantidad).toBe(103.5);
 });
 it.each(['existencias/p1','productos_aseo/p1'])('retains mobile exit transaction for %s',async productPath=>{
  const db=dbFor(),ref=doc(db,productPath);
  await assertSucceeds(runTransaction(db,async tx=>{
   const p=await tx.get(ref);const stock=p.data()!.stock_actual;
   tx.set(ref,{cantidad:stock-2.25,stock_actual:stock-2.25},{merge:true});
   tx.set(doc(db,'movimientos/mobile-exit'),{tipo:'Salida',tipoMovimiento:'Salida',cantidad:2.25,producto_id:'p1',fecha:'2026-09-05',solicitante:'Persona de prueba'});
  }));
 });
 it('permits decimal-string tool movements and tool operational updates',async()=>{
  const db=dbFor();await assertSucceeds(setDoc(doc(db,'movimientos/tool-exit'),{tipoMovimiento:'Salida',modulo:'TALLER',cantidad:'1.5'}));
  await assertSucceeds(updateDoc(doc(db,'herramientas/t1'),{estado:'Ocupado',vehiculo_asignado:'Tractor 3',ultima_actualizacion:'2026-09-05'}));
  await assertFails(updateDoc(doc(db,'herramientas/t1'),{cantidad_total:-1}));
 });
 it('rejects negative movement quantities and modification of stock-entry history',async()=>{
  const db=dbFor();await assertFails(setDoc(doc(db,'movimientos/bad'),{cantidad:-3}));
  await assertFails(setDoc(doc(db,'movimientos/bad'),{cantidad:'-3'}));
  const ref=doc(db,'entradas_stock/e1');await assertSucceeds(setDoc(ref,{cantidad:3}));
  await assertFails(updateDoc(ref,{cantidad:4}));await assertFails(deleteDoc(ref));
 });
});

describe('Stage 1: financial roles and completed-close immutability',()=>{
 it('pending registration cannot preseed an administrative legacy role',async()=>{
  const db=dbFor('pending'),ref=doc(db,'usuarios/pending');
  const profile={email:'pending@arlessas.com',rol:'pendiente',activo:false,estado:'pendiente'};
  await assertFails(setDoc(ref,{...profile,role:'admin'}));
  await assertSucceeds(setDoc(ref,{...profile,role:'pendiente'}));
 });
 it('operators can read but cannot write valuations or create a close',async()=>{
  const db=dbFor();await assertSucceeds(getDoc(doc(db,'valoraciones_inventario/p1')));
  await assertFails(setDoc(doc(db,'valoraciones_inventario/p1'),{valor_unitario:10,actualizado_por_uid:'operator'}));
  await assertFails(setDoc(doc(db,'valoraciones_entradas/e1'),{usuario_uid:'operator',valor_unitario_entrada:10}));
  await assertFails(setDoc(doc(db,'cierres_valoracion_inventario/2026-09'),closePayload('operator')));
 });
 it.each(['warehouse','admin','owner'])('%s can create a valuation but cannot impersonate another user',async uid=>{
  const ref=doc(dbFor(uid),'valoraciones_inventario/p1');
  await assertSucceeds(setDoc(ref,{valor_unitario:10,actualizado_por_uid:uid}));
  await assertFails(updateDoc(ref,{valor_unitario:-1}));
  await assertFails(updateDoc(ref,{actualizado_por_uid:'somebody-else'}));
  await assertFails(deleteDoc(ref));
 });
 it.each(['operator','warehouse','admin','owner'])('%s cannot alter or delete completed header or detail',async uid=>{
  await seedClose();const db=dbFor(uid);
  for(const path of ['cierres_valoracion_inventario/2026-09','cierres_valoracion_inventario/2026-09/items/p1','cierres_valoracion_inventario/2026-09/movimientos/m1']){
   await assertFails(updateDoc(doc(db,path),{'resumen.valor_total':0}));await assertFails(deleteDoc(doc(db,path)));
  }
  await assertFails(setDoc(doc(db,'cierres_valoracion_inventario/2026-09/items/extra'),{intento_id:'a1'}));
  await assertFails(updateDoc(doc(db,'cierres_valoracion_inventario/2026-09'),{estado:'guardando'}));
 });
 it('only the creator manages an open attempt, including batched details',async()=>{
  const db=dbFor('warehouse'),ref=doc(db,'cierres_valoracion_inventario/2026-09');
  await assertSucceeds(setDoc(ref,closePayload()));
  await assertFails(setDoc(doc(dbFor('admin'),'cierres_valoracion_inventario/2026-09/items/p1'),{intento_id:'a1'}));
  await assertFails(setDoc(doc(db,'cierres_valoracion_inventario/2026-09/items/p1'),{intento_id:'other-attempt'}));
  const batch=writeBatch(db);for(let i=0;i<25;i++)batch.set(doc(db,`cierres_valoracion_inventario/2026-09/items/p${i}`),{intento_id:'a1',valor_total:4});
  await assertSucceeds(batch.commit());
  await assertSucceeds(deleteDoc(doc(db,'cierres_valoracion_inventario/2026-09/items/p24')));
 });
 it('cannot create already-complete, unowned or invalid-period closes',async()=>{
  const db=dbFor('warehouse');
  await assertFails(setDoc(doc(db,'cierres_valoracion_inventario/2026-09'),closePayload('warehouse','completo')));
  await assertFails(setDoc(doc(db,'cierres_valoracion_inventario/2026-09'),closePayload('another')));
  await assertFails(setDoc(doc(db,'cierres_valoracion_inventario/2026-13'),{...closePayload(),periodo:'2026-13'}));
 });
 it('completion retains financial payload and freezes all subsequent detail writes',async()=>{
  const db=dbFor('warehouse'),ref=doc(db,'cierres_valoracion_inventario/2026-09');await assertSucceeds(setDoc(ref,closePayload()));
  await assertFails(updateDoc(ref,{estado:'completo'}));
  await assertFails(updateDoc(ref,{estado:'completo',resumen:{valor_total:0,cantidad_productos:1},verificacion:{verificado:true,cantidad_items:1}}));
  await assertSucceeds(updateDoc(ref,{estado:'completo',fecha:serverTimestamp(),verificacion:{verificado:true,cantidad_items:1}}));
  await assertFails(setDoc(doc(db,'cierres_valoracion_inventario/2026-09/items/p1'),{intento_id:'a1'}));
 });
 it('can retry a failed close only as its original creator with a new attempt',async()=>{
  await seedClose('guardando');const db=dbFor('warehouse'),ref=doc(db,'cierres_valoracion_inventario/2026-09');
  await assertSucceeds(updateDoc(ref,{estado:'error'}));
  await assertFails(setDoc(doc(dbFor('admin'),'cierres_valoracion_inventario/2026-09'),closePayload('admin','guardando','a2')));
  await assertFails(setDoc(ref,closePayload()));await assertSucceeds(setDoc(ref,closePayload('warehouse','guardando','a2')));
  await assertSucceeds(deleteDoc(doc(db,'cierres_valoracion_inventario/2026-09/items/p1')));
 });
 it('denies rewriting detail in the same batch that completes a close',async()=>{
  await seedClose('guardando');const db=dbFor('warehouse'),batch=writeBatch(db);
  batch.set(doc(db,'cierres_valoracion_inventario/2026-09/items/p1'),{intento_id:'a1',valor_total:0});
  batch.update(doc(db,'cierres_valoracion_inventario/2026-09'),{estado:'completo',verificacion:{verificado:true,cantidad_items:1}});
  await assertFails(batch.commit());
 });
 it('validates the real monthly activity save/load workflow under its open parent',async()=>{
  const db=dbFor('warehouse');await setDoc(doc(db,'cierres_valoracion_inventario/2026-09'),closePayload());
  const activity:MonthlyActivitySnapshot={period:'2026-09',cutoffAt:'2026-09-05T12:00:00Z',invalidDateCount:0,invalidQuantityCount:0,rows:[{id:'m1',kind:'exit',occurredAt:'2026-09-01',moduleName:'EPP',productId:'p1',code:'P1',product:'Guantes',reference:'',quantity:2,unit:'Unidad',destinationLot:'Personal',recipientId:'test',recipientName:'Test',unitValue:10,priceUnit:'Unidad',expense:20,issue:''}]};
  await assertSucceeds(saveMonthlyActivity(activity,'a1',db));
  expect((await loadMonthlyActivity(monthlyActivityMetadata(activity),db)).rows).toEqual(activity.rows);
 });
});

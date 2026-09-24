import { describe, expect, it } from 'vitest';
import { SupabaseWarehouseReader } from './reader';
import { quantityFromMilli, type RpcTransport } from './contracts';

const receipt = (id: string, position = 'position-1') => ({ event_id: id, position_id: position,
  module_id: 'ASEO', kind: 'SALIDA', quantity_milli: 1000 });
describe('Supabase read contract for the existing panel', () => {
  it('keeps different lots/positions of the same product instead of silently dropping them', async () => {
    const rpc: RpcTransport = { call: async () => ['p1', 'p2'].map(position_id => ({position_id,
      product_id: 'same-product', module_id: 'AGROQUIMICOS', quantity_milli: 7390})) };
    const rows = await new SupabaseWarehouseReader(rpc).catalog();
    expect(rows).toHaveLength(2); expect(quantityFromMilli(rows[0].quantity_milli)).toBe(7.39);
  });
  it('rejects rounded, negative or unsafe stock values', () => {
    for(const value of [NaN, -1, Infinity, 0.1, Number.MAX_SAFE_INTEGER]) expect(() => quantityFromMilli(value)).toThrow();
    expect(quantityFromMilli(0)).toBe(0);
  });
  it('paginates complete receipts and keeps several lines in one event', async () => {
    const first = Array.from({length:100}, (_,i) => receipt(String(i).padStart(3,'0')));
    const last = {...receipt('100'),items:[receipt('100','p1'),receipt('100','p2')]};
    const cursors: unknown[]=[];
    const rpc: RpcTransport = {call:async (_name,args) => {cursors.push(args.p_after);return args.p_after === null ? first : [last];}};
    const rows = await new SupabaseWarehouseReader(rpc).confirmed();
    expect(rows).toHaveLength(101); expect(rows.at(-1)?.items).toHaveLength(2); expect(cursors).toEqual([null,'099']);
  });
  it('rejects repeated pages rather than reporting incomplete or duplicate history', async () => {
    const first=Array.from({length:100},(_,i)=>receipt(String(i).padStart(3,'0')));
    await expect(new SupabaseWarehouseReader({call:async()=>first}).confirmed()).rejects.toThrow('cursor');
  });
  it('does not return a partial dataset if a later page fails', async () => {
    await expect(new SupabaseWarehouseReader({call:async(_n,a)=>{
      if(a.p_after!==null)throw Error('offline');
      return Array.from({length:100},(_,i)=>receipt(String(i).padStart(3,'0')));
    }}).confirmed()).rejects.toThrow('offline');
  });
  it('rejects a line belonging to another receipt or a duplicate position', async () => {
    for(const items of [[receipt('different')],[receipt('a'),receipt('a')]])
      await expect(new SupabaseWarehouseReader({call:async()=>[{...receipt('a'),items}]}).confirmed()).rejects.toThrow();
  });
  it('reads all seven historical modules and retains missing original dates', async () => {
    const modules:string[]=[];
    const rows=await new SupabaseWarehouseReader({call:async(_n,a)=>{
      modules.push(a.p_module as string);return [{source_path:`movimientos/${a.p_module}`,module_id:a.p_module,quantity:null,date_original:''}];
    }}).historical();
    expect(modules).toHaveLength(7);expect(rows).toHaveLength(7);expect(rows[0].quantity).toBeNull();
  });
  it('does not fetch if cancelled', async () => {
    const controller=new AbortController();controller.abort();let calls=0;
    await expect(new SupabaseWarehouseReader({call:async()=>{calls++;return []}}).catalog(controller.signal)).rejects.toThrow();
    expect(calls).toBe(0);
  });
});

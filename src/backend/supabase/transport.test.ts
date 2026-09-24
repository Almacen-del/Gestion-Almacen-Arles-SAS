import { expect, it, vi } from 'vitest';
import { createSupabaseReaderTransport, SessionRequiredError } from './transport';
const config={url:'https://gfgsnnweyfryfcqdnlvw.supabase.co',publishableKey:'sb_publishable_TEST',now:()=>1000};
it('never transmits without a valid Supabase session',async()=>{
  const request=vi.fn();
  for(const token of [null,{value:'LOCAL',expiresAt:1000}]) {
    const reader=createSupabaseReaderTransport({...config,accessToken:async()=>token,fetch:request});
    await expect(reader.call('warehouse_catalog',{p_offset:0})).rejects.toBeInstanceOf(SessionRequiredError);
  }
  expect(request).not.toHaveBeenCalled();
});
it('uses only the pinned project and read functions',async()=>{
  const token={value:'LOCAL_TOKEN',expiresAt:2000};
  const request=vi.fn(async()=>new Response('[]',{status:200}));
  const reader=createSupabaseReaderTransport({...config,accessToken:async()=>token,fetch:request});
  await reader.call('warehouse_catalog',{p_offset:200});
  expect(request.mock.calls[0]).toEqual(['https://gfgsnnweyfryfcqdnlvw.supabase.co/rest/v1/rpc/warehouse_catalog',expect.objectContaining({
    method:'POST',redirect:'error',credentials:'omit',body:'{"p_offset":200}',
  })]);
  await expect(reader.call('register_warehouse_movement',{})).rejects.toThrow('no permitida');
  expect(request).toHaveBeenCalledTimes(1);
  expect(()=>createSupabaseReaderTransport({...config,url:'https://other.supabase.co',accessToken:async()=>token})).toThrow();
  expect(()=>createSupabaseReaderTransport({...config,publishableKey:'service_role_secret',accessToken:async()=>token})).toThrow();
});
it('does not leak backend error bodies and rejects revoked permissions',async()=>{
  for(const status of [401,403,500]) {
    const reader=createSupabaseReaderTransport({...config,accessToken:async()=>({value:'LOCAL',expiresAt:2000}),
      fetch:vi.fn(async()=>new Response('PRIVATE_BACKEND_DETAIL',{status}))});
    try {await reader.call('warehouse_catalog',{});throw Error('Expected rejection')}
    catch(error){expect(String(error)).not.toContain('PRIVATE_BACKEND_DETAIL')}
  }
});

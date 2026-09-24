import {describe,it,expect,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {validateSupabaseConfig,SUPABASE_PROJECT_URL,validateEvidencePath,signInToWeb} from './client';

describe('Supabase web boundary',()=>{
  it('pins the inventory project and rejects privileged keys',()=>{
    expect(()=>validateSupabaseConfig(SUPABASE_PROJECT_URL,'sb_publishable_example')).not.toThrow();
    expect(()=>validateSupabaseConfig('https://other.supabase.co','sb_publishable_example')).toThrow();
    expect(()=>validateSupabaseConfig(SUPABASE_PROJECT_URL,'sb_secret_example')).toThrow();
    expect(()=>validateSupabaseConfig(SUPABASE_PROJECT_URL,'eyJlegacy')).toThrow();
  });
  it('rejects external photo URLs and traversal before any request',()=>{
    for(const value of ['https://other/photo.jpg','../photo.jpg','legacy/%2fphoto.jpg','legacy/a.jpg?token=x','/legacy/a.jpg'])
      expect(()=>validateEvidencePath(value)).toThrow();
    expect(()=>validateEvidencePath('legacy/abc123.jpg')).not.toThrow();
    expect(()=>validateEvidencePath('operator-uuid/event-uuid/photo.jpeg')).not.toThrow();
  });
  it('normalizes email without modifying the password or disclosing auth errors',async()=>{
    const signInWithPassword=vi.fn().mockResolvedValue({data:{session:null},error:{message:'private service detail'}});
    const client={auth:{signInWithPassword}} as unknown as SupabaseClient;
    await expect(signInToWeb(client,'  Almacen@ArlesSAS.com ','  exact password  ')).rejects.toThrow('Verifica el correo');
    expect(signInWithPassword).toHaveBeenCalledWith({email:'almacen@arlessas.com',password:'  exact password  '});
    signInWithPassword.mockClear();
    await expect(signInToWeb(client,'someone@other.com','password')).rejects.toThrow('corporativo');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

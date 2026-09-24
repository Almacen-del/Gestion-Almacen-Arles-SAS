import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create table web_profiles(user_id uuid primary key,display_name text,job_title text,role text,active boolean,approved boolean);insert into auth.users values('00000000-0000-4000-8000-000000000001','admin@arlessas.com','{}'),('00000000-0000-4000-8000-000000000002','pending@arlessas.com','{"display_name":"Pending"}');insert into web_profiles values('00000000-0000-4000-8000-000000000001','Owner','','ADMIN',true,true);`);
 await db.exec(await readFile('supabase/migrations/202609240016_web_pending_accounts.sql','utf8'));
 const existing=(await db.query('select * from web_profiles order by user_id')).rows;
 assert.equal(existing[0].role,'ADMIN');assert.equal(existing[0].active,true);
 assert.equal(existing[1].active,false);assert.equal(existing[1].approved,false);
 await db.exec(`insert into auth.users values('00000000-0000-4000-8000-000000000003','new@arlessas.com','{"role":"ADMIN","active":true}'),('00000000-0000-4000-8000-000000000004','outsider@example.com','{}');`);
 const added=(await db.query("select * from web_profiles where user_id='00000000-0000-4000-8000-000000000003'")).rows[0];assert.equal(added.role,'READER');assert.equal(added.active,false);assert.equal(added.approved,false);
 assert.equal((await db.query('select count(*) n from web_profiles')).rows[0].n,3);
 console.log('PASS: existing administrator preserved, backfill pending, new accounts pending, metadata cannot grant access, external domain excluded.');
}finally{await db.close();}

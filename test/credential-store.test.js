import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,readdir,rm,writeFile} from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {CredentialStore} from '../credential-store.js';
// Isolated fixture encryption stands in for Keychain. Never touches user data.
const fixtureKey='fixture-key-not-real';
async function fixture(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'copilot-credential-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const secret=randomBytes(32), calls={encrypt:0,decrypt:0}; let locked=false;
  const storage={
    isEncryptionAvailable(){throw Error('Legacy availability must not gate the async provider');},
    async encryptStringAsync(value){calls.encrypt++;if(locked)throw Error('denied');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);},
    async decryptStringAsync(value){calls.decrypt++;if(value.length<28)throw Error('invalid fixture');if(locked)throw Error('denied');const cipher=createDecipheriv('aes-256-gcm',secret,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));return {result:Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString(),shouldReEncrypt:false};}
  };
  const filename=path.join(dir,'openai.enc');
  return {dir,filename,storage,calls,lock:v=>{locked=v;},create:options=>new CredentialStore({filename,storage,...options})};
}
test('save once restores across process instances and settings saves do not re-encrypt',async t=>{
  const f=await fixture(t),first=f.create();await first.load();await first.save({newKey:fixtureKey});
  assert.equal((await stat(f.filename)).mode&0o777,0o600);
  const bytes=await readFile(f.filename);assert.ok(!bytes.includes(fixtureKey));
  const reopened=f.create();assert.deepEqual(await reopened.load(),{hasKey:true,saved:true,keyStorageState:'saved'});assert.equal(reopened.key,fixtureKey);
  const count=f.calls.encrypt;await reopened.save({newKey:'',remember:true});assert.equal(f.calls.encrypt,count);assert.deepEqual(await readFile(f.filename),bytes);
  assert.deepEqual(Object.keys(reopened.status()).sort(),['hasKey','keyStorageState','saved']);
});
test('locked saved key survives blank settings saves and restores after access returns',async t=>{
  const f=await fixture(t);await f.create().save({newKey:fixtureKey});const before=await readFile(f.filename);f.lock(true);
  const reopened=f.create();assert.deepEqual(await reopened.load(),{hasKey:false,saved:true,keyStorageState:'locked'});
  await reopened.save({newKey:'',remember:true});assert.deepEqual(await readFile(f.filename),before);
  f.lock(false);assert.equal((await reopened.load()).hasKey,true);assert.equal(reopened.key,fixtureKey);
});
test('failed replacement keeps saved ciphertext and working in-memory credential',async t=>{
  const f=await fixture(t),store=f.create();await store.save({newKey:fixtureKey});const before=await readFile(f.filename);f.lock(true);
  await assert.rejects(store.save({newKey:'sk-other-fixture'}),/Nothing was replaced/);
  assert.equal(store.key,fixtureKey);assert.deepEqual(await readFile(f.filename),before);
});
test('failed atomic replacement leaves previous key usable and removes temporary file',async t=>{
  const f=await fixture(t);await f.create().save({newKey:fixtureKey});const before=await readFile(f.filename);
  const store=f.create({fs:{...fs,rename:async()=>{throw Error('disk failure');}}});await store.load();
  await assert.rejects(store.save({newKey:'sk-other-fixture'}),/existing saved key is unchanged/);
  assert.equal(store.key,fixtureKey);assert.deepEqual(await readFile(f.filename),before);assert.deepEqual(await readdir(f.dir),['openai.enc']);
});
test('missing, unreadable and damaged files are distinct; none auto-delete data',async t=>{
  const f=await fixture(t);assert.equal((await f.create().load()).keyStorageState,'missing');
  const denied=f.create({fs:{...fs,readFile:async()=>{throw Object.assign(Error('denied'),{code:'EACCES'});}}});
  assert.equal((await denied.load()).keyStorageState,'locked');await denied.save({remember:true});
  await writeFile(f.filename,'fixture damaged ciphertext');const damaged=f.create();assert.equal((await damaged.load()).keyStorageState,'locked');
  await damaged.save({remember:true});assert.equal(await readFile(f.filename,'utf8'),'fixture damaged ciphertext');
});
test('async provider failure never falls back to insecure or legacy storage',async t=>{
  const f=await fixture(t);let legacy=false;
  const store=f.create({storage:{...f.storage,async encryptStringAsync(){throw Error('denied');},encryptString(){legacy=true;return Buffer.from('plaintext');}}});
  await assert.rejects(store.save({newKey:fixtureKey}));assert.equal(legacy,false);assert.equal(store.status().saved,false);assert.deepEqual(await readdir(f.dir),[]);
});
test('provider plaintext or an un-restorable ciphertext is rejected before disk mutation',async t=>{
  const f=await fixture(t);
  for(const storage of [{...f.storage,encryptStringAsync:async value=>Buffer.from(value)},{...f.storage,decryptStringAsync:async()=>({result:'wrong fixture'})}]){
    await assert.rejects(f.create({storage}).save({newKey:fixtureKey}));assert.deepEqual(await readdir(f.dir),[]);
  }
});
test('only explicit remember-off or forget removes persisted key',async t=>{
  const f=await fixture(t),store=f.create();await store.save({newKey:fixtureKey});await store.save({remember:false});
  assert.deepEqual(store.status(),{hasKey:true,saved:false,keyStorageState:'session'});assert.deepEqual(await readdir(f.dir),[]);
  await store.save({remember:true});await store.forget();assert.equal(store.key,'');assert.equal(store.status().keyStorageState,'missing');assert.deepEqual(await readdir(f.dir),[]);
});
test('concurrent save and forget serialize so a late save cannot resurrect a forgotten key',async t=>{
  const f=await fixture(t),store=f.create();await Promise.all([store.save({newKey:fixtureKey}),store.forget()]);
  assert.equal(store.key,'');assert.deepEqual(await readdir(f.dir),[]);
});

import * as files from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Main process only. Never expose the decrypted key through IPC or logs.
export class CredentialStore {
  constructor({filename,storage,initialKey='',fs=files}) {
    Object.assign(this,{filename,storage,fs});this.key=initialKey;this.saved=false;this.unavailable=false;this.queue=Promise.resolve();
  }
  status() {
    return {hasKey:Boolean(this.key),saved:this.saved,keyStorageState:this.unavailable?'locked':this.saved?'saved':this.key?'session':'missing'};
  }
  serialize(operation) {
    const next=this.queue.then(operation);this.queue=next.catch(()=>{});return next;
  }
  async decrypt(encrypted) {
    // Electron 44's async Keychain provider initializes independently of the
    // legacy sync availability flag. Never gate async access on that flag.
    if(typeof this.storage.decryptStringAsync==='function')return (await this.storage.decryptStringAsync(encrypted)).result;
    if(!this.storage.isEncryptionAvailable())throw new Error('Unavailable');
    return this.storage.decryptString(encrypted);
  }
  async encrypt(value) {
    if(typeof this.storage.encryptStringAsync==='function')return this.storage.encryptStringAsync(value);
    if(!this.storage.isEncryptionAvailable())throw new Error('Unavailable');
    return this.storage.encryptString(value);
  }
  load() {return this.serialize(async()=>{
    if(this.saved && !this.unavailable && this.key)return this.status();
    let encrypted;
    try{encrypted=await this.fs.readFile(this.filename);this.saved=true;}
    catch(error){
      if(error.code==='ENOENT'){this.saved=false;this.unavailable=false;}
      else {this.saved=true;this.unavailable=true;}
      return this.status();
    }
    try{
      const restored=await this.decrypt(encrypted);
      if(typeof restored!=='string' || !restored.trim())throw new Error('Unavailable');
      this.key=restored;this.unavailable=false;
    }catch{this.unavailable=true;}
    return this.status();
  });}
  save({newKey='',remember=true}) {return this.serialize(async()=>{
    // Blank field means keep the saved credential, including if it is locked.
    // Updating a name or notes must not touch or re-encrypt it.
    if(remember && this.saved && !newKey)return this.status();
    const value=newKey || this.key;
    if(remember && value){
      let encrypted;
      try{
        encrypted=await this.encrypt(value);
        if(!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.equals(Buffer.from(value)))throw new Error('Invalid encrypted result');
        // Confirm the secure provider can restore the new value before replacing
        // a working credential. Never write plaintext or a fallback local key.
        if(await this.decrypt(encrypted)!==value)throw new Error('Restore failed');
      }catch{throw new Error('macOS could not unlock secure key storage. Nothing was replaced. Allow Keychain access if prompted. If access was denied earlier, quit SalesCopilot with Command-Q and reopen it before saving again.');}
      const temporary=path.join(path.dirname(this.filename),'.openai-'+randomUUID()+'.tmp');
      try{
        await this.fs.writeFile(temporary,encrypted,{mode:0o600,flag:'wx'});
        await this.fs.rename(temporary,this.filename);
      }catch{
        await this.fs.unlink(temporary).catch(()=>{});
        throw new Error('Could not save the encrypted key. Your existing saved key is unchanged. Please try again.');
      }
      this.key=value;this.saved=true;this.unavailable=false;
    }else if(!remember){
      await this.removeFile();this.saved=false;this.unavailable=false;if(newKey)this.key=newKey;
    }
    return this.status();
  });}
  async removeFile(){try{await this.fs.unlink(this.filename);}catch(error){if(error.code!=='ENOENT')throw new Error('Could not remove the saved key. Please try again.');}}
  forget(){return this.serialize(async()=>{await this.removeFile();this.key='';this.saved=false;this.unavailable=false;return this.status();});}
}

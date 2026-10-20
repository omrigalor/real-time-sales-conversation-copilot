import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {coachingRequest,sessionConfig} from '../api.js';
import {openingLine} from '../app/scenarios.js';
import {loadCases,evaluateOne} from '../evaluation/runner.js';
import {buyerReplayRequest,replayBuyer} from '../evaluation/buyer-replay.js';

// Structural/integration tests only. Mocked replies do not establish naturalness.
test('pacing suite extends the original fixed cases and preserves an exact 1.0.9 snapshot',async()=>{
  const original=await loadCases(),extended=await loadCases({extended:true});
  assert.equal(original.cases.length,15);assert.equal(extended.cases.length,21);
  assert.deepEqual(extended.cases.slice(0,15),original.cases);
  assert.equal(new Set(extended.cases.map(c=>c.id)).size,21);
  assert.equal(extended.cases.filter(c=>c.kind==='buyer').length,2);
  const root=new URL('../evaluation/before-pacing/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  for(const [file,expected] of Object.entries(manifest.sha256))assert.equal(createHash('sha256').update(await readFile(new URL(file,root))).digest('hex'),expected,file);
});
test('opening is shared model reasoning with a fact-free identity fallback, not the old diagnostic script',async()=>{
  const c=(await loadCases({extended:true})).cases.find(c=>c.kind==='opening');
  const request=coachingRequest(c.payload),input=JSON.parse(request.input);
  assert.equal(input.preparing_opening,true);assert.equal(input.representative_name,'Omri');
  assert.equal(openingLine('cedar-onboarding','Lee'),"Hi, it’s Lee from Salesforce. Do you have a few minutes to chat?");
  assert.equal(input.practice_brief.id,'cedar-onboarding');
  assert.match(request.instructions,/EFFORT AND PACE/);
  assert.ok(!JSON.stringify(request).includes(c.manual_review));
  const old=await evaluateOne(c,'before-pacing',{key:'unused',fetcher:()=>assert.fail('Old UI opener was not model generated')});
  assert.match(old.spoken_line,/wanted to hear how onboarding is keeping up/);
  assert.equal(old.model,'No model — actual saved UI text');
});
function mockedSocket({reply='An independent buyer reply.',status='completed',failure=false}={}){
  const calls=[];let closed=false,options;
  const factory=(url,opts)=>{
    options={url,...opts};const socket=new EventEmitter();
    socket.close=()=>{closed=true;socket.emit('close');};
    socket.terminate=()=>socket.close();
    socket.send=raw=>{
      const event=JSON.parse(raw);calls.push(event);
      if(event.type==='session.update')queueMicrotask(()=>socket.emit('message',JSON.stringify({type:'session.updated',session:{model:event.session.model}})));
      if(event.type==='response.create')queueMicrotask(()=>socket.emit('message',JSON.stringify(failure?{type:'error',error:{code:'test_error'}}:{type:'response.done',response:{id:'mock-buyer',status,output:[{content:[{type:'output_text',text:reply}]}]}})));
    };
    queueMicrotask(()=>socket.emit('open'));return socket;
  };
  return {factory,calls,get closed(){return closed;},get options(){return options;}};
}
test('buyer replay uses the production buyer prompt/model and correct speaker mapping, with no coaching or reviewer leakage',async()=>{
  const c=(await loadCases({extended:true})).cases.find(c=>c.kind==='buyer');
  const mock=mockedSocket();
  const result=await evaluateOne(c,'current',{key:'test-secret',socketFactory:mock.factory,fetcher:()=>assert.fail('Buyer must use Realtime, not the coach model')});
  assert.equal(result.status,'completed');assert.equal(result.action,'BUYER REPLY');
  assert.equal(result.request.session.instructions,sessionConfig('simulation','',c.payload.scenarioId).instructions);
  assert.equal(result.request.items[0].role,'assistant');assert.equal(result.request.items[0].content[0].type,'output_text');
  assert.equal(result.request.items[1].role,'user');assert.equal(result.request.items[1].content[0].type,'input_text');
  assert.equal(mock.calls.filter(c=>c.type==='response.create').length,1);assert.equal(mock.closed,true);
  assert.deepEqual(result.request.session.output_modalities,['text']);
  assert.equal(result.request.session.audio.input.turn_detection,null);
  assert.ok(!JSON.stringify(result.request).includes(c.manual_review));
  assert.doesNotMatch(result.request.session.instructions,/EFFORT AND PACE|PROVISIONAL BDR TRANSCRIPT/);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
  assert.match(mock.options.url,/gpt-realtime-2.1/);
});
test('failed or incomplete buyer replay is visibly an error and closes its socket',async()=>{
  const c=(await loadCases({extended:true})).cases.find(c=>c.kind==='buyer');
  for(const options of [{failure:true},{status:'incomplete'},{reply:''}]){
    const mock=mockedSocket(options);
    const result=await evaluateOne(c,'before-pacing',{key:'test',socketFactory:mock.factory});
    assert.equal(result.status,'error');assert.equal(result.spoken_line,undefined);assert.equal(mock.closed,true);
  }
});
test('a disconnected or silent Realtime session cannot leave a development replay running forever',async()=>{
  const request=buyerReplayRequest({turns:[]},sessionConfig('simulation'));
  let closed=false;
  await assert.rejects(replayBuyer({key:'test',request,timeoutMs:10,socketFactory:()=>Object.assign(new EventEmitter(),{close(){closed=true;}})}),/timed out/);
  assert.equal(closed,true);
});

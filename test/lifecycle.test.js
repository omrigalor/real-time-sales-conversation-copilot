import test from 'node:test';
import assert from 'node:assert/strict';
import {lifecycleRequest,validateLifecycle,assessLifecycle} from '../call-lifecycle-api.js';
import {sessionConfig,coachingRequest} from '../api.js';
import {buyerAccountContext} from '../buyer-context.js';
import {VoiceSession} from '../app/session.js';
import {ObserveSession} from '../app/observe.js';
const turns=[{speaker:'buyer',text:'Send the overview first.'},{speaker:'seller',text:'I will send it this afternoon.'},{speaker:'buyer',text:'Thanks, that is all I need. Goodbye.'}];
const ended={phase:'ended',buyer_attention:'unknown',seller_repeated_commitment:false,evidence:[{turn:2,quote:'that is all I need'}],reason:'Buyer finished the call.'};
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('buyer account projection excludes seller notes, goals, unknowns and suggested products, even if marked public',()=>{
  const account={company:'Example',person:'Alex',objective:'SECRET_GOAL',notes:'SECRET_NOTES',known:'SECRET_KNOWN',unknown:'SECRET_UNKNOWN',recommendedLine:'SECRET_LINE',desiredNextStep:'SECRET_NEXT',evaluationRubric:'SECRET_RUBRIC',entries:[{kind:'user',text:'SECRET_USER_PLAN'},{kind:'hypothesis',text:'SECRET_HYPOTHESIS'},{kind:'unknown',text:'SECRET_CHECKLIST'},{kind:'public',purpose:'product',source:'https://example.com',text:'SECRET_PRODUCT_PLAN'},{kind:'public',source:'https://example.com',text:'Revenue grew last year.'}]};
  const projected=buyerAccountContext(account);assert.doesNotMatch(JSON.stringify(projected),/SECRET_/);assert.deepEqual(projected.public_context,['Revenue grew last year.']);
  for(const trainingMode of ['assisted','blind','demo','observe'])assert.doesNotMatch(JSON.stringify(sessionConfig('simulation','SECRET_COACH',undefined,{trainingMode,accountContext:account})),/SECRET_/);
  assert.equal(sessionConfig('speakerphone','',undefined,{accountContext:account}).instructions,undefined);
});
test('lifecycle receives only observed dialogue, never buyer secrets, coaching, product mapping or sales success criteria',()=>{
  const request=lifecycleRequest({mode:'simulation',turns,accountContext:'SECRET_ACCOUNT',buyerState:'SECRET_STATE',objective:'SECRET_GOAL',recommendation:'SECRET_LINE'});
  assert.deepEqual(Object.keys(JSON.parse(request.input)),['transcript']);assert.doesNotMatch(JSON.stringify(request),/SECRET_/);
  assert.throws(()=>lifecycleRequest({mode:'speakerphone',turns}));
  assert.equal(JSON.parse(coachingRequest({mode:'speakerphone',callLifecycle:ended}).input).call_lifecycle,undefined);
});
test('invented buyer evidence cannot hang up; a fresh seller question cannot be silently ended',()=>{
  assert.equal(validateLifecycle({...ended,evidence:[{turn:2,quote:'I signed the deal'}]},turns).phase,'active');
  assert.equal(validateLifecycle(ended,[...turns,{speaker:'seller',text:'Before you go, which address should I use?'}]).phase,'closing');
  assert.equal(validateLifecycle(ended,turns).phase,'ended');
});
test('semantic repetition requires evidence from two actual seller turns and buyer agreement',()=>{
  const dialogue=[turns[0],turns[1],{speaker:'buyer',text:'Yes, that works.'},{speaker:'seller',text:'The overview will be in your inbox later today.'}];
  const value={phase:'closing',seller_repeated_commitment:true,evidence:[{turn:0,quote:'Send the overview'},{turn:1,quote:'send it this afternoon'},{turn:3,quote:'in your inbox later today'}]};
  assert.equal(validateLifecycle(value,dialogue).seller_repeated_commitment,true);
  assert.equal(validateLifecycle({...value,evidence:value.evidence.slice(0,2)},dialogue).seller_repeated_commitment,false);
});
test('lifecycle API sends production request and validates semantic model result',async()=>{
  let sent;const payload={mode:'simulation',turns};
  const value=await assessLifecycle({key:'test-only',payload,fetcher:async(url,options)=>{sent=JSON.parse(options.body);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(ended)}]}]});}});
  assert.deepEqual(sent,lifecycleRequest(payload));assert.equal(value.phase,'ended');
});
function setup(t,bridge={},Class=VoiceSession){
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
  const sent=[],end=[];
  const session=new Class({mode:'simulation',bridge,onEvent(){},onStatus(){},onLevel(){},onError:assert.fail,onEnded:r=>end.push(r)});
  session.buyerInstructions='Only buyer context';session.channel={readyState:'open',send:v=>sent.push(JSON.parse(v)),close(){}};session.playbackBlocked=false;
  t.after(()=>session.stop());return{session,sent,end};
}
test('semantic ending waits for buyer audio to finish then ends once without another buyer response',async t=>{
  const {session,sent,end}=setup(t,{lifecycle:async()=>ended});
  session.dialogue.set('s',{speaker:'seller',text:turns[1].text});session.playing=true;session.playbackBlocked=true;
  session.recordDialogue('b','buyer',turns[2].text);await flush();assert.equal(end.length,0);
  session.playing=false;session.releaseMicrophone();t.mock.timers.tick(220);assert.equal(end.length,1);
  session.requestBuyer({},true);session.finishLifecycle();assert.equal(end.length,1);assert.equal(sent.filter(e=>e.type==='response.create').length,0);
});
test('stale lifecycle response cannot hang up after new caller information',async t=>{
  let resolve;let count=0;
  const {session,end}=setup(t,{lifecycle:()=>++count===1?new Promise(r=>resolve=r):Promise.resolve({...ended,phase:'active'})});
  session.dialogue.set('s',{speaker:'seller',text:'I will send it.'});session.recordDialogue('b','buyer','Goodbye.');await flush();
  session.recordDialogue('s2','seller','Actually, I cannot send it to that address.');resolve(ended);await flush();assert.equal(end.length,0);assert.equal(session.lifecycle.phase,'active');
});
test('a failed lifecycle check leaves normal conversation usable instead of inventing an ending',async t=>{
  const {session,end}=setup(t,{lifecycle:async()=>{throw new Error('timeout');}});session.recordDialogue('s','seller','Hello there.');await flush();assert.equal(session.lifecyclePending,null);assert.equal(end.length,0);assert.equal(session.lifecycle.phase,'active');
});
test('closing repetition waits for semantic classification and gives buyer closing control, not another open-ended turn',async t=>{
  let resolve;const {session,sent}=setup(t,{lifecycle:()=>new Promise(r=>resolve=r)});
  session.lifecycle={phase:'closing'};session.recordDialogue('s','seller','I will email that overview later.');await flush();
  session.inputTurns.set('s',{text:'I will email that overview later.',final:true,usable:true});session.requestBuyer();assert.equal(sent.length,0);
  resolve({...ended,phase:'closing',seller_repeated_commitment:true});await flush();
  const req=sent.find(e=>e.type==='response.create');assert.match(req.response.instructions,/winding down/);assert.match(req.response.instructions,/repeated in different words/);
});
test('Observe does not start a new seller turn after a classified buyer ending',t=>{
  const {session,end}=setup(t,{},ObserveSession);session.lifecycle=ended;session.lifecycleVersion=session.dialogueRevision;session.buyerTranscriptReady=true;session.buyerReady();assert.equal(end.length,1);assert.equal(session.observeTimer,undefined);
});
test('ordinary buyer replies do not wait for the parallel lifecycle request',async t=>{
  let resolve;const {session,sent}=setup(t,{lifecycle:()=>new Promise(r=>resolve=r)});
  session.recordDialogue('s','seller','Could you tell me more?');await flush();session.inputTurns.set('s',{text:'Could you tell me more?',final:true,usable:true});session.requestBuyer();
  assert.equal(sent.filter(e=>e.type==='response.create').length,1);
  resolve({...ended,phase:'active'});await flush();
});
test('ending detected while paused waits for resume, then cannot trigger another silence check',async t=>{
  const {session,end,sent}=setup(t,{lifecycle:async()=>ended});session.paused=true;session.dialogue.set('s',{speaker:'seller',text:'I will send it.'});session.recordDialogue('b','buyer','Thanks, goodbye.');await flush();assert.equal(end.length,0);
  session.setPaused(false);assert.equal(end.length,1);t.mock.timers.tick(10000);assert.equal(sent.filter(e=>e.type==='response.create').length,0);
});
test('a lifecycle result arriving after Stop cannot affect the next session',async t=>{
  let resolve;const {session,end}=setup(t,{lifecycle:()=>new Promise(r=>resolve=r)});session.recordDialogue('s','seller','Goodbye then.');await flush();session.stop();resolve(ended);await flush();assert.equal(end.length,0);
});

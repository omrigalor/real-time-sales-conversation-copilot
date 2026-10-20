import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {coachingRequest,sessionConfig,connectOpenAI} from '../api.js';
import {observeRequest} from '../training-api.js';
import {SELLER_OPENING_PREFERENCE,coachingTask} from '../seller-opening.js';
import {createBuyerVoiceResolver} from '../buyer-voice-api.js';
import {researchedTarget} from '../app/researched-target.js';
import {researchedPandora} from '../app/researched-pandora.js';
import {accountForCall, normalizeAccount} from '../app/account-context.js';
import {loadCases,evaluateOne} from '../evaluation/runner.js';
const response=voice=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({voice})}]}]})});

test('explicit opening preference reaches each seller adapter; task is instructions, not input data',()=>{
  for(const salesRole of ['BDR','AE'])for(const mode of ['speakerphone','simulation'])for(const trainingMode of ['assisted','blind','demo','observe']){
    const payload={salesRole,mode,trainingMode,opening:true,turns:[],accountContext:researchedTarget()};
    const request=trainingMode==='observe'&&mode==='simulation'?observeRequest(payload):coachingRequest(payload);
    assert.ok(request.instructions.includes(SELLER_OPENING_PREFERENCE));
    if(trainingMode!=='observe'||mode==='speakerphone')assert.ok(request.instructions.includes(coachingTask(true)));
    assert.equal(JSON.parse(request.input).task,undefined);
    assert.doesNotMatch(sessionConfig('simulation','','target-service').instructions,/REPRESENTATIVE OPENING PREFERENCE/);
  }
});
test('authored buyer profiles choose different voices immediately; live never selects a synthetic voice',async()=>{
  const resolve=createBuyerVoiceResolver(),fetcher=()=>assert.fail('Known voice must not make a model request');
  assert.equal(await resolve({payload:{mode:'simulation',accountContext:researchedTarget()},fetcher}),'ash');
  assert.equal(await resolve({payload:{mode:'simulation',scenarioId:'target-service'},fetcher}),'marin');
  assert.equal(await resolve({payload:{mode:'speakerphone',accountContext:researchedTarget()},fetcher}),undefined);
  assert.equal(sessionConfig('speakerphone','','target-service',{buyerVoice:'ash'}).audio.output,undefined);
  assert.equal(accountForCall(researchedTarget(),'speakerphone').buyerVoice,undefined);
});
test('new names are automatically cast, cached and kept independent of account and coaching data',async()=>{
  const resolve=createBuyerVoiceResolver();let requests=[];
  const fetcher=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);return response(JSON.parse(body.input).name==='Daniel Reed'?'ash':'marin');};
  const make=person=>({mode:'simulation',accountContext:{person,company:'PRIVATE_ACCOUNT',notes:'PRIVATE_NOTES',buyerVoice:'marin'},recommendation:'PRIVATE_COACH'});
  const run=person=>resolve({key:'test-only',payload:make(person),fetcher});
  assert.deepEqual(await Promise.all([run('Daniel Reed'),run('Daniel Reed')]),['ash','ash']);
  assert.equal(requests.length,1,'Concurrent preparation and connect share the same request');
  assert.equal(await run('Maya Chen'),'marin');assert.equal(requests.length,2,'Changing buyer name chooses afresh');
  assert.doesNotMatch(JSON.stringify(requests),/PRIVATE_|test-only/);
  assert.deepEqual(JSON.parse(requests[0].input),{name:'Daniel Reed'});
  assert.equal(await run('Daniel Reed'),'ash');assert.equal(requests.length,2);
});
test('ambiguous, unavailable and invalid voice choices use a neutral fallback',async()=>{
  const payload={mode:'simulation',accountContext:{person:'Avery'}};
  for(const fetcher of [async()=>response('alloy'),async()=>response('unsupported'),async()=>{throw new Error('unavailable');}]){
    assert.equal(await createBuyerVoiceResolver()({key:'test',payload,fetcher}),'alloy');
  }
  assert.equal(await createBuyerVoiceResolver()({payload:{mode:'simulation',accountContext:{person:''}}}),'alloy');
});
test('selected voice is carried into the actual WebRTC session request for all simulated environments',async()=>{
  for(const trainingMode of ['assisted','blind','demo','observe']){
    let config;
    const fetcher=async(url,options)=>{config=JSON.parse(options.body.get('session'));return {ok:true,text:async()=>'v=0'};};
    await connectOpenAI({key:'test-only',mode:'simulation',trainingMode,accountContext:researchedTarget(),buyerVoice:'ash',sdp:'v=0',fetcher});
    assert.equal(config.audio.output.voice,'ash');assert.equal(config.model,'gpt-realtime-2.1');
  }
});
test('David retains authored masculine casting even with stale feminine data, stripped metadata or no classifier key',async()=>{
  const resolve=createBuyerVoiceResolver();
  for(const account of [researchedPandora(),{...researchedPandora(),buyerVoice:'marin'},accountForCall(researchedPandora(),'simulation')]){
    assert.equal(await resolve({payload:{mode:'simulation',accountContext:account},fetcher:()=>assert.fail('Authored casting must not fall back to name classification')}),'ash');
  }
  const changed={...researchedPandora(),person:'Maya Chen'};
  assert.equal(await resolve({key:'test',payload:{mode:'simulation',accountContext:changed},fetcher:async()=>response('marin')}),'marin','Changing identity invalidates the old casting');
  assert.equal(normalizeAccount({...researchedPandora(),buyerVoice:'cedar'}).buyerVoice,'ash','Saved legacy masculine profiles migrate');
});
test('masculine and feminine casting survives the full resolver-to-audio path in every training mode',async()=>{
  const resolve=createBuyerVoiceResolver();
  for(const trainingMode of ['assisted','blind','demo','observe'])for(const [account,expected] of [[researchedPandora(),'ash'],[{company:'Example',person:'Maya Chen'},'marin']]){
    const payload={mode:'simulation',trainingMode,accountContext:account};
    const buyerVoice=await resolve({key:'test',payload,fetcher:async()=>response('marin')});
    let config;
    await connectOpenAI({key:'test',...payload,buyerVoice,sdp:'v=0',fetcher:async(url,options)=>{config=JSON.parse(options.body.get('session'));return {ok:true,text:async()=>'v=0'};}});
    assert.equal(config.audio.output.voice,expected);
    assert.match(config.instructions,expected==='ash'?/consistently masculine adult voice/:/consistently feminine adult voice/);
    assert.match(config.instructions,/do not imitate the caller/);
  }
});
test('opening replay preserves actual prior requests and separates fixtures from production prompts',async()=>{
  const suite=await loadCases({openingReview:true});assert.equal(suite.cases.length,10);
  const raw=await readFile(new URL('../evaluation/before-opening-requests.json',import.meta.url),'utf8');
  const sha=(await readFile(new URL('../evaluation/before-opening-requests.sha256',import.meta.url),'utf8')).trim();
  assert.equal(createHash('sha256').update(raw).digest('hex'),sha);
  const saved=JSON.parse(raw);assert.equal(saved.version,'1.0.19');
  assert.ok(saved.requests['precomputed-cold'].input.includes('Prefer a plain self-introduction'));
  let sent;
  const result=await evaluateOne(suite.cases[0],'before-opening',{key:'test',fetcher:async(url,options)=>{
    sent ||= JSON.parse(options.body);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"roles":[],"for":"seller","action":"suggest"}\nMock response for transport testing only.\n{}'}]}]})};
  }});
  assert.equal(result.status,'completed');assert.deepEqual(sent,{...saved.requests['precomputed-cold'],stream:false});
  for(const c of suite.cases){
    const request=c.kind==='observe'?observeRequest(c.payload):coachingRequest(c.payload);
    assert.ok(!JSON.stringify(request).includes(c.manual_review));
  }
});

test('Observe speaks the same fixed opening instead of model-added business rationale',async()=>{
  const {observeTurn}=await import('../training-api.js');
  let spoken;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/responses'))return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({action:'SAY',delivery:'cold_opening',say:'With your growing channels, here is a long speculative pitch.',end_call:false})}]}]})};
    spoken=JSON.parse(options.body).input;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(2)};
  };
  const result=await observeTurn({key:'test-only',payload:{mode:'simulation',salesRole:'BDR',scenarioId:'target-service',turns:[]},repName:'Alex',fetcher});
  assert.equal(result.say,'Hi, it’s Alex from Salesforce. Do you have a few minutes to chat?');
  assert.equal(spoken,result.say);
});

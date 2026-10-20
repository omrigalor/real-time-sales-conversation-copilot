import test from 'node:test';
import assert from 'node:assert/strict';
import { coachingRequest, sessionConfig, streamCoach } from '../api.js';
import { sellerIntelligence } from '../sales-intelligence.js';
import { observeRequest, reviewRequest, observeTurn, reviewCall } from '../training-api.js';
import { readObjective } from '../objective.js';
import { VoiceSession } from '../app/session.js';
import { ObserveSession } from '../app/observe.js';
import { buyerConditions, normalizeDifficulty } from '../buyer-training.js';

const turns = [
  { id:'r', speaker:'seller', speakerSource:'native', text:'I had a thought about order lookups. Is that worth a quick conversation?' },
  { id:'b', speaker:'buyer', speakerSource:'native', text:'Sometimes we look elsewhere. It is not a major issue.' },
];
const payload = { mode:'simulation', scenarioId:'target-service', salesRole:'BDR', turns };
const response = value => new Response(JSON.stringify({status:'completed', output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]}));

test('all five environments consume the exact shared core, with distinct BDR and AE layers', () => {
  for (const salesRole of ['BDR','AE']) {
    const core = sellerIntelligence(salesRole);
    for (const trainingMode of ['live','assisted','blind','demo','observe']) {
      const p = {...payload, salesRole, trainingMode, mode:trainingMode==='live'?'speakerphone':'simulation'};
      const request = trainingMode==='observe'?observeRequest(p):coachingRequest(p);
      assert.ok(request.instructions.includes(core), `${salesRole}/${trainingMode} drifted`);
      assert.match(request.instructions, new RegExp(`SELECTED ROLE: ${salesRole}`));
    }
    if(salesRole==='BDR') assert.match(core,/Create and qualify legitimate pipeline/);
    else { assert.match(core,/broader opportunity/); assert.doesNotMatch(core,/PROVISIONAL BDR TRANSCRIPT REFERENCE/); }
  }
  assert.notEqual(sellerIntelligence('BDR'),sellerIntelligence('AE'));
});
test('Speakerphone projects away every simulation-only field and is always input-only', () => {
  const poisoned = {...payload, mode:'speakerphone', scenarioId:'target-service', difficulty:'hard', trainingMode:'observe', buyerState:{trust:'SECRET_BUYER_STATE'}, desiredOutcome:'SECRET_OUTCOME'};
  const request = coachingRequest(poisoned);
  assert.doesNotMatch(JSON.stringify(request),/SECRET_|Maya Chen|Target|PRIVATE BUYER|PRIVATE PRACTICE CONDITIONS/);
  assert.equal(JSON.parse(request.input).practice_brief,undefined);
  assert.equal(JSON.parse(request.input).difficulty,undefined);
  const config = sessionConfig('speakerphone','',payload.scenarioId,poisoned);
  assert.equal(config.type,'transcription'); assert.equal(config.tools,undefined); assert.equal(config.instructions,undefined); assert.equal(config.audio.output,undefined);
});
test('Observe and practice review see public context and actual dialogue, never answer keys or buyer-private state', () => {
  for(const build of [observeRequest, reviewRequest]) {
    const request=build({...payload, recommendation:'SECRET_ANSWER', conversationMemory:{secret:'SECRET_MEMORY'}, buyerState:'SECRET_BUYER', difficulty:'hard'});
    assert.doesNotMatch(JSON.stringify(request),/SECRET_|PRIVATE PRACTICE CONDITIONS/);
    assert.deepEqual(JSON.parse(request.input).transcript.map(t=>t.text),turns.map(t=>t.text));
  }
});
test('difficulty only modifies the buyer; endpoints and model quality are unchanged', () => {
  for(const difficulty of [1,2,3,4,5,'easy','realistic','hard']) {
    const config=sessionConfig('simulation','SECRET_SELLER_GOAL','target-service',{difficulty});
    assert.equal(config.model,'gpt-realtime-2.1');
    assert.equal(config.audio.input.turn_detection.eagerness,'medium');
    assert.equal(config.audio.input.turn_detection.create_response,false);
    assert.doesNotMatch(config.instructions,/SECRET_SELLER_GOAL|SELECTED ROLE|COACH OBJECTIVE/);
    assert.match(config.instructions,/never a random acceptance probability/);
  }
  assert.equal(sessionConfig('simulation','','target-service',{trainingMode:'observe'}).audio.input.turn_detection,null);
});
test('five difficulty profiles are distinct, backward compatible and limited to human practice', () => {
  const profiles = [1,2,3,4,5].map(level => buyerConditions(level));
  assert.equal(new Set(profiles).size, 5);
  profiles.forEach((profile,index) => {
    assert.match(profile,new RegExp(`LEVEL ${index+1} OF 5`));
    assert.match(profile,/not fixed response lengths, objection counts/);
    assert.match(profile,/never a random acceptance probability/);
    assert.equal(buyerConditions(String(index+1)),profile);
  });
  assert.match(profiles[0],/generous attention and low initial skepticism/);
  assert.match(profiles[4],/Start skeptical.*protective of your time/);
  assert.match(profiles[4],/do not invent replacement objections/);
  for(const [old,level] of [['easy',1],['realistic',3],['hard',5]]) assert.equal(buyerConditions(old),profiles[level-1]);
  for(const invalid of [0,6,2.5,NaN,null,{},'unknown']) assert.equal(normalizeDifficulty(invalid),3);
  for(const trainingMode of ['demo','observe']) {
    assert.deepEqual(sessionConfig('simulation','','target-service',{trainingMode,difficulty:1}),sessionConfig('simulation','','target-service',{trainingMode,difficulty:5}));
  }
  assert.deepEqual(sessionConfig('speakerphone','','target-service',{difficulty:1}),sessionConfig('speakerphone','','target-service',{difficulty:5}));
});
test('objective evidence rejects invented, seller-only and unassigned facts', () => {
  const value={current:'Check whether this matters',known:[{text:'Mild issue',turn:1,quote:'not a major issue'},{text:'High urgency',turn:1,quote:'urgent'},{text:'Confirmed value',turn:0,quote:'order lookups'}],unknown:['Frequency']};
  assert.deepEqual(readObjective(value,turns).known.map(x=>x.text),['Mild issue']);
  assert.equal(readObjective(value,turns.map(t=>({...t,speaker:'unassigned',speakerSource:'unknown'}))).known.length,0);
  assert.equal(readObjective(value,turns.map(t=>({...t,speaker:'unassigned',speakerSource:'unknown'})),[{id:'b',speaker:'buyer'}]).known.length,1);
});
test('real live transcript adapter enforces rep-only SAY / WAIT / LISTEN and independent factual insights', async () => {
  for(const [latest,action,expected] of [['buyer','suggest','SAY'],['buyer','listen','listen'],['seller','suggest','wait'],['unassigned','suggest','uncertain']]) {
    let held='',said='',objective;
    const live=[{id:'live',speaker:latest,speakerSource:latest==='unassigned'?'unknown':'manual',text:'It is not a major issue.'}];
    const raw=JSON.stringify({roles:[],for:'seller',action,listen_for:'Whether this matters'})+'\nHow often does that happen?\n'+JSON.stringify({objective:{current:'Understand relevance',known:[{turn:0,text:'Limited impact',quote:'not a major issue'}],unknown:['Frequency']}});
    const fetcher=async()=>new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:raw})}\n\ndata: ${JSON.stringify({type:'response.completed'})}\n\n`);
    await streamCoach({key:'test',payload:{mode:'speakerphone',salesRole:'BDR',turns:live},fetcher,onDelta:t=>said=t,onHold:r=>held=r,onObjective:v=>objective=v});
    assert.equal(said?'SAY':held,expected); assert.equal(objective.known.length,latest==='buyer'?1:0);
  }
});
test('Observe speech synthesis reads only the selected spoken line; no private instructions become audio', async () => {
  const requests=[];
  const result=await observeTurn({key:'test',payload,fetcher:async(url,options)=>{
    requests.push(JSON.parse(options.body));
    return requests.length===1?response({action:'SAY',say:'That may not be worth changing.',end_call:false}):new Response(new Uint8Array([1,2]));
  }});
  assert.equal(requests[1].input,'That may not be worth changing.');
  assert.equal(requests[1].speed,undefined); assert.equal(result.audio.length,2);
  await assert.rejects(observeTurn({key:'test',payload:{...payload,mode:'speakerphone'}}),/only available/);
});
test('review preserves multiple valid approaches and rejects unsupported quoted moments', async () => {
  const result=await reviewCall({key:'test',payload,fetcher:async()=>response({summary:'No meeting established.',takeaway:'Check relevance.',moments:[{title:'Restraint',turn:1,quote:'not a major issue',observation:'Avoid inflating it.',alternative:'A different relevant observation could work.'},{title:'Invented',turn:1,quote:'We need this urgently'}]})});
  assert.equal(result.moments.length,1); assert.equal(result.moments[0].title,'Restraint');
  assert.match(reviewRequest(payload).instructions,/no single|Several very different/i);
});

function voice(t) {
  const events=[],sent=[];let ended='';
  const s=new VoiceSession({mode:'simulation',scenarioId:'target-service',bridge:{},onEvent:e=>events.push(e),onStatus:()=>{},onLevel:()=>{},onError:e=>{throw e;},onEnded:value=>ended=value});
  s.buyerInstructions=sessionConfig('simulation','','target-service').instructions;
  s.channel={readyState:'open',send:text=>sent.push(JSON.parse(text)),close(){}};s.playbackBlocked=false;
  t.after(()=>s.stop()); return {s,events,sent,get ended(){return ended;}};
}
test('silence checks are deliberate, bounded, cancelled by speech and disabled while paused or muted', t => {
  const {s,sent}=voice(t);
  s.armIdle();assert.ok(s.idleTimer);
  s.handleInput({type:'input_audio_buffer.speech_started',item_id:'speech'});
  s.checkIdle();assert.equal(sent.length,0);
  s.handleInput({type:'input_audio_buffer.speech_stopped',item_id:'speech'});
  s.handleInput({type:'input_audio_buffer.committed',item_id:'speech'});
  s.handleInput({type:'conversation.item.input_audio_transcription.completed',item_id:'speech',transcript:''});
  assert.equal(s.inputTurns.size,0);assert.equal(sent.filter(e=>e.type==='response.create').length,0);
  s.paused=true;s.checkIdle();assert.equal(s.idleChecks,0);s.paused=false;
  s.checkIdle();assert.equal(s.idleChecks,1);assert.equal(s.repTurns,0);
  assert.match(sent.at(-1).response.instructions,/No new caller words/);
  assert.match(sent.at(-1).response.instructions,/small, brief check/);
  assert.match(sent.at(-1).response.instructions,/give instructions to say a particular word/);
  s.responsePending=false;s.playbackBlocked=false;s.muted=true;s.checkIdle();assert.equal(s.idleChecks,1);
  s.muted=false;s.idleChecks=2;s.checkIdle();assert.equal(s.endAfterIdle,true);
});
test('buyer state is private and a tool-only reply gets exactly one voice continuation, not a new seller turn', async t => {
  const fixture=voice(t),{s,sent,events}=fixture;
  s.responsePending=true;s.handlePlayback({type:'response.created',response:{id:'a'}});
  s.handlePlayback({type:'response.done',response:{id:'a',status:'completed',output:[{type:'function_call',name:'update_buyer_state',call_id:'private',arguments:JSON.stringify({engagement:'curious',ended:false})}]}});
  await new Promise(r=>setTimeout(r,250));
  assert.equal(s.buyerState.engagement,'curious');assert.equal(events.some(e=>JSON.stringify(e).includes('curious')),false);
  assert.equal(sent.filter(e=>e.type==='response.create').length,1);
  assert.equal(sent.at(-1).response.tool_choice,'none');assert.equal(s.repTurns,0);
});
test('Observe cannot advance on playback alone; it waits for actual completed buyer text', t => {
  const s=new ObserveSession({mode:'simulation',bridge:{observe:()=>assert.fail('Too early')},onEvent:()=>{},onStatus:()=>{},onLevel:()=>{},onError:()=>{},getContext:()=>payload});
  t.after(()=>s.stop());s.buyerReady();assert.equal(s.observeTimer,undefined);
  s.buyerTranscriptReady=true;s.paused=true;s.buyerReady();assert.equal(s.observeTimer,undefined);
});


test('cross-mode suite is additive, fixed and preserves the actual pre-upgrade implementation', async () => {
  const {loadCases,evaluateOne}=await import('../evaluation/runner.js');
  const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
  const old=await loadCases({extended:true}), current=await loadCases({extended:true,crossMode:true});
  assert.equal(old.cases.length,21);assert.equal(current.cases.length,33);
  assert.deepEqual(current.cases.slice(0,21),old.cases);
  assert.equal(current.cases.slice(21).filter(c=>c.payload.mode==='speakerphone').length,6);
  const directory=new URL('../evaluation/before-training/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'));
  for(const [file,digest] of Object.entries(manifest.sha256)) assert.equal(createHash('sha256').update(await readFile(new URL(file,directory))).digest('hex'),digest,file);
  const observe=current.cases.find(c=>c.kind==='observe');
  const before=await evaluateOne(observe,'before-training',{key:'unused',fetcher:()=>assert.fail('No historical Observe agent to run')});
  assert.equal(before.status,'unavailable');
  let request;
  const after=await evaluateOne(observe,'current',{key:'unused',fetcher:async(url,options)=>{request=JSON.parse(options.body);return response({action:'SAY',say:'A mocked seller response.',listen_for:'',end_call:false});}});
  assert.equal(after.spoken_line,'A mocked seller response.');
  assert.ok(!JSON.stringify(request).includes(observe.manual_review));
});


test('guided success belongs only to demos; human practice keeps earned outcomes and live gets neither buyer policy',()=>{
  const demo=sessionConfig('simulation','','target-service',{trainingMode:'observe',difficulty:'hard'});
  assert.match(demo.instructions,/FAVORABLE BUYER CONDITIONS/);
  assert.doesNotMatch(demo.instructions,/THIS IS HUMAN PRACTICE|More guarded disclosure/);
  assert.match(observeRequest(payload).instructions,/GUIDED SUCCESS DEMONSTRATION/);
  for(const trainingMode of ['assisted','blind']) {
    const practice=sessionConfig('simulation','','target-service',{trainingMode,difficulty:'realistic'});
    assert.match(practice.instructions,/THIS IS HUMAN PRACTICE/);
    assert.match(practice.instructions,/No target failure rate/);
    assert.doesNotMatch(practice.instructions,/GUIDED SUCCESS DEMONSTRATION/);
    assert.doesNotMatch(coachingRequest({...payload,trainingMode}).instructions,/GUIDED SUCCESS DEMONSTRATION/);
  }
  assert.equal(sessionConfig('speakerphone','','target-service',{trainingMode:'observe'}).instructions,undefined);
  assert.doesNotMatch(coachingRequest({...payload,mode:'speakerphone'}).instructions,/GUIDED SUCCESS DEMONSTRATION|PRIVATE PRACTICE CONDITIONS/);
});


test('human demo has the cooperative demonstration buyer but retains microphone turn detection',()=>{
  const demo=sessionConfig('simulation','','target-service',{trainingMode:'demo'});
  assert.match(demo.instructions,/FAVORABLE BUYER CONDITIONS/);
  assert.match(demo.instructions,/Your circumstances are favorable/);
  assert.equal(demo.audio.input.turn_detection.type,'semantic_vad');
  assert.equal(demo.audio.input.turn_detection.create_response,false);
  assert.doesNotMatch(demo.instructions,/THIS IS HUMAN PRACTICE/);
});

test('unexpected expansion and scheduled discovery provide distinct opening context to the shared reasoning',()=>{
  for(const id of ['target-service','northstar-loyalty','harbor-sales','meridian-service','cedar-onboarding']) {
    const request=coachingRequest({...payload,scenarioId:id,opening:true});
    assert.match(JSON.parse(request.input).practice_brief.callType,/unexpected outbound/);
    assert.match(request.instructions,/A greeting alone does not establish engagement/);
    assert.match(sessionConfig('simulation','',id).instructions,/this person has not agreed/);
  }
  const scheduled=coachingRequest({...payload,salesRole:'AE',scenarioId:'ae-discovery',opening:true});
  assert.equal(JSON.parse(scheduled.input).practice_brief.callType,'scheduled discovery');
  assert.match(scheduled.instructions,/does not apply to an already scheduled or invited conversation/);
});

test('buyer distinguishes private account context from caller identity across practice and demo adapters',()=>{
  for(const trainingMode of ['assisted','blind','demo','observe']) {
    const config=sessionConfig('simulation','','target-service',{trainingMode});
    assert.match(config.instructions,/KNOWLEDGE AND SOCIAL BOUNDARIES/);
    assert.match(config.instructions,/do not identify an unexpected caller/);
    assert.match(config.instructions,/actual invitation, established relationship or spoken words/);
    assert.doesNotMatch(config.instructions,/The caller is your Salesforce rep/);
  }
  const custom=sessionConfig('simulation','','target-service',{accountContext:{company:'Fictional Example',person:'Taylor',relationship:'Existing customer'},trainingMode:'blind'});
  assert.match(custom.instructions,/KNOWLEDGE AND SOCIAL BOUNDARIES/);
  assert.doesNotMatch(coachingRequest({...payload,mode:'speakerphone'}).instructions,/KNOWLEDGE AND SOCIAL BOUNDARIES/);
});

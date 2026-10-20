import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceSession} from '../app/session.js';
import {ObserveSession} from '../app/observe.js';
import {sessionConfig,connectOpenAI} from '../api.js';
const stateCall={type:'function_call',name:'update_buyer_state',call_id:'state',arguments:'{"ended":false}'};
function setup(t,Class=VoiceSession,trainingMode='assisted') {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
  const sent=[],ended=[];
  const session=new Class({mode:'simulation',trainingMode,difficulty:5,scenarioId:'target-service',bridge:{},onEvent(){},onStatus(){},onLevel(){},onError:assert.fail,onEnded:x=>ended.push(x)});
  session.buyerInstructions=sessionConfig('simulation','','target-service',{difficulty:5,trainingMode}).instructions;
  session.channel={readyState:'open',send:raw=>sent.push(JSON.parse(raw)),close(){}};
  session.playbackBlocked=false;t.after(()=>session.stop());
  const requests=()=>sent.filter(e=>e.type==='response.create');
  const finish=id=>{
    session.handlePlayback({type:'response.created',response:{id}});
    session.handlePlayback({type:'output_audio_buffer.started',response_id:id});
    session.handlePlayback({type:'response.done',response:{id,status:'completed',output:[{type:'message',content:[{type:'audio'}]}]}});
    session.handlePlayback({type:'output_audio_buffer.stopped',response_id:id});
    t.mock.timers.tick(220);
  };
  return {session,sent,ended,requests,finish};
}
test('connection passes exact buyer-only instructions to the adapter; no seller context or key',async()=>{
  let sent;
  const training={difficulty:5,trainingMode:'blind'};
  const result=await connectOpenAI({key:'SECRET_KEY',mode:'simulation',context:'SECRET_COACH',scenarioId:'target-service',...training,sdp:'v=0',connectionDetails:true,fetcher:async(url,options)=>{sent=JSON.parse(options.body.get('session'));return {ok:true,text:async()=>'v=0-answer'};}});
  assert.equal(result.sdp,'v=0-answer');assert.equal(result.buyerInstructions,sent.instructions);
  assert.match(result.buyerInstructions,/LEVEL 5 OF 5/);assert.doesNotMatch(JSON.stringify(result),/SECRET_KEY|SECRET_COACH|REPRESENTATIVE OPENING PREFERENCE/);
});
test('greeting, silence and tool-only continuation retain full persona and level 5 conditions',t=>{
  const {session,requests,finish}=setup(t);
  session.requestBuyer({instructions:'Answer the phone.'},true);finish('greeting');
  session.checkIdle();finish('idle');
  session.inputTurns.set('rep',{final:true,usable:true,text:'What matters to you?',stopped:true,committed:true});
  session.requestBuyer();session.handlePlayback({type:'response.created',response:{id:'bookkeeping'}});
  session.handlePlayback({type:'response.done',response:{id:'bookkeeping',status:'completed',output:[stateCall]}});
  assert.equal(requests().length,4);
  for(const request of requests().filter(e=>e.response.instructions)){
    assert.ok(request.response.instructions.startsWith(session.buyerInstructions));
    assert.match(request.response.instructions,/LEVEL 5 OF 5/);
    assert.match(request.response.instructions,/Remain the assigned buyer/);
  }
  assert.equal(requests().at(-1).response.tool_choice,'none');
});
test('buyer speech followed by state bookkeeping never authorizes another answer, even with abbreviated final output',t=>{
  const {session,requests}=setup(t);
  session.requestBuyer({instructions:'Answer as buyer'},true);
  session.handlePlayback({type:'response.created',response:{id:'buyer'}});
  session.handlePlayback({type:'output_audio_buffer.started',response_id:'buyer'});
  session.handlePlayback({type:'response.output_audio_transcript.done',response_id:'buyer',transcript:'What is new?'});
  session.handlePlayback({type:'output_audio_buffer.stopped',response_id:'buyer'});
  const done={type:'response.done',response:{id:'buyer',status:'completed',output:[stateCall]}};
  session.handlePlayback(done);session.handlePlayback(done);t.mock.timers.tick(220);
  assert.equal(requests().length,1);assert.equal(session.toolContinuation,false);assert.equal(session.playbackBlocked,false);
  session.requestBuyer();assert.equal(requests().length,1,'No caller input means no normal buyer reply');
});
test('duplicate silent tool completion cannot create multiple spoken continuations',t=>{
  const {session,requests}=setup(t);
  session.requestBuyer({instructions:'Answer as buyer'},true);
  session.handlePlayback({type:'response.created',response:{id:'tool'}});
  const done={type:'response.done',response:{id:'tool',status:'completed',output:[stateCall]}};
  session.handlePlayback(done);session.handlePlayback(done);
  assert.equal(requests().length,2);
});
test('unanswered call makes two brief checks after 5 and 3 seconds, then hangs up after another 3',t=>{
  const {session,requests,finish,ended}=setup(t);
  session.armIdle();t.mock.timers.tick(4999);assert.equal(requests().length,0);
  t.mock.timers.tick(1);assert.equal(requests().length,1);finish('first-check');
  t.mock.timers.tick(2999);assert.equal(requests().length,1);
  t.mock.timers.tick(1);assert.equal(requests().length,2);finish('second-check');
  t.mock.timers.tick(2999);assert.equal(ended.length,0);
  t.mock.timers.tick(1);assert.equal(ended.length,1);assert.equal(requests().length,2);
  assert.equal(session.repTurns,0,'Silence checks never count as user speech');
});
test('starting to speak cancels the pending hang-up while a paused or muted call never checks',t=>{
  const {session,requests,ended}=setup(t);
  session.idleChecks=2;session.armIdle();t.mock.timers.tick(2900);
  session.handleInput({type:'input_audio_buffer.speech_started',item_id:'rep'});
  t.mock.timers.tick(10000);assert.equal(ended.length,0);assert.equal(requests().length,0);
  session.inputTurns.clear();session.speakingItem=null;
  session.paused=true;session.armIdle();t.mock.timers.tick(10000);
  session.paused=false;session.muted=true;session.armIdle();t.mock.timers.tick(10000);
  assert.equal(ended.length,0);assert.equal(requests().length,0);
});
test('Observe silence continuation preserves its independent demonstration buyer and has no practice idle timer',t=>{
  const {session,requests}=setup(t,ObserveSession,'observe');
  session.armIdle();t.mock.timers.tick(20000);assert.equal(requests().length,0);
  session.pendingSilence=true;session.continueSilence();
  assert.equal(requests().length,1);assert.ok(requests()[0].response.instructions.startsWith(session.buyerInstructions));
  assert.match(requests()[0].response.instructions,/FAVORABLE BUYER CONDITIONS/);
  assert.doesNotMatch(requests()[0].response.instructions,/REPRESENTATIVE OPENING PREFERENCE|SELECTED ROLE/);
});
test('resuming an interrupted buyer preserves its persona and difficulty',t=>{
  const {session,requests}=setup(t);
  session.resumeBuyer=true;session.continueAfterPause();
  assert.equal(requests().length,1);assert.ok(requests()[0].response.instructions.startsWith(session.buyerInstructions));
  assert.match(requests()[0].response.instructions,/LEVEL 5 OF 5/);
});

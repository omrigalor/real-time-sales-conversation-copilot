import test from 'node:test';
import assert from 'node:assert/strict';
import {MacCallAudio} from '../app/mac-call-audio.js';
import {installMediaPermissions} from '../media-permissions.js';

function stream(video=false,audio=true) {
  const track=kind=>({kind,readyState:'live',enabled:true,stop(){this.readyState='ended';}});
  const tracks=[...(audio?[track('audio')]:[]),...(video?[track('video')]:[])];
  return {getTracks:()=>tracks,getAudioTracks:()=>tracks.filter(t=>t.kind==='audio'),getVideoTracks:()=>tracks.filter(t=>t.kind==='video')};
}
function setup(t) {
  const call=stream(true),mic=stream(),output=stream(),requests=[],nodes=[],levels=[],errors=[],contexts=[];
  const media={getDisplayMedia:async c=>{requests.push(['display',c]);return call;},getUserMedia:async c=>{requests.push(['mic',c]);return mic;}};
  function node(kind,extra={}) { const n={kind,connections:[],connect(to){this.connections.push(to);},disconnect(){this.disconnected=true;},...extra};nodes.push(n);return n; }
  class Context {
    constructor(){this.destination={kind:'speakers'};contexts.push(this);}
    createMediaStreamDestination(){return node('mix',{stream:output});}
    createMediaStreamSource(s){return node('source',{stream:s});}
    createGain(){return node('gain',{gain:{value:1}});}
    createAnalyser(){return node('meter',{getByteTimeDomainData(a){a.fill(this.level||128);}});}
    async resume(){} async close(){this.closed=true;}
  }
  const capture=new MacCallAudio({media,Context,onError:e=>errors.push(e),onLevel:l=>levels.push(l)});
  t.after(()=>capture.stop());
  return {capture,media,call,mic,output,requests,nodes,levels,errors,contexts};
}

test('direct capture returns audio only, discards video, mixes both inputs and never routes sound back to caller or speakers',async t=>{
  const s=setup(t),result=await s.capture.open();
  assert.equal(result,s.output);assert.deepEqual(result.getTracks().map(t=>t.kind),['audio']);
  assert.equal(s.call.getVideoTracks()[0].readyState,'ended');assert.equal(s.call.getAudioTracks()[0].readyState,'live');
  assert.deepEqual(s.requests.map(r=>r[0]),['display','mic']);
  const sources=s.nodes.filter(n=>n.kind==='source');assert.deepEqual(sources.map(n=>n.stream),[s.call,s.mic]);
  assert.equal(s.nodes.filter(n=>n.kind==='gain'&&n.connections.some(c=>c.kind==='mix')).length,2);
  assert.ok(s.nodes.every(n=>n.connections.every(c=>c.kind!=='speakers')));
  assert.equal(s.requests[1][1].audio.echoCancellation,true);
  s.capture.stop();for(const input of [s.call,s.mic,s.output])assert.ok(input.getTracks().every(t=>t.readyState==='ended'));
  assert.ok(s.contexts[0].closed);assert.ok(s.nodes.every(n=>n.kind==='mix'||n.disconnected));
});

test('muting and pausing direct capture disable both original sources and output, and separate levels reveal a missing call feed',async t=>{
  const s=setup(t);await s.capture.open();
  s.capture.meters[1].meter.level=150;s.capture.sample();
  assert.equal(s.levels.at(-1).call,0);assert.ok(s.levels.at(-1).mic>0);
  s.capture.meters[0].meter.level=155;s.capture.sample();assert.ok(s.levels.at(-1).call>0);
  s.capture.setEnabled(false);s.capture.sample();assert.deepEqual(s.levels.at(-1),{call:0,mic:0});
  for(const input of [s.call,s.mic,s.output])assert.equal(input.getAudioTracks()[0].enabled,false);
  s.capture.setEnabled(true);for(const input of [s.call,s.mic,s.output])assert.equal(input.getAudioTracks()[0].enabled,true);
});

test('cancelled or denied audio sharing never silently starts a microphone-only call',async t=>{
  const s=setup(t);s.media.getDisplayMedia=async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});};
  await assert.rejects(s.capture.open(),/Audio sharing was not allowed/);assert.equal(s.requests.length,0);assert.equal(s.contexts.length,0);
});

test('missing system audio rejects and releases video before asking for a microphone',async t=>{
  const s=setup(t),video=stream(true,false);s.media.getDisplayMedia=async()=>video;
  await assert.rejects(s.capture.open(),/No call audio/);assert.equal(s.requests.length,0);assert.equal(video.getTracks()[0].readyState,'ended');
});

test('microphone failure releases the already-granted call audio',async t=>{
  const s=setup(t);s.media.getUserMedia=async()=>{throw new Error('microphone unavailable');};
  await assert.rejects(s.capture.open(),/microphone unavailable/);assert.ok(s.call.getTracks().every(t=>t.readyState==='ended'));
});

test('ending while the picker is open discards late capture and never starts a microphone',async t=>{
  const s=setup(t);let resolve;s.media.getDisplayMedia=()=>new Promise(r=>{resolve=r;});
  const pending=s.capture.open();s.capture.stop();resolve(s.call);
  assert.equal(await pending,null);assert.equal(s.requests.length,0);assert.ok(s.call.getTracks().every(t=>t.readyState==='ended'));
});

test('ending during microphone permission releases late microphone and prior call audio',async t=>{
  const s=setup(t);let resolve;s.media.getUserMedia=()=>new Promise(r=>{resolve=r;});
  const pending=s.capture.open();await new Promise(r=>setImmediate(r));s.capture.stop();resolve(s.mic);
  assert.equal(await pending,null);for(const input of [s.call,s.mic])assert.ok(input.getTracks().every(t=>t.readyState==='ended'));
});

test('sharing lost while mic permission is pending does not return a dead mixed feed',async t=>{
  const s=setup(t);s.media.getUserMedia=async()=>{s.call.getAudioTracks()[0].stop();return s.mic;};
  await assert.rejects(s.capture.open(),/sharing stopped/);assert.ok(s.mic.getTracks().every(t=>t.readyState==='ended'));
});

test('loss of either source ends capture once and releases the other source',async t=>{
  const s=setup(t);await s.capture.open();s.call.getAudioTracks()[0].onended();
  assert.equal(s.errors.length,1);assert.match(s.errors[0].message,/disconnected/);
  assert.ok(s.mic.getTracks().every(t=>t.readyState==='ended'));assert.ok(s.contexts[0].closed);
  s.capture.stop();assert.equal(s.errors.length,1);
});

test('media permissions permit trusted mic/native picker, refuse camera and foreign pages, and never silently select a screen',()=>{
  const handlers={},wc={getURL:()=> 'copilot://app/index.html'};
  const session={setPermissionCheckHandler:f=>handlers.check=f,setPermissionRequestHandler:f=>handlers.request=f,setDisplayMediaRequestHandler:(f,opts)=>{handlers.picker=f;handlers.opts=opts;}};
  installMediaPermissions(session,()=>({webContents:wc}),'copilot://app');
  assert.equal(handlers.check(wc,'media','copilot://app',{mediaType:'audio'}),true);
  assert.equal(handlers.check(wc,'media','copilot://app',{mediaType:'video'}),false);
  assert.equal(handlers.check(wc,'display-capture','copilot://app',{}),true);
  assert.equal(handlers.check(wc,'display-capture','copilot://app.evil',{}),false);
  assert.equal(handlers.check({},'display-capture','copilot://app',{}),false);
  handlers.request(wc,'media',value=>assert.equal(value,false),{mediaTypes:['audio','video']});
  handlers.request(wc,'display-capture',value=>assert.equal(value,true),{});
  assert.equal(handlers.opts.useSystemPicker,true);handlers.picker({},value=>assert.deepEqual(value,{}));
});

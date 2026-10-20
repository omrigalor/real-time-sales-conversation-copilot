import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceSession } from '../app/session.js';

const device=(id,label,groupId=id)=>({kind:'audioinput',deviceId:id,label,groupId});
function stream(label='AirPods Pro',id='airpods') {
  const track={label,enabled:true,readyState:'live',getSettings:()=>({deviceId:id}),stop(){this.readyState='ended';}};
  return {track,getAudioTracks:()=>[track],getTracks:()=>[track]};
}
function setup(t,mode='simulation',trainingMode='assisted') {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const calls=[],statuses=[],errors=[],listeners=new Map();
  const media={getUserMedia:async constraints=>{calls.push(constraints);return stream();},enumerateDevices:async()=>[device('default','Default - AirPods Pro','airpods'),device('airpods','AirPods Pro')],addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:media}});
  const session=new VoiceSession({mode,trainingMode,bridge:{},onEvent:()=>{},onStatus:s=>statuses.push(s),onError:e=>errors.push(e),onLevel:()=>{}});
  session.startMeter=()=>{};
  t.after(()=>{session.stop();if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;});
  return {session,media,calls,statuses,errors,listeners};
}

test('Assisted, Blind and interactive demo request system-default speech input without forcing a Bluetooth sample rate',async t=>{
  const {session,calls}=setup(t);
  for(const mode of ['assisted','blind','demo']){session.trainingMode=mode;const result=await session.openMicrophone();assert.equal(result.track.label,'AirPods Pro');result.track.stop();}
  assert.equal(calls.length,3);
  for(const call of calls){assert.deepEqual(call.audio.deviceId,{ideal:'default'});assert.deepEqual(call.audio.channelCount,{ideal:1});assert.equal(call.audio.sampleRate,undefined);assert.equal(call.audio.echoCancellation,true);}
});

test('Speakerphone chooses and pins Mac room microphone even when AirPods are the system default',async t=>{
  const {session,media,calls}=setup(t,'speakerphone');const first=stream(),room=stream('MacBook Pro Microphone','builtin');
  media.enumerateDevices=async()=>[device('default','Default - AirPods Pro','airpods'),device('airpods','AirPods Pro'),device('builtin','MacBook Pro Microphone')];
  media.getUserMedia=async c=>{calls.push(c);return calls.length===1?first:room;};
  const result=await session.openMicrophone();
  assert.equal(result,room);assert.deepEqual(calls[1].audio.deviceId,{exact:'builtin'});assert.equal(first.track.readyState,'ended');assert.equal(room.track.enabled,false);
  session.stream=room;await session.watchDevices();assert.equal(session.deviceChangeHandler,undefined);
});

test('Speakerphone pins an external room mic when there is no built-in mic',async t=>{
  const {session,media,calls}=setup(t,'speakerphone');
  media.enumerateDevices=async()=>[device('default','Default - USB Conference Mic','usb'),device('usb','USB Conference Mic')];
  media.getUserMedia=async c=>{calls.push(c);return stream('USB Conference Mic','usb');};
  session.stream=await session.openMicrophone();assert.deepEqual(calls[1].audio.deviceId,{exact:'usb'});
});

test('Speakerphone refuses a headset-only input instead of silently missing the real buyer',async t=>{
  const {session,media}=setup(t,'speakerphone');const headset=stream();media.getUserMedia=async()=>headset;
  await assert.rejects(session.openMicrophone(),/room microphone/);assert.equal(headset.track.readyState,'ended');
});

test('Simulation hot swap preserves transcript/turn state and mute, pause or buyer echo protection',async t=>{
  const {session,media}=setup(t);let replacements=0;
  session.sender={replaceTrack:async track=>{assert.equal(track.enabled,false);replacements++;}};
  session.inputTurns.set('real-turn',{text:'An actual seller turn'});
  for(const condition of ['muted','paused','playbackBlocked','none']) {
    session.muted=condition==='muted';session.paused=condition==='paused';session.playbackBlocked=condition==='playbackBlocked';
    const old=stream('Old mic','old'),fresh=stream();session.stream=old;session.forceMicrophoneRefresh=true;
    media.getUserMedia=async()=>fresh;
    await session.refreshMicrophone();
    assert.equal(session.stream,fresh);assert.equal(old.track.readyState,'ended');
    assert.equal(fresh.track.enabled,condition==='none');assert.equal(session.inputTurns.get('real-turn').text,'An actual seller turn');
  }
  assert.equal(replacements,4);
});

test('Output-only device changes leave a healthy microphone alone',async t=>{
  const {session,calls}=setup(t);session.stream=stream();session.inputSignature=await session.defaultInputSignature();
  session.sender={replaceTrack:async()=>assert.fail('No switch')};await session.refreshMicrophone();assert.equal(calls.length,0);
});

test('Ending during microphone recovery releases late capture without restarting the session',async t=>{
  const {session,media}=setup(t);session.stream=stream();session.forceMicrophoneRefresh=true;
  let resolve;media.getUserMedia=()=>new Promise(r=>resolve=r);session.sender={replaceTrack:async()=>assert.fail('No replacement after stop')};
  const pending=session.refreshMicrophone();await new Promise(r=>setImmediate(r));session.stop();
  const late=stream();resolve(late);await pending;assert.equal(late.track.readyState,'ended');assert.equal(session.closed,true);
});

test('Recovery failures are bounded; a healthy old microphone is retained',async t=>{
  const {session,media,statuses,errors}=setup(t);session.stream=stream('Mac microphone','builtin');session.sender={replaceTrack:async()=>{}};
  media.getUserMedia=async()=>{throw new Error('Bluetooth profile temporarily unavailable');};
  for(let i=0;i<3;i++){session.forceMicrophoneRefresh=true;await session.refreshMicrophone();clearTimeout(session.deviceTimer);}
  assert.equal(session.closed,false);assert.equal(errors.length,0);assert.match(statuses.at(-1),/previous microphone/);
  session.stream.track.readyState='ended';
  for(let i=0;i<3;i++){session.forceMicrophoneRefresh=true;await session.refreshMicrophone();clearTimeout(session.deviceTimer);}
  assert.equal(session.closed,true);assert.match(errors[0].message,/No microphone/);
});

test('Device watcher handles a disconnected simulation mic and is removed on stop',async t=>{
  const {session,listeners}=setup(t);session.stream=stream();session.watchTrack(session.stream.track);await session.watchDevices();
  assert.ok(listeners.has('devicechange'));session.stream.track.onended();assert.equal(session.forceMicrophoneRefresh,true);
  session.stop();assert.equal(listeners.size,0);
});

test('Observe never opens or watches an input microphone',async t=>{
  const {session,calls,listeners}=setup(t,'simulation','observe');await session.watchDevices();session.queueMicrophoneRefresh(true);await session.refreshMicrophone();
  assert.equal(calls.length,0);assert.equal(listeners.size,0);assert.equal(session.deviceTimer,undefined);
});


test('Speakerphone requests room capture without browser close-talker filters on either permission probe or pinned input',async t=>{
  const {session,media,calls}=setup(t,'speakerphone');
  media.enumerateDevices=async()=>[device('default','Default - MacBook Pro Microphone','builtin'),device('builtin','MacBook Pro Microphone')];
  media.getUserMedia=async constraints=>{calls.push(constraints);return stream('MacBook Pro Microphone','builtin');};
  session.stream=await session.openMicrophone();
  assert.equal(calls.length,2);
  for(const {audio,video} of calls){assert.equal(audio.echoCancellation,false);assert.equal(audio.noiseSuppression,false);assert.equal(audio.autoGainControl,true);assert.equal(video,false);}
  session.setMuted(true);assert.equal(session.stream.track.enabled,false);
  session.setMuted(false);assert.equal(session.stream.track.enabled,true);
  session.stop();assert.equal(session.stream.track.readyState,'ended');
});

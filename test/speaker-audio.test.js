import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmWav, LiveSpeakers } from '../app/live-speakers.js';
import { diarizeAudio } from '../speaker-audio-api.js';
import { coachingRequest } from '../api.js';

test('voice verifier sends bounded valid audio and returns clip-local speakers, never customer role guesses',async()=>{
  const audio=pcmWav([new Float32Array(48000).fill(0.2)],48000);
  assert.equal(audio.length,32044);assert.equal(new DataView(audio.buffer).getUint32(24,true),16000);
  const evidence=await diarizeAudio({key:'test-key',payload:{mode:'speakerphone',audio},fetcher:async(url,options)=>{
    assert.equal(options.body.get('model'),'gpt-4o-transcribe-diarize');
    assert.equal(options.body.get('response_format'),'diarized_json');
    assert.equal(options.body.get('file').size,audio.length);
    return Response.json({segments:[{speaker:'A',text:'Hi, I am from Salesforce.',start:0,end:0.5},{speaker:'B',text:'We already use Salesforce.',start:0.5,end:1},{speaker:'C',text:'bad timestamp',start:1,end:40}]});
  }});
  assert.equal(evidence.segments.length,2);assert.equal(evidence.segments[0].voice,'A');assert.equal(evidence.segments[0].role,undefined);
  const live=coachingRequest({mode:'speakerphone',audioSpeakerEvidence:{...evidence,clipId:1}});
  assert.equal(JSON.parse(live.input).audio_speaker_evidence.segments[1].voice,'B');
  assert.match(live.instructions,/Voice IDs apply ONLY within that clip/);
  assert.equal(JSON.parse(coachingRequest({mode:'simulation',audioSpeakerEvidence:evidence}).input).audio_speaker_evidence,undefined);
  await assert.rejects(diarizeAudio({key:'x',payload:{mode:'simulation',audio},fetcher:()=>assert.fail()}),/live calls/);
  await assert.rejects(diarizeAudio({key:'x',payload:{mode:'speakerphone',audio:new Uint8Array(1100001)}}),/Invalid/);
});

test('voice verification coalesces requests and ignores late results after pause or end',async()=>{
  let resolve,calls=0,events=0;
  const verifier=new LiveSpeakers({bridge:{diarize:()=>{calls++;return new Promise(r=>resolve=r);}},onEvidence:()=>events++,onStatus:()=>{}});
  verifier.context={sampleRate:16000,close:async()=>{}};verifier.chunks=[new Float32Array(16000)];verifier.samples=16000;verifier.pending=true;
  const first=verifier.check();verifier.pending=true;await verifier.check();assert.equal(calls,1);
  verifier.setEnabled(false);resolve({segments:[]});await first;assert.equal(events,0);assert.equal(verifier.samples,0);
  verifier.setEnabled(true);verifier.chunks=[new Float32Array(16000)];verifier.samples=16000;verifier.pending=true;
  const second=verifier.check();verifier.stop();resolve({segments:[]});await second;assert.equal(events,0);assert.deepEqual(verifier.chunks,[]);
});

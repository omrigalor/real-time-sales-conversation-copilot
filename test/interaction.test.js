import { sessionConfig } from '../api.js';
import { accountKey, normalizeLibrary, saveToLibrary, trainingAccount } from '../app/account-library.js';
import { callContext } from '../app/call-context.js';
import { PreCallBrief } from '../app/brief.js';
import { accountForCall } from '../app/account-context.js';
import { SCENARIOS, getScenario, openingLine, scenariosForRole } from '../app/scenarios.js';
// These run the real renderer and voice-session code in a DOM with mocked device/API boundaries.
// They do not substitute for microphone/WebRTC checks in the packaged desktop app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { VoiceSession } from '../app/session.js';
import { ObserveSession } from '../app/observe.js';
import { Transcript, ReminderMemory, friendlyError } from '../app/state.js';
const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const renderer = (await readFile(new URL('../app/renderer.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));

async function mount(t, { hasKey = true, saved = false, keyStorageState, retryKeyFails = false, initialAccount, delay = false, deny = false, fail = false, holdRing = false, holdFocus = false } = {}) {
  const win = new Window({ url: 'https://copilot.local', settings: { disableCSSFileLoading: true, enableJavaScriptEvaluation: true } });
  win.document.write(html.replace(/<script[^>]*>.*?<\/script>/gs, ''));
  const state = { requests: [], sent: [], tracks: [], tones: [], stops: 0, connects: 0, settings: { hasKey, saved, keyStorageState, accountBrief:initialAccount, accountLibrary:initialAccount?[initialAccount]:[], context: 'Salesforce for retail' } };
  let coachListener;
  const bridge = {
    settings: async () => state.settings,
    retrySavedKey: async () => { state.retries=(state.retries||0)+1; if(retryKeyFails)throw new Error('Keychain is unavailable'); return (state.settings={...state.settings,hasKey:true,saved:true,keyStorageState:'saved'}); },
    saveRepName: async name => { state.settings.repName = name; state.nameSaved = name; return name; },
    productFocus: async payload => {
      (state.focusRequests ||= []).push(payload);
      if(holdFocus)return new Promise(resolve=>{(state.focusResolvers ||= []).push(resolve);});
      return null;
    },
    saveSettings: async data => (state.settings = { ...state.settings, hasKey: true, saved: data.remember, contextNotes: {...state.settings.contextNotes, [data.contextScope]:data.context}, repName: data.repName }),
    forgetKey: async () => {}, microphonePermission: async () => !deny,
    connect: async payload => { state.lastConnection = payload; state.connects++; if (delay) await new Promise(resolve => { state.release = resolve; }); if (fail) throw new Error('OpenAI rejected this API key.'); return payload.mode==='simulation'?{sdp:'v=0',buyerInstructions:sessionConfig('simulation','',payload.scenarioId,payload).instructions}:'v=0'; },
    stop: async () => { state.stops++; }, cancelCoach: async () => {},
    saveAccount: async value => { state.settings.accountBrief=value;state.settings.accountLibrary=saveToLibrary(state.settings.accountLibrary,value); return value; },
    openSource: async url => { state.openedSource=url; },
    research: async payload => { state.researchPayload=payload;return new Promise(resolve=>{state.resolveResearch=resolve;}); },
    handoff: async payload => {state.handoffPayload=payload;return {eligible:false,reason:'No agreed AE next step.'};},
    observe: async payload => { state.observePayload = payload; return new Promise(resolve => { state.resolveObserve = resolve; }); },
    review: async payload => { state.reviewPayload = payload; return { summary: 'Mock review', moments: [], takeaway: 'Mock focus' }; },
    coach: async payload => { state.requests.push(payload); }, onCoach: cb => { coachListener = cb; }, pin: async v => v,
  };
  const globals = {
    navigator: { mediaDevices: { getUserMedia: async () => {
      const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } }; state.tracks.push(track);
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    }, getDisplayMedia: async () => {
      state.displayCaptures=(state.displayCaptures||0)+1;
      const audio={kind:'audio',enabled:true,readyState:'live',stop(){this.readyState='ended';}},video={kind:'video',readyState:'live',stop(){this.readyState='ended';}};
      state.directSource=audio;state.directVideo=video;
      return {getTracks:()=>[audio,video],getAudioTracks:()=>[audio],getVideoTracks:()=>[video]};
    } } },
    Audio: class { constructor(src) { this.src = src; if (src) state.repAudio = this; else state.audio = this; } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } },
    AudioContext: class {
      currentTime = 0; destination = {};
      async resume() {}
      createMediaStreamDestination() {
        const track={kind:'audio',enabled:true,readyState:'live',stop(){this.readyState='ended';}};state.directOutput=track;
        return {stream:{getTracks:()=>[track],getAudioTracks:()=>[track]}};
      }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      createOscillator() {
        const tone = { frequency: { value: 0 }, connect() {}, disconnect() { this.disconnected = true; }, start() {}, stop(time) { if (time !== undefined && !holdRing) queueMicrotask(() => this.onended?.()); } };
        state.tones.push(tone); return tone;
      }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; } createAnalyser() { return { fftSize: 256, disconnect() {}, getByteTimeDomainData(a) { a.fill(128); } }; } close() { return Promise.resolve(); } },
    RTCPeerConnection: class {
      createDataChannel() { const ch = this.channel = { readyState: 'connecting', send: text => state.sent.push(JSON.parse(text)), close: () => { ch.readyState = 'closed'; ch.onclose?.(); } }; state.channel = ch; return ch; }
      addTransceiver() {} addTrack(track) {state.sentAudioTrack=track;} async createOffer() { return { type: 'offer', sdp: 'v=0' }; } async setLocalDescription() {}
      async setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); this.channel.readyState = 'open'; this.channel.onopen?.(); }
      close() { this.connectionState = 'closed'; }
    },
  };
  const previous = {};
  for (const [key, value] of Object.entries(globals)) { previous[key] = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  Object.assign(win, { copilot: bridge, VoiceSession, ObserveSession, PreCallBrief, accountForCall, callContext, accountKey, normalizeLibrary, saveToLibrary, trainingAccount, Transcript, ReminderMemory, SCENARIOS, getScenario, openingLine, scenariosForRole, friendlyError });
  await win.eval(`(async () => { const {VoiceSession,ObserveSession,PreCallBrief,accountForCall,callContext,accountKey,normalizeLibrary,saveToLibrary,trainingAccount,Transcript,ReminderMemory,SCENARIOS,getScenario,openingLine,scenariosForRole,friendlyError} = window; ${renderer}\n })()`);
  const $ = id => win.document.getElementById(id);
  t.after(async () => {
    win.dispatchEvent(new win.Event('beforeunload'));
    await win.happyDOM.close();
    for (const key of Object.keys(globals)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  });
  return { win, $, state, emit: event => state.channel.onmessage({ data: JSON.stringify(event) }), coach: event => coachListener(event) };
}

function repTurn(emit, id, text) {
  emit({ type: 'input_audio_buffer.speech_started', item_id: id });
  emit({ type: 'input_audio_buffer.speech_stopped', item_id: id });
  emit({ type: 'input_audio_buffer.committed', item_id: id });
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
}
async function beginConversation(emit) {
  await finishBuyerPlayback(emit);
  repTurn(emit, 'rep-first', "Hi, I'm Omri from Salesforce.");
  await tick(700);
  await finishBuyerPlayback(emit, 'buyer-first-response');
  emit({ type: 'response.output_audio_transcript.done', item_id: 'buyer-first', transcript: 'We look it up manually.' });
  await tick(150);
}

test('renderer: missing key opens settings without touching the microphone', async t => {
  const { $, state } = await mount(t, { hasKey: false });
  $('start').click(); await tick();
  assert.equal($('settings-dialog').open, true);
  assert.equal(state.tracks.length, 0); assert.equal(state.connects, 0);
});
test('renderer + voice: buyer greets first; late transcripts keep order; muted and stopped tracks are released', async t => {
  const { $, state, emit, coach } = await mount(t);
  $('start').click(); await tick();
  assert.match($('start').textContent, /End session/);
  assert.equal(state.sent[0].type, 'response.create');
  await finishBuyerPlayback(emit);
  emit({ type: 'input_audio_buffer.speech_started', item_id: 'seller' });
  emit({ type: 'response.output_audio_transcript.done', item_id: 'buyer', transcript: 'We lose track of requests.' });
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'seller', transcript: 'What is difficult?' });
  await tick(150);
  assert.equal(state.requests.at(-1).turns[0].speaker, 'seller');
  coach({ type: 'delta', id: state.requests.at(-1).id, text: 'Where do they get lost?' });
  assert.equal($('suggestion').textContent, 'Where do they get lost?');
  $('mute').click(); assert.equal(state.tracks[0].enabled, false);
  $('start').click(); assert.equal(state.tracks[0].readyState, 'ended');
  coach({ type: 'delta', id: state.requests.at(-1).id, text: 'STALE' });
  assert.notEqual($('suggestion').textContent, 'STALE');
});
test('renderer + voice: speakerphone remains silent and passes both people to coaching', async t => {
  const { $, state, emit, win } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  assert.equal(state.sent.length, 0);
  assert.equal(state.tones.length, 0);
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'a', transcript: 'We already use a CRM.' });
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'b', transcript: 'How is that working?' });
  await tick(150);
  assert.equal(state.requests.at(-1).turns.length, 2);
  win.document.querySelectorAll('.speaker-label')[1].click(); await tick(150);
  assert.equal(state.requests.at(-1).turns[1].speaker, 'seller');
});
test('renderer + voice: mode switch during handshake closes tracks and ignores late connection', async t => {
  const { $, state } = await mount(t, { delay: true });
  $('start').click(); await tick();
  assert.equal(state.connects, 1);
  $('speakerphone-tab').click(); state.release(); await tick();
  assert.match($('start').textContent, /Start listening/);
  assert.equal(state.tracks[0].readyState, 'ended'); assert.equal(state.sent.length, 0);
});
test('renderer + voice: API failure recovers cleanly', async t => {
  const { $, state } = await mount(t, { fail: true });
  $('start').click(); await tick();
  assert.match($('error-text').textContent, /OpenAI rejected/);
  assert.match($('start').textContent, /Start practice/);
  assert.equal(state.tracks[0].readyState, 'ended');
});
test('renderer + voice: microphone denial does not create an API session', async t => {
  const { $, state } = await mount(t, { deny: true });
  $('start').click(); await tick();
  assert.match($('error-text').textContent, /Microphone/);
  assert.equal(state.connects, 0); assert.equal(state.tracks.length, 0);
});
test('renderer: new turn immediately rejects stale suggestions and transcript cannot inject HTML', async t => {
  const { $, state, emit, coach, win } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  const id = state.requests.at(-1).id;
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'x', transcript: '<img src=x onerror="alert(1)">' });
  coach({ type: 'delta', id, text: 'STALE' }); await tick();
  assert.notEqual($('suggestion').textContent, 'STALE');
  assert.equal(win.document.querySelectorAll('#transcript img').length, 0);
  assert.match($('transcript').textContent, /<img/);
});
test('renderer: incomplete voice reply is reported without disconnecting the call', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick();
  emit({ type: 'response.done', response: { status: 'incomplete', status_details: { reason: 'max_output_tokens' } } });
  assert.match($('error-text').textContent, /reply ended before it finished/);
  assert.match($('start').textContent, /End session/);
  assert.equal(state.tracks[0].readyState, 'live');
});
test('renderer: late transcript after an interruption cannot restore unspoken words or trigger new coaching', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick();
  emit({ type: 'response.output_audio_transcript.delta', item_id: 'buyer', delta: 'Our stores' });
  emit({ type: 'conversation.item.truncated', item_id: 'buyer' });
  const requests = state.requests.length;
  emit({ type: 'response.output_audio_transcript.done', item_id: 'buyer', transcript: 'Our stores have a long answer that was never heard.' });
  await tick(150);
  assert.match($('transcript').textContent, /Buyer interrupted/);
  assert.doesNotMatch($('transcript').textContent, /never heard/);
  assert.equal(state.requests.length, requests);
});

test('renderer: contextual roles appear without another request; stale roles and overrides are protected', async t => {
  const { $, state, emit, coach, win } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  const oldId = state.requests.at(-1).id;
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'a', transcript: 'We already use Salesforce.' });
  await tick(150);
  coach({ type: 'roles', id: oldId, roles: [{ id: 'a', speaker: 'seller' }] });
  assert.equal(win.document.querySelector('.speaker-label').textContent, 'Speaker');
  const request = state.requests.at(-1);
  const count = state.requests.length;
  coach({ type: 'roles', id: request.id, roles: [{ id: 'a', speaker: 'buyer' }] });
  await tick();
  assert.equal(win.document.querySelector('.speaker-label').textContent, 'Buyer');
  assert.match(win.document.querySelector('.speaker-label').title, /inferred from context/);
  await tick(150);
  assert.equal(state.requests.length, count);
  win.document.querySelector('.speaker-label').click(); await tick(150);
  const corrected = state.requests.at(-1);
  assert.equal(corrected.turns[0].speakerSource, 'manual');
  coach({ type: 'roles', id: corrected.id, roles: [{ id: 'a', speaker: 'buyer' }] });
  await tick();
  assert.equal(win.document.querySelector('.speaker-label').textContent, 'Speaker');
});

test('speakerphone keeps the current line readable on speech and rejects stale output until the newest turn completes', async t => {
  const { $, state, emit, coach } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  const oldId = state.requests.at(-1).id;
  coach({ type: 'delta', id: oldId, text: 'Old rep suggestion' });
  emit({ type: 'input_audio_buffer.speech_started', item_id: 'old' });
  emit({ type: 'input_audio_buffer.speech_started', item_id: 'new' });
  assert.equal($('suggestion').textContent, 'Old rep suggestion');
  assert.equal($('suggestion-label').textContent,'SAY');
  assert.match($('coach-status').textContent,/line retained/);
  coach({ type: 'delta', id: oldId, text: 'Stale buyer response' });
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'old', transcript: 'Earlier turn' });
  const count = state.requests.length;
  await tick(150);
  assert.equal(state.requests.length, count);
  assert.equal($('suggestion').textContent,'Old rep suggestion');
  assert.equal($('suggestion-label').textContent,'SAY');
  assert.doesNotMatch($('suggestion').textContent, /Stale buyer/);
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'new', transcript: 'How do you handle returns?' });
  await tick(150);
  const id = state.requests.at(-1).id;
  coach({ type: 'hold', id, reason: 'wait' });
  coach({ type: 'done', id });
  assert.equal($('suggestion').textContent, 'Let the client respond.');
  assert.equal($('suggestion-label').textContent, 'HOLD');
  assert.equal($('coach-status').textContent, 'Listening');
});

test('conversation focus is concise, rejects stale results and resets across live sessions', async t => {
  const { $, state, emit, coach } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'b', transcript: 'Orders sometimes need another system.' }); await tick(150);
  const id = state.requests.at(-1).id;
  coach({ type: 'objective', id, objective: { current: 'Understand the lookup', known: [{text:'External order lookup'}], unknown: ['Does it matter?'] } });
  assert.equal($('current-objective').textContent, 'Understand the lookup');
  assert.equal($('focus-known').textContent, 'External order lookup');
  assert.equal($('close-score'), null);
  $('start').click(); $('start').click(); await tick();
  coach({ type: 'objective', id, objective: { current: 'STALE', known: [], unknown: [] } });
  assert.notEqual($('current-objective').textContent, 'STALE');
  assert.match($('focus-known').textContent, /Listening/);
  assert.equal(state.requests.at(-1).goal, undefined);
});

test('simulation rings before requesting the greeting and keeps the ring out of microphone input', async t => {
  const { $, state } = await mount(t, { holdRing: true });
  $('start').click(); await tick();
  assert.equal($('session-status').textContent, 'Ringing…');
  assert.deepEqual(state.tones.map(tone => tone.frequency.value), [440, 480]);
  assert.equal(state.sent.length, 0);
  assert.equal(state.tracks[0].enabled, false);
  state.tones.at(-1).onended(); await tick();
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].type, 'response.create');
  assert.equal(state.tracks[0].enabled, false);
  assert.ok(state.tones.every(tone => tone.disconnected));
  assert.match($('start').textContent, /End session/);
});

test('cancelling during the ring stops sound and never requests a buyer greeting', async t => {
  const { $, state } = await mount(t, { holdRing: true });
  $('start').click(); await tick();
  const lateEnded = state.tones.at(-1).onended;
  $('start').click(); lateEnded(); await tick();
  assert.ok(state.tones.every(tone => tone.disconnected));
  assert.equal(state.tracks[0].readyState, 'ended');
  assert.equal(state.sent.length, 0);
  assert.match($('start').textContent, /Start practice/);
});

test('scenario selector changes the contact, connection and greeting, and is locked during a call', async t => {
  const { $, state, win, emit } = await mount(t);
  assert.match($('scenario-contact').textContent, /Maya Chen.*Target/);
  $('scenario-select').value = 'harbor-sales'; $('scenario-select').dispatchEvent(new win.Event('change'));
  assert.match($('person-title').textContent, /Elena/);
  $('start').click(); await tick();
  assert.equal(state.lastConnection.scenarioId, 'harbor-sales');
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].opening, true);
  await beginConversation(emit);
  assert.equal(state.requests.at(-1).scenarioId, 'harbor-sales');
  assert.match(state.sent[0].response.instructions, /Elena speaking/);
  assert.equal($('scenario-select').disabled, true);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  assert.equal($('scenario-panel').hidden, true);
  assert.equal(state.requests.at(-1).scenarioId, undefined);
});

test('insight panels update safely, remember dismissal, reject stale results, and reset on new scenario', async t => {
  const { $, state, coach, win, emit } = await mount(t);
  $('start').click(); await tick(); await beginConversation(emit);
  const id = state.requests.at(-1).id;
  coach({ type: 'reminders', id, reminders: { items: [{ id: 'owner', text: 'Confirm who owns <img src=x>.' }], covered: [] } });
  assert.equal(win.document.querySelectorAll('#reminders-list img').length, 0);
  assert.match($('reminders-list').textContent, /Confirm who owns/);
  coach({ type: 'opportunity', id, opportunity: { pains: [{ id: 'lookup', text: 'Manual order lookup', quote: 'We look it up manually' }], fit: { motion: 'optimize', product: 'Service Cloud', reason: 'Reduce handoffs.', validate: 'Current integration.' } } });
  assert.match($('pain-list').textContent, /Manual order lookup/);
  assert.match($('fit-product').textContent, /Optimize: Service Cloud/);
  win.document.querySelector('#reminders-list button').click(); await tick();
  assert.deepEqual(state.requests.at(-1).reminderMemory.covered, ['owner']);
  coach({ type: 'reminders', id, reminders: { items: [{ id: 'stale', text: 'Old result' }], covered: [] } });
  assert.doesNotMatch($('reminders-list').textContent, /Old result/);
  $('start').click();
  $('scenario-select').value = 'cedar-onboarding'; $('scenario-select').dispatchEvent(new win.Event('change'));
  assert.equal($('pain-list').children.length, 0);
  assert.equal($('reminders-list').children.length, 0);
  assert.match($('fit-product').textContent, /No fit/);
});

test('failed coaching replaces the preparing placeholder with an actionable state', async t => {
  const { $, state, coach, emit } = await mount(t);
  $('start').click(); await tick(); await beginConversation(emit);
  const id = state.requests.at(-1).id;
  coach({ type: 'hold', id, reason: 'retrying' });
  assert.match($('suggestion').textContent, /Retrying/);
  coach({ type: 'error', id, message: 'Suggestion did not finish. Try Refresh.' });
  assert.doesNotMatch($('suggestion').textContent, /Preparing|Retrying/);
  assert.match($('suggestion').textContent, /Tap Refresh/);
  assert.equal($('refresh').disabled, false);
  assert.equal($('transcript').closest('.transcript-side')?.parentElement.className, 'main-with-transcript');
});

test('simulation prepares one opener privately through ringing and greeting, then locks it when the rep begins', async t => {
  const { $, state, emit, coach } = await mount(t, { holdRing: true });
  $('start').click();
  assert.equal($('suggestion').textContent, 'Waiting for them to answer.');
  await tick();
  assert.equal(state.requests.length, 1);
  const openingId=state.requests[0].id;
  assert.equal(state.requests[0].opening,true);
  assert.equal(state.requests[0].scenarioId,'target-service');
  const generated="Hi Maya, it's Omri from Salesforce. A prepared opening for this account.";
  coach({type:'delta',id:openingId,text:generated});coach({type:'done',id:openingId});
  assert.equal($('suggestion').textContent,'Waiting for them to answer.','Completed opening stays private during ringing');
  state.tones.at(-1).onended(); await tick();
  emit({ type: 'output_audio_buffer.started', response_id: 'hello' });
  emit({ type: 'response.output_audio_transcript.done', item_id: 'greeting', transcript: 'Hi, Maya speaking.' });
  await tick(150);
  assert.equal($('suggestion').textContent,'Let them finish.');
  assert.equal(state.requests.length,1,'Greeting does not regenerate an existing opener');
  await finishBuyerPlayback(emit);
  assert.equal($('suggestion').textContent,generated,'Restore exactly the prepared opening after playback');
  repTurn(emit, 'rep', "Hi, it's Omri from Salesforce.");
  coach({type:'delta',id:openingId,text:'Late replacement must not change the line being read'});
  assert.equal($('suggestion').textContent,generated);
  await tick(700);
  assert.equal($('suggestion').textContent, 'Let the client respond.');
  emit({ type: 'response.output_audio_transcript.done', item_id: 'buyer', transcript: 'What is the call about?' });
  await tick();
  assert.equal(state.requests.length,2);
  assert.equal(state.requests.at(-1).opening,false);
});

test('an opening retry cannot flash an unfinished version before the completed line', async t => {
  const { $, state, emit, coach } = await mount(t);
  $('start').click(); await tick();
  const id = state.requests[0].id;
  coach({type:'delta',id,text:'An unfinished first version'});
  await finishBuyerPlayback(emit);
  assert.equal($('suggestion').textContent,'Preparing your next line…');
  coach({type:'hold',id,reason:'retrying'});
  coach({type:'delta',id,text:'The completed replacement'});
  assert.equal($('suggestion').textContent,'Preparing your next line…');
  coach({type:'done',id});
  assert.equal($('suggestion').textContent,'The completed replacement');
  emit({type:'response.output_audio_transcript.done',item_id:'greeting',transcript:'Hello.'});
  await tick();
  assert.equal(state.requests.length,1,'A delayed greeting transcript does not rewrite the opener');
  assert.equal($('suggestion').textContent,'The completed replacement');
});

test('buyer audio keeps microphone off beyond generation completion; reopening respects mute', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick();
  assert.equal(state.tracks[0].enabled, false);
  emit({ type: 'response.created', response: { id: 'hello' } });
  emit({ type: 'output_audio_buffer.started', response_id: 'hello' });
  $('mute').click(); $('mute').click();
  assert.equal(state.tracks[0].enabled, false, 'manual unmute must not bypass playback protection');
  emit({ type: 'response.done', response: { id: 'hello', status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
  await tick(250);
  assert.equal(state.tracks[0].enabled, false, 'generation is finished but playback continues');
  emit({ type: 'output_audio_buffer.stopped', response_id: 'hello' });
  assert.equal(state.tracks[0].enabled, false, 'room echo tail remains blocked');
  await tick(250);
  assert.equal(state.tracks[0].enabled, true);
  assert.equal(state.sent.at(-1).type, 'input_audio_buffer.clear');
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 1);
  repTurn(emit, 'rep-second', 'What do you mean?'); await tick(220);
  emit({ type: 'response.created', response: { id: 'second' } });
  assert.equal(state.tracks[0].enabled, false, 'later buyer replies receive the same protection');
  emit({ type: 'output_audio_buffer.started', response_id: 'second' });
  $('mute').click();
  emit({ type: 'response.done', response: { id: 'second', status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
  emit({ type: 'output_audio_buffer.stopped', response_id: 'second' });
  await tick(250);
  assert.equal(state.tracks[0].enabled, false, 'user mute survives the gate reopening');
  $('mute').click(); assert.equal(state.tracks[0].enabled, true);
});

test('Interrupt cancels once and clears playback before reopening the mic', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick();
  emit({ type: 'response.created', response: { id: 'hello' } });
  emit({ type: 'output_audio_buffer.started', response_id: 'hello' });
  assert.equal($('interrupt').disabled, false);
  $('interrupt').click(); $('interrupt').click();
  assert.equal($('interrupt').disabled, true);
  assert.deepEqual(state.sent.slice(-2).map(e => e.type), ['response.cancel', 'output_audio_buffer.clear']);
  assert.equal(state.sent.filter(e => e.type === 'response.cancel').length, 1);
  emit({ type: 'error', error: { code: 'response_cancel_not_active', message: 'No active response to cancel.' } });
  assert.equal(state.tracks[0].readyState, 'live');
  assert.match($('start').textContent, /End session/);
  await tick(250); assert.equal(state.tracks[0].enabled, false);
  emit({ type: 'response.done', response: { id: 'hello', status: 'cancelled' } });
  emit({ type: 'output_audio_buffer.cleared', response_id: 'hello' });
  assert.equal(state.tracks[0].enabled, false);
  await tick(250); assert.equal(state.tracks[0].enabled, true);
});

test('playback-stop before generation-done is safe, and stale events cannot unmute a newer reply', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick();
  emit({ type: 'response.created', response: { id: 'a' } });
  emit({ type: 'output_audio_buffer.started', response_id: 'a' });
  emit({ type: 'output_audio_buffer.stopped', response_id: 'a' });
  await tick(250); assert.equal(state.tracks[0].enabled, false);
  emit({ type: 'response.done', response: { id: 'a', status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
  await tick(250); assert.equal(state.tracks[0].enabled, true);
  repTurn(emit, 'rep-b', 'Can you explain?'); await tick(220);
  emit({ type: 'response.created', response: { id: 'b' } });
  emit({ type: 'output_audio_buffer.started', response_id: 'b' });
  emit({ type: 'output_audio_buffer.stopped', response_id: 'a' });
  emit({ type: 'response.done', response: { id: 'a', status: 'cancelled' } });
  await tick(250); assert.equal(state.tracks[0].enabled, false);
  emit({ type: 'response.done', response: { id: 'b', status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
  emit({ type: 'output_audio_buffer.stopped', response_id: 'b' });
  $('start').click();
  await tick(250);
  assert.equal(state.tracks[0].readyState, 'ended');
  assert.equal(state.tracks[0].enabled, false, 'end cancels pending mic release');
});

test('speakerphone keeps continuous input and ignores simulation playback events', async t => {
  const { $, state, emit } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  assert.equal($('interrupt').hidden, true);
  emit({ type: 'response.created', response: { id: 'ignored' } });
  emit({ type: 'output_audio_buffer.started', response_id: 'ignored' });
  assert.equal(state.tracks[0].enabled, true);
  assert.equal(state.sent.length, 0);
});

async function finishBuyerPlayback(emit, id = 'greeting') {
  emit({ type: 'response.created', response: { id } });
  emit({ type: 'output_audio_buffer.started', response_id: id });
  emit({ type: 'response.done', response: { id, status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
  emit({ type: 'output_audio_buffer.stopped', response_id: id });
  await tick(250);
}

test('hands-free: resumed speech cancels a pending reply and one completed turn produces one answer', async t => {
  const { $, state, emit, coach } = await mount(t);
  $('start').click(); await tick();
  const id = state.requests[0].id;
  coach({type:'delta',id,text: "Hi Maya, it's Omri from Salesforce."}); coach({type:'done',id});
  await finishBuyerPlayback(emit);
  assert.equal($('finish-turn'), null);
  repTurn(emit, 'intro', "Hi Maya, it's Omri from Salesforce.");
  await tick(100);
  assert.match($('suggestion').textContent, /Omri from Salesforce/);
  emit({ type: 'input_audio_buffer.speech_started', item_id: 'reason' });
  await tick(700);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(state.tracks[0].enabled, true);
  emit({ type: 'input_audio_buffer.speech_stopped', item_id: 'reason' });
  emit({ type: 'input_audio_buffer.committed', item_id: 'reason' });
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'reason', transcript: 'I wanted to ask about rising service costs.' });
  await tick(700);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 2);
  assert.equal(state.sent.some(e => e.type === 'input_audio_buffer.commit'), false, 'semantic VAD commits, no manual turn action');
  emit({ type: 'input_audio_buffer.committed', item_id: 'reason' });
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'reason', transcript: 'I wanted to ask about rising service costs.' });
  await finishBuyerPlayback(emit, 'answer');
  await tick(700);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 2, 'finishing playback cannot chain another response');
  repTurn(emit, 'short-answer', 'Yes.');
  await tick(300);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 3, 'later complete turns use only a short grace period');
});

test('echo, unsolicited transcripts, and filler fragments cannot authorize a buyer reply', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick();
  repTurn(emit, 'speaker-echo', 'Hi Maya speaking.');
  await finishBuyerPlayback(emit);
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'speaker-echo', transcript: 'Hi Maya speaking.' });
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'no-start', transcript: 'A phantom transcript.' });
  repTurn(emit, 'noise', '아');
  repTurn(emit, 'filler', 'Um...');
  await tick(700);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 1);
  assert.doesNotMatch($('transcript').textContent, /phantom|아|Um|Hi Maya speaking/);
  repTurn(emit, 'real-answer', 'How is your team doing?');
  await tick(700);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 2);
});

test('ending or changing mode cancels the hands-free reply grace period', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick(); await finishBuyerPlayback(emit);
  repTurn(emit, 'rep', 'How is your team doing?');
  $('speakerphone-tab').click(); await tick(700);
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'rep', transcript: 'A late duplicate.' });
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(state.tracks[0].readyState, 'ended');
});

test('Pause holds microphone, pending replies, coaching and timer while preserving details', async t => {
  const { $, state, emit, coach } = await mount(t);
  $('start').click(); await tick(); await beginConversation(emit);
  const id = state.requests.at(-1).id;
  coach({ type: 'delta', id, text: 'Which handoff adds work?' });
  coach({ type: 'opportunity', id, opportunity: { pains: [{ id: 'p', text: 'Manual order lookup', quote: 'We look it up manually.' }], fit: { motion: 'optimize', product: 'Service Cloud', reason: 'Reduce lookup work.', validate: 'Integrations.' } } });
  repTurn(emit, 'next', 'Could we explore that?');
  $('pause').click();
  const frozenTime = $('timer').textContent;
  const responses = state.sent.filter(e => e.type === 'response.create').length;
  assert.equal(state.tracks[0].enabled, false);
  assert.equal(state.audio.muted, true);
  assert.equal($('refresh').disabled, true);
  coach({ type: 'delta', id, text: 'Late replacement' });
  await tick(1100);
  assert.equal($('timer').textContent, frozenTime);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, responses);
  assert.equal($('suggestion').textContent, 'Which handoff adds work?');
  assert.match($('fit-product').textContent, /Service Cloud/);
  assert.equal($('session-status').textContent, 'Conversation paused');
  $('pause').click();
  assert.equal(state.tracks[0].enabled, true);
  assert.equal(state.audio.muted, false);
  await tick(300);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, responses + 1);
});

test('Pause immediately silences buyer audio and resume continues once after cancellation', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick();
  emit({ type: 'response.created', response: { id: 'greeting' } });
  emit({ type: 'output_audio_buffer.started', response_id: 'greeting' });
  $('pause').click();
  assert.equal(state.audio.muted, true);
  assert.equal(state.tracks[0].enabled, false);
  assert.deepEqual(state.sent.slice(-2).map(e => e.type), ['response.cancel', 'output_audio_buffer.clear']);
  $('pause').click(); // Resuming before the cancellation acknowledgment must wait.
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(state.audio.muted, true);
  emit({ type: 'response.done', response: { id: 'greeting', status: 'cancelled' } });
  emit({ type: 'output_audio_buffer.cleared', response_id: 'greeting' });
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 2);
  assert.match(state.sent.at(-1).response.instructions, /Do not greet again/);
  assert.equal(state.audio.muted, false);
  emit({ type: 'output_audio_buffer.cleared', response_id: 'greeting' });
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 2);
});

test('Speakerphone pause preserves manual mute and does not create voice responses', async t => {
  const { $, state } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  $('mute').click(); $('pause').click(); $('pause').click();
  assert.equal(state.tracks[0].enabled, false, 'resume preserves user mute');
  $('mute').click(); assert.equal(state.tracks[0].enabled, true);
  $('pause').click(); assert.equal(state.tracks[0].enabled, false);
  $('start').click(); $('start').click(); await tick();
  assert.equal($('pause').textContent, 'Pause conversation');
  assert.equal(state.tracks[1].enabled, true);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 0);
});

test('a late buyer response starting after Pause is silenced and cancelled until Resume', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick();
  $('pause').click(); // Greeting requested, but the server has not begun it yet.
  emit({ type: 'response.created', response: { id: 'late-greeting' } });
  emit({ type: 'output_audio_buffer.started', response_id: 'late-greeting' });
  assert.equal(state.audio.muted, true);
  assert.equal(state.tracks[0].enabled, false);
  assert.equal(state.sent.filter(e => e.type === 'response.cancel').length, 1);
  emit({ type: 'response.done', response: { id: 'late-greeting', status: 'cancelled' } });
  emit({ type: 'output_audio_buffer.cleared', response_id: 'late-greeting' });
  await tick(300);
  assert.equal(state.tracks[0].enabled, false);
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal($('session-status').textContent, 'Conversation paused');
  $('pause').click();
  assert.equal(state.sent.filter(e => e.type === 'response.create').length, 2);
});

test('BDR/AE switch preserves a live transcript, changes coaching and survives mode changes', async t => {
  const { $, state, emit } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'customer',transcript:'We need to understand the proposal.'});
  await tick(150);
  const before=state.requests.at(-1).turns;
  $('role-ae').click();await tick();
  assert.equal(state.requests.at(-1).salesRole,'AE');
  assert.deepEqual(state.requests.at(-1).turns,before);
  assert.equal(state.tracks[0].readyState,'live');
  assert.equal($('role-ae').getAttribute('aria-pressed'),'true');
  $('simulation-tab').click();
  assert.equal($('role-ae').getAttribute('aria-pressed'),'true');
  $('role-bdr').click(); $('role-ae').click();
  assert.ok([...$('scenario-select').options].filter(o=>o.value!=='__random').every(o=>getScenario(o.value).role==='AE'));
});

test('audio duration alone cannot start a buyer reply; confirmed speech produces exactly one response', async t => {
  const { $, state, emit } = await mount(t);
  $('start').click(); await tick(); await finishBuyerPlayback(emit);
  emit({type:'input_audio_buffer.speech_started',item_id:'fresh-audio',audio_start_ms:0});
  emit({type:'input_audio_buffer.speech_stopped',item_id:'fresh-audio',audio_end_ms:1800});
  emit({type:'input_audio_buffer.committed',item_id:'fresh-audio'});
  await tick(290);
  assert.equal(state.sent.filter(e=>e.type==='response.create').length,1,'No phantom answer from noise duration');
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'fresh-audio',transcript:'I wanted to ask about the delivery workflow.'});
  await tick(40);
  assert.equal(state.sent.filter(e=>e.type==='response.create').length,2,'No artificial extra wait once semantic endpoint and ASR are ready');
  assert.equal(state.tracks[0].enabled,false);
  emit({type:'response.output_audio_transcript.done',item_id:'answer',transcript:'What did you have in mind?'});
  await tick(150);
  assert.deepEqual(state.requests.at(-1).turns.map(t=>t.speaker),['seller','buyer']);
  await finishBuyerPlayback(emit,'answer-response'); await tick(300);
  assert.equal(state.sent.filter(e=>e.type==='response.create').length,2,'Playback completion cannot generate another answer');
});

test('opening can recover on Refresh and Pause preserves a completed opening instead of regenerating it', async t => {
  const { $, state, coach, emit }=await mount(t);
  $('start').click();await tick();
  await finishBuyerPlayback(emit);
  const first=state.requests[0].id;
  coach({type:'error',id:first,message:'Temporary coaching failure'});
  $('refresh').click();await tick();
  assert.equal(state.requests.length,2);
  const second=state.requests.at(-1).id;
  coach({type:'delta',id:second,text:'A recovered model opening.'});coach({type:'done',id:second});
  $('pause').click();$('pause').click();await tick();
  assert.equal(state.requests.length,2,'Completed opening survives Pause');
  assert.equal($('suggestion').textContent,'A recovered model opening.');
  coach({type:'delta',id:first,text:'Stale first opening'});
  assert.equal($('suggestion').textContent,'A recovered model opening.');
});


test('live copilot hiding preserves listening, speaker labels, objective state and current advice', async t => {
  const { $, state, emit, coach, win } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  $('copilot-toggle').click();
  assert.equal(win.document.body.classList.contains('copilot-hidden'),true);
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'buyer-live',transcript:'Can Service Cloud connect our order information?'}); await tick(150);
  const id=state.requests.at(-1).id;
  coach({type:'roles',id,roles:[{id:'buyer-live',speaker:'buyer'}]});
  coach({type:'delta',id,text:'Yes, with the appropriate integration and permissions.'});coach({type:'done',id});
  assert.equal(win.document.querySelector('.coach-content').hidden,true);
  assert.equal(state.tracks[0].enabled,true);
  $('copilot-toggle').click(); await tick(150);
  assert.equal(win.document.querySelector('.coach-content').hidden,false);
  assert.equal(state.requests.at(-1).turns[0].speaker,'buyer');
  assert.equal(state.connects,1);
});

test('Practice exposes five levels, defaults to realistic 3 and sends level 1 to the buyer', async t => {
  const { $, state, win } = await mount(t);
  assert.deepEqual(Array.from($('difficulty').options,option=>option.value),['1','2','3','4','5']);
  assert.equal($('difficulty').value,'3');
  $('difficulty').value='1';$('difficulty').dispatchEvent(new win.Event('change'));
  assert.match($('difficulty').title,/Receptive, patient/);
  $('start').click();await tick();
  assert.equal(state.lastConnection.difficulty,1);
  assert.equal(state.lastConnection.trainingMode,'assisted');
  assert.equal($('difficulty').disabled,true);
  $('start').click();
});

test('Blind uses the same buyer/coach, hides all coaching panels and reviews actual spoken turns', async t => {
  const { $, state, emit, win } = await mount(t);
  $('training-mode').value='blind'; $('training-mode').dispatchEvent(new win.Event('change'));
  assert.equal(win.document.body.classList.contains('copilot-hidden'),true);
  assert.equal(win.document.querySelector('.insight-grid').hidden,true);
  $('difficulty').value='5'; $('difficulty').dispatchEvent(new win.Event('change'));
  $('start').click();await tick(); await finishBuyerPlayback(emit);
  assert.equal(state.lastConnection.trainingMode,'blind');assert.equal(state.lastConnection.difficulty,5);
  assert.equal(state.requests.length,1);
  repTurn(emit,'my-choice','Actually, I might have called the wrong person.');await tick(220);
  $('start').click();assert.equal($('review').hidden,false);
  $('review').click();await tick();
  assert.equal(state.reviewPayload.turns[0].text,'Actually, I might have called the wrong person.');
  assert.equal(state.reviewPayload.previousRecommendation,undefined);
  assert.equal($('review-content').textContent,'Mock reviewMock focus');
});

test('Observe leaves microphone off, pauses a pending rep, and sends only played seller words to buyer', async t => {
  const { $, state, emit, win } = await mount(t);
  $('simulation-tab').click();
  $('start').click();await tick();
  assert.equal(state.tracks.length,0);assert.equal(state.lastConnection.trainingMode,'observe');
  await finishBuyerPlayback(emit);
  emit({type:'response.output_audio_transcript.done',item_id:'buyer-observe',transcript:'Hi, Maya speaking.'});
  await tick(150);
  assert.ok(state.observePayload);assert.equal(state.observePayload.turns[0].speaker,'buyer');
  $('pause').click();
  state.resolveObserve({action:'SAY',say:'Hi Maya. Omri from Salesforce.',audio:new Uint8Array([1,2]),endCall:false});await tick();
  assert.equal(state.repAudio,undefined,'Pending synthesis cannot play while paused');
  $('pause').click();await tick();
  assert.equal(state.repAudio.paused,false);
  assert.equal(state.sent.filter(e=>e.type==='conversation.item.create'&&e.item.role==='user').length,0,'Unplayed recommendation is not buyer input');
  $('pause').click();assert.equal(state.repAudio.paused,true);$('pause').click();
  state.repAudio.onended();await tick();
  const spoken=state.sent.find(e=>e.type==='conversation.item.create'&&e.item.role==='user');
  assert.equal(spoken.item.content[0].text,'Hi Maya. Omri from Salesforce.');
  assert.deepEqual(Object.keys(spoken.item).sort(),['content','id','role','type']);
  assert.equal(state.sent.filter(e=>e.type==='response.create').length,2);
  $('start').click();assert.equal($('review').hidden,true);
});

test('unsolicited buyer response is cancelled and cannot appear as a second greeting', async t => {
  const {$,state,emit}=await mount(t);$('start').click();await tick();await finishBuyerPlayback(emit);
  emit({type:'response.created',response:{id:'phantom'}});
  emit({type:'response.output_audio_transcript.done',response_id:'phantom',item_id:'phantom-text',transcript:'I am answering myself.'});
  await tick();
  assert.equal(state.sent.at(-1).type,'response.cancel');
  assert.doesNotMatch($('transcript').textContent,/answering myself/);
  assert.equal(state.tracks[0].enabled,true);
});

test('AE stage filtering selects a coherent scenario and random choices stay within that stage', async t => {
  const {$,state,win}=await mount(t);$('role-ae').click();
  $('sales-stage').value='commercial';$('sales-stage').dispatchEvent(new win.Event('change'));
  assert.equal($('scenario-select').value,'ae-commercial');
  $('scenario-select').value='__random';$('scenario-select').dispatchEvent(new win.Event('change'));
  $('start').click();await tick();
  assert.equal(state.lastConnection.scenarioId,'ae-commercial');
  assert.equal(state.requests[0].salesRole,'AE');
  assert.equal($('sales-stage').disabled,true);
});


test('editable brief snapshots live context; saving a later draft cannot silently change the active call', async t => {
  const {$,state,win}=await mount(t);
  const edit=(id,text)=>{$(id).value=text;$(id).dispatchEvent(new win.Event('input'));};
  $('speakerphone-tab').click();$('account-button').click();$('new-account').click();
  edit('account-company','Example Retail');edit('account-person','Jordan');edit('account-buyerRole','VP Service');edit('account-callType','BDR cold outbound');
  $('save-account').click();await tick();$('start').click();await tick();
  assert.equal(state.requests.at(-1).accountContext.company,'Example Retail');
  $('account-button').click();edit('account-company','Next account');$('save-account').click();await tick();
  $('refresh').click();await tick(150);
  assert.equal(state.requests.at(-1).accountContext.company,'Example Retail');
  $('account-button').click();assert.equal($('apply-active-account').hidden,false);$('apply-active-account').click();await tick(150);
  assert.equal(state.requests.at(-1).accountContext.company,'Next account');assert.equal(state.connects,1);
});

test('research draft requires explicit acceptance and never overwrites manual notes or active context', async t => {
  const {$,state,win}=await mount(t);
  $('account-button').click();$('new-account').click();
  $('account-company').value='Example Retail';$('account-company').dispatchEvent(new win.Event('input'));
  $('account-notes').value='My own note';$('account-notes').dispatchEvent(new win.Event('input'));
  $('research-account').click();await tick();
  state.resolveResearch({entries:[{id:'research-1',kind:'public',text:'A sourced business update.',source:'https://example.com/investors',sourceTitle:'Investor update'}]});await tick();
  assert.equal(state.settings.accountBrief,undefined);
  assert.match($('research-results').textContent,/Public source/);
  $('research-results').querySelector('.primary-button').click();$('save-account').click();await tick();
  assert.equal(state.settings.accountBrief.notes,'My own note');assert.equal(state.settings.accountBrief.entries[0].kind,'public');
  $('account-button').click();const fact=$('account-entries').querySelector('textarea');fact.value='My corrected interpretation';fact.dispatchEvent(new win.Event('input'));$('save-account').click();await tick();
  assert.equal(state.settings.accountBrief.entries[0].kind,'user','Manual edits cannot retain researched-fact status');
});

test('SAY/HOLD is prominent and secondary intelligence is in dialogs, with no extra live panel', async t => {
  const {$,state,emit,coach,win}=await mount(t);
  assert.equal(win.document.querySelector('.call-workspace .insight-grid'),null);
  assert.ok(win.document.querySelector('#notes-dialog .insight-grid'));
  $('speakerphone-tab').click();$('start').click();await tick();
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'buyer-question',transcript:'How would Service Cloud help?'});await tick(150);
  const id=state.requests.at(-1).id;
  coach({type:'hold',id,reason:'hold',focus:'Whether the buyer finishes their example'});
  assert.equal($('suggestion-label').textContent,'HOLD');assert.match($('coach-hint').textContent,/Listen for/);
  coach({type:'delta',id,text:'Service Cloud provides a shared case workspace.'});
  coach({type:'support',id,support:{why:{reason:'The buyer asked a direct product question.',evidence:[{quote:'How would Service Cloud help?'}]},products:[{name:'Service Cloud',capability:'Shared case workflows',scope:'Verify edition',url:'https://www.salesforce.com/service/',checkedAt:'2026-09-28'}]}});
  assert.equal($('suggestion-label').textContent,'SAY');$('why-button').click();assert.match($('support-content').textContent,/direct product question/);$('close-support').click();
  $('basis-button').click();$('support-content').querySelector('button').click();await tick();assert.equal(state.openedSource,'https://www.salesforce.com/service/');
  $('focus-toggle').click();assert.equal(win.document.body.classList.contains('focus-mode'),true);
});

test('BDR live call exposes handoff only after the call and supplies its actual transcript', async t => {
  const {$,state,emit,win}=await mount(t);
  $('speakerphone-tab').click();$('start').click();await tick();
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'rep-handoff',transcript:'I can send times for a meeting with our AE.'});await tick(150);
  win.document.querySelector('.speaker-label').click();await tick(150);
  assert.equal($('handoff').hidden,true);$('start').click();assert.equal($('handoff').hidden,false);
  $('handoff').click();await tick();assert.equal(state.handoffPayload.mode,'speakerphone');assert.equal(state.handoffPayload.turns[0].speaker,'seller');
  assert.match($('handoff-content').textContent,/No agreed AE next step/);assert.equal($('copy-handoff').disabled,true);
});


test('simulation keeps prepared speech behind HOLD until buyer playback ends, then reveals it immediately', async t => {
  const { $, state, emit, coach } = await mount(t);
  $('start').click(); await tick();
  emit({type:'output_audio_buffer.started'});
  const id=state.requests.at(-1).id;
  coach({type:'delta',id,text:'Hi Maya, Omri from Salesforce. I had a quick reason for calling.'});
  coach({type:'done',id});
  assert.equal($('suggestion-label').textContent,'HOLD');
  assert.equal($('suggestion').textContent,'Let them finish.');
  emit({type:'output_audio_buffer.stopped'});
  assert.equal($('suggestion-label').textContent,'SAY');
  assert.match($('suggestion').textContent,/Omri from Salesforce/);
});

test('live HOLD reevaluates after completed buyer speech and exposes the new SAY without another click', async t => {
  const { $, state, emit, coach } = await mount(t);
  $('speakerphone-tab').click(); $('start').click(); await tick();
  emit({type:'input_audio_buffer.speech_started',item_id:'q'});
  assert.equal($('suggestion-label').textContent,'HOLD');
  emit({type:'input_audio_buffer.speech_stopped',item_id:'q'});
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'q',transcript:'How would Salesforce help with that?'});
  await tick(150);
  const id=state.requests.at(-1).id;
  coach({type:'roles',id,roles:[{id:'q',speaker:'buyer'}]});
  coach({type:'delta',id,text:'Service Cloud gives agents a shared workspace for customer cases.'});
  coach({type:'done',id});
  assert.equal($('suggestion-label').textContent,'SAY');
  assert.match($('suggestion').textContent,/shared workspace/);
});


test('left navigation separates guided Simulation, human Practice and real Speakerphone', async t => {
  const {$,state,win}=await mount(t);
  assert.equal($('practice-tab').getAttribute('aria-pressed'),'true');
  assert.deepEqual([...$('training-mode').options].map(o=>o.value),['assisted','blind']);
  $('training-mode').value='blind';$('training-mode').dispatchEvent(new win.Event('change'));
  $('simulation-tab').click();
  assert.equal($('simulation-tab').getAttribute('aria-pressed'),'true');
  assert.equal($('practice-tab').getAttribute('aria-pressed'),'false');
  assert.equal($('practice-mode-label').hidden,true);assert.equal($('difficulty-label').hidden,true);
  assert.match($('page-description').textContent,/Two AI voices/);
  $('start').click();await tick();assert.equal(state.lastConnection.trainingMode,'observe');assert.equal(state.tracks.length,0);
  $('practice-tab').click();
  assert.equal(state.channel.readyState,'closed');
  assert.equal($('training-mode').value,'blind');assert.equal($('practice-mode-label').hidden,false);
  assert.equal(win.document.body.classList.contains('copilot-hidden'),true);
  $('start').click();await tick();assert.equal(state.lastConnection.trainingMode,'blind');assert.equal(state.tracks.length,1);
  $('speakerphone-tab').click();
  assert.equal(state.tracks[0].readyState,'ended');assert.equal($('mode-badge').textContent,'SPEAKERPHONE');
  assert.equal($('scenario-panel').hidden,true);assert.equal(win.document.body.classList.contains('copilot-hidden'),false);
});


test('Simulation offers interactive demo and Observe separately from Assisted/Blind Practice',async t=>{
  const {$,state,win,emit}=await mount(t);
  $('simulation-tab').click();
  assert.equal($('simulation-mode-label').hidden,false);
  assert.deepEqual([...$('simulation-mode').options].map(o=>o.value),['observe','demo']);
  $('simulation-mode').value='demo';$('simulation-mode').dispatchEvent(new win.Event('change'));
  assert.match($('start').textContent,/Start demo/);assert.match($('page-description').textContent,/cooperative AI/);
  assert.equal($('practice-mode-label').hidden,true);assert.equal($('difficulty-label').hidden,true);
  $('start').click();await tick();await finishBuyerPlayback(emit);
  assert.equal(state.lastConnection.trainingMode,'demo');assert.equal(state.tracks.length,1);
  assert.equal($('simulation-mode').disabled,true);
  repTurn(emit,'actual-demo','I wanted to see how this works.');await tick(220);
  $('start').click();assert.equal($('review').hidden,true,'Demo is not a practice assessment');
  $('practice-tab').click();assert.equal($('training-mode').value,'assisted');assert.equal($('difficulty-label').hidden,false);
  $('simulation-tab').click();assert.equal($('simulation-mode').value,'demo','Remember chosen demo');
});


test('Settings follows role and scenario; saved notes stay scoped and old global text is only reference', async t => {
  const { $, win, state } = await mount(t);
  $('settings-button').click();
  assert.match($('current-context').value,/Salesforce BDR/);
  assert.match($('current-context').value,/Target/);
  assert.equal($('context').value,'');
  assert.equal($('legacy-context').textContent,'Salesforce for retail');
  $('context').value='Only for this Target BDR setup';
  $('settings-form').dispatchEvent(new win.Event('submit',{cancelable:true})); await tick();
  $('role-ae').click(); $('settings-button').click();
  assert.match($('current-context').value,/Salesforce AE/);
  assert.match($('current-context').value,/scheduled discovery/i);
  assert.equal($('context').value,'');
  $('close-settings').click(); $('role-bdr').click();
  $('scenario-select').value='cedar-onboarding'; $('scenario-select').dispatchEvent(new win.Event('change'));
  $('settings-button').click();
  assert.match($('current-context').value,/Cedar/); assert.doesNotMatch($('current-context').value,/Target/);
  assert.equal($('context').value,'');
  $('close-settings').click();
  $('scenario-select').value='target-service'; $('scenario-select').dispatchEvent(new win.Event('change'));
  $('settings-button').click(); assert.equal($('context').value,'Only for this Target BDR setup');
  $('edit-company-settings').click(); assert.equal($('account-dialog').open,true);
  assert.equal($('account-size').closest('details').querySelector('summary').textContent,'Company details · employees, products & notes');
  assert.equal($('account-button').textContent,'Company & buyer');
  assert.equal(Object.keys(state.settings.contextNotes).length,1);
});

test('saved accounts appear in training selectors; selecting one supplies its own role-aware snapshot', async t => {
  const { $, win, state } = await mount(t);
  for(const company of ['First Account','Second Account']) {
    $('account-button').click(); $('new-account').click();
    for(const [key,value] of [['company',company],['person','Lee'],['size','1200']]){
      $('account-'+key).value=value; $('account-'+key).dispatchEvent(new win.Event('input'));
    }
    $('save-account').click(); await tick();
  }
  assert.equal($('scenario-select').options.length,2);
  $('scenario-select').value='saved:first account|lee'; $('scenario-select').dispatchEvent(new win.Event('change'));
  $('settings-button').click(); assert.match($('current-context').value,/First Account/); assert.doesNotMatch($('current-context').value,/Second Account/);
  $('close-settings').click(); $('role-ae').click(); $('start').click(); await tick();
  assert.equal(state.requests.at(-1).accountContext.company,'First Account');
  assert.match(state.requests.at(-1).accountContext.callType,/scheduled discovery/);
  assert.equal(state.lastConnection.accountContext.company,'First Account');
  $('start').click(); $('speakerphone-tab').click(); $('settings-button').click();
  assert.match($('current-context').value,/Company: Not specified/);
  assert.doesNotMatch($('current-context').value,/First Account|Second Account/);
});

test('research autofills supported empty fields in the draft, preserves manual values and saves field provenance',async t=>{
  const {$,win,state}=await mount(t);$('account-button').click();$('new-account').click();
  $('account-company').value='Example';$('account-company').dispatchEvent(new win.Event('input'));
  $('account-industry').value='My sector';$('account-industry').dispatchEvent(new win.Event('input'));
  $('research-account').click();await tick();
  state.resolveResearch({fields:[{field:'size',value:'About 1200 (2025)',source:'https://example.com/annual',sourceTitle:'Annual report',checkedAt:'2026-09-29'},{field:'industry',value:'Retail',source:'https://example.com/annual'}],entries:[],coverageGaps:['Earnings transcript unavailable.']});await tick();
  assert.equal($('account-size').value,'About 1200 (2025)');assert.equal($('account-industry').value,'My sector');
  assert.equal(state.settings.accountBrief,undefined,'Autofill is a draft until saved');
  assert.match($('account-status').textContent,/transcript unavailable/);$('save-account').click();await tick();
  assert.equal(state.settings.accountBrief.fieldSources.size.source,'https://example.com/annual');
  $('account-button').click();$('account-size').value='1300 (my correction)';$('account-size').dispatchEvent(new win.Event('input'));$('save-account').click();await tick();
  assert.equal(state.settings.accountBrief.fieldSources.size,undefined,'Manual correction loses public provenance');
});

test('call lifecycle enables the simplified layout and restores setup after ending without an extra setup button',async t=>{
 const {$,win}=await mount(t);assert.equal($('call-setup'),null);assert.equal(win.document.body.classList.contains('in-call'),false);
 $('start').click();await tick();assert.equal(win.document.body.classList.contains('in-call'),true);
 $('start').click();assert.equal(win.document.body.classList.contains('in-call'),false);
});

test('compact pre-call name shares Settings identity, saves before starting and hides throughout a call',async t=>{
  const {$,state,win}=await mount(t);
  assert.equal($('rep-name-control').hidden,false);
  $('quick-rep-name').value='Avery';
  $('start').click(); await tick();
  assert.equal(state.nameSaved,'Avery');
  assert.equal($('rep-name-control').hidden,true);
  assert.equal(state.connects,1);
  $('start').click();assert.equal($('rep-name-control').hidden,false);
  $('settings-button').click();assert.equal($('rep-name').value,'Avery');
  $('rep-name').value='Jordan';
  $('settings-form').dispatchEvent(new win.Event('submit',{cancelable:true}));await tick();
  assert.equal($('quick-rep-name').value,'Jordan');
  $('speakerphone-tab').click();$('start').click();await tick();
  assert.equal($('rep-name-control').hidden,true);
  $('start').click();$('quick-rep-name').value=' ';
  $('start').click();await tick();
  assert.equal(state.connects,2,'Blank name cannot start with someone else’s identity');
  assert.match($('error-text').textContent,/Enter your name/);
});

test('account product hypothesis remains visible in a call and can change or be removed by current buyer evidence',async t=>{
  const {$,state,coach}=await mount(t,{holdFocus:true});
  assert.equal(state.focusRequests.length,1);
  state.focusResolvers[0]({product_id:'sf-25',product:'MuleSoft Anypoint Platform',motion:'undetermined',reason:'Investigate context handoffs.',validate:'Confirm current tools.',url:'https://www.salesforce.com/mulesoft/'});
  await tick();
  assert.equal($('product-focus-name').textContent,'MuleSoft Anypoint Platform');
  assert.match($('product-focus-label').textContent,/validate ownership/);
  $('product-focus').click();assert.match($('support-content').textContent,/working hypothesis/);$('close-support').click();
  $('start').click();await tick();
  assert.equal($('product-focus').closest('.readiness-panel').hidden,false);
  assert.equal(state.focusRequests.length,1,'No extra per-turn product API request');
  assert.equal(state.requests.at(-1).opportunityMemory.focus.product_id,'sf-25');
  const id=state.requests.at(-1).id;
  coach({type:'opportunity',id,opportunity:{pains:[],fit:null,focus:{product:'Service Cloud',motion:'optimize',reason:'Improve existing service configuration.',validate:'Current setup.'}}});
  assert.equal($('product-focus-name').textContent,'Service Cloud');
  assert.match($('product-focus-label').textContent,/Optimize existing/);
  coach({type:'opportunity',id:'stale',opportunity:{pains:[],fit:null,focus:{product:'Stale product'}}});
  assert.equal($('product-focus-name').textContent,'Service Cloud');
  coach({type:'opportunity',id,opportunity:{pains:[],fit:null,focus:{product:'',motion:'none',reason:'No unmet need.',validate:'No next step needed.'}}});
  assert.equal($('product-focus-name').textContent,'No clear product fit yet');
});

test('late pre-call assessment cannot overwrite in-call focus and switching accounts clears old focus',async t=>{
  const {$,state,coach,win}=await mount(t,{holdFocus:true});
  $('start').click();await tick();
  const id=state.requests.at(-1).id;
  coach({type:'opportunity',id,opportunity:{pains:[],fit:null,focus:{product:'Agentforce',motion:'expand',reason:'New spoken need.',validate:'Scope.'}}});
  state.focusResolvers[0]({product:'MuleSoft',motion:'undetermined',reason:'Earlier account guess.',validate:'Stack.'});await tick();
  assert.equal($('product-focus-name').textContent,'Agentforce');
  $('start').click();
  $('scenario-select').value='cedar-onboarding';$('scenario-select').dispatchEvent(new win.Event('change'));
  assert.equal($('product-focus-name').textContent,'Assessing account…');
  assert.equal(state.focusRequests.at(-1).scenarioId,'cedar-onboarding');
  state.focusResolvers.at(-1)(null);await tick();
  assert.equal($('product-focus-name').textContent,'No clear product fit yet');
});

test('live name-only research starts automatically, while research cannot alter an active call snapshot',async t=>{
  const {$,state,win}=await mount(t);
  $('speakerphone-tab').click();
  $('live-company').value='Independent Manufacturing';$('live-company').dispatchEvent(new win.Event('input'));$('live-company').dispatchEvent(new win.Event('change'));await tick();
  assert.equal(state.researchPayload.company,'Independent Manufacturing');
  $('start').click();await tick();
  assert.equal(state.requests.at(-1).accountContext.company,'Independent Manufacturing');
  assert.equal(state.requests.at(-1).accountContext.products,'');
  state.resolveResearch({fields:[{field:'size',value:'1200 (2025)',source:'https://example.com/report',sourceTitle:'Report',evidence:'1200 employees',checkedAt:'2026-09-30'}],entries:[{id:'finding',kind:'hypothesis',purpose:'pain',text:'Possible quote delays.'}]});await tick();
  assert.equal($('live-review-research').hidden,false);
  $('refresh').click();await tick(150);
  assert.equal(state.requests.at(-1).accountContext.size,'','Background research stays a draft');
  $('start').click();$('live-review-research').click();
  $('research-results').querySelector('.primary-button').click();$('save-account').click();await tick();
  $('start').click();await tick();assert.equal(state.requests.at(-1).accountContext.size,'1200 (2025)');
});

test('Speakerphone can run without a brief and does not inherit the selected learning customer',async t=>{
  const {$,state,win}=await mount(t);
  $('account-button').click();$('new-account').click();$('account-company').value='Learning Account';$('account-company').dispatchEvent(new win.Event('input'));$('save-account').click();await tick();
  $('speakerphone-tab').click();$('start').click();await tick();
  assert.equal(state.requests.at(-1).accountContext,null);assert.equal(state.requests.at(-1).scenarioId,undefined);
  $('start').click();$('live-company').value='Learning Account';$('live-company').dispatchEvent(new win.Event('input'));$('live-company').dispatchEvent(new win.Event('change'));await tick();
  $('start').click();await tick();assert.equal(state.requests.at(-1).accountContext.company,'Learning Account');
  $('start').click();$('live-clear').click();$('start').click();await tick();assert.equal(state.requests.at(-1).accountContext,null);
});

test('audio speaker evidence is live-only, refreshes current coaching and is cleared on a new call',async t=>{
  const {$,state,emit}=await mount(t);
  $('speakerphone-tab').click();$('start').click();await tick();
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'turn-a',transcript:'Our renewals need attention.'});await tick(150);
  emit({type:'speaker.evidence',evidence:{clipId:1,segments:[{voice:'B',text:'Our renewals need attention.',start:1,end:3}]}});await tick();
  assert.equal(state.requests.at(-1).audioSpeakerEvidence.segments[0].voice,'B');
  $('start').click();$('start').click();await tick();assert.equal(state.requests.at(-1).audioSpeakerEvidence,null);
});


test('renderer: locked saved credential shows recovery, keeps Remember checked, never asks for a new key',async t=>{
  const {$,state}=await mount(t,{hasKey:false,saved:true,keyStorageState:'locked'});
  $('settings-button').click();assert.equal($('retry-saved-key').hidden,false);assert.equal($('remember-key').checked,true);
  assert.match($('api-key').placeholder,/leave blank to keep/);assert.equal($('api-key').value,'');
  $('retry-saved-key').click();await tick();assert.equal(state.retries,1);assert.equal($('retry-saved-key').hidden,true);
  assert.match($('key-help').textContent,/unlocked/);assert.equal($('api-key').value,'');
});
test('renderer: a saved key is restored before starting without reopening key entry',async t=>{
  const {$,state}=await mount(t,{hasKey:false,saved:true,keyStorageState:'locked'});
  $('start').click();await tick();assert.equal(state.retries,1);assert.equal(state.connects,1);assert.equal($('settings-dialog').open,false);
});
test('renderer: failed saved-key recovery keeps settings recoverable and does not start capture',async t=>{
  const {$,state}=await mount(t,{hasKey:false,saved:true,keyStorageState:'locked',retryKeyFails:true});
  $('start').click();await tick();assert.equal(state.connects,0);assert.equal(state.tracks.length,0);assert.equal($('settings-dialog').open,true);assert.equal($('remember-key').checked,true);
  assert.match($('settings-error').textContent,/Keychain is unavailable/);
});


test('a saved named product hypothesis stays visible while pre-call assessment loads, but explicit no-fit removes it',async t=>{
  const account={company:'Sample Retail',person:'Alex',entries:[{id:'p',purpose:'product',productName:'Agentforce — expand existing use',kind:'hypothesis',text:'Explore extending the existing service automation.'}]};
  const {$,state}=await mount(t,{initialAccount:account,holdFocus:true});
  assert.equal($('product-focus-name').textContent,'Agentforce — expand existing use');
  assert.match($('product-focus-label').textContent,/from brief/);
  state.focusResolvers[0](null);await tick();assert.equal($('product-focus-name').textContent,'No clear product fit yet');
});


test('speakerphone preserves a complete line through rep speech, fragments, and voice rechecks, then honors the completed seller HOLD',async t=>{
  const {$,state,emit,coach}=await mount(t);
  $('speakerphone-tab').click();$('start').click();await tick();
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'buyer-q',transcript:'How would this help with the manual checks?'});await tick(150);
  const id=state.requests.at(-1).id,line='We could look at which checks can be automated within your existing setup.';
  coach({type:'delta',id,text:line});coach({type:'done',id});
  emit({type:'input_audio_buffer.speech_started',item_id:'rep-answer'});
  emit({type:'conversation.item.input_audio_transcription.delta',item_id:'rep-answer',delta:'We could look at which checks'});
  emit({type:'speaker.evidence',evidence:{clipId:4,segments:[]}});await tick();
  assert.equal($('suggestion').textContent,line);assert.equal($('suggestion-label').textContent,'SAY');
  assert.equal(state.requests.at(-1).id,id,'No coaching over an unfinished newer turn');
  emit({type:'input_audio_buffer.speech_stopped',item_id:'rep-answer'});
  assert.equal($('suggestion').textContent,line);
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'rep-answer',transcript:line});await tick(150);
  assert.equal($('suggestion').textContent,line,'Keep words available during analysis, not a loading replacement');
  const fresh=state.requests.at(-1).id;
  coach({type:'roles',id:fresh,roles:[{id:'rep-answer',speaker:'seller'}]});coach({type:'hold',id:fresh,reason:'wait'});coach({type:'done',id:fresh});
  assert.equal($('suggestion-label').textContent,'HOLD');assert.match($('suggestion').textContent,/Let the client respond/);
});
test('a retained live line gives way to a fresh buyer-aware recommendation, with no old output revival',async t=>{
  const {$,state,emit,coach}=await mount(t);$('speakerphone-tab').click();$('start').click();await tick();
  let id=state.requests.at(-1).id;coach({type:'delta',id,text:'A useful first line.'});coach({type:'done',id});
  emit({type:'input_audio_buffer.speech_started',item_id:'buyer-change'});
  assert.equal($('suggestion').textContent,'A useful first line.');
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'buyer-change',transcript:'Actually, we already solved that.'});await tick(150);
  const fresh=state.requests.at(-1).id;coach({type:'roles',id:fresh,roles:[{id:'buyer-change',speaker:'buyer'}]});coach({type:'delta',id:fresh,text:'What changed in the process?'});coach({type:'done',id:fresh});
  coach({type:'delta',id,text:'Late stale advice.'});assert.equal($('suggestion').textContent,'What changed in the process?');
  $('start').click();$('start').click();await tick();assert.doesNotMatch($('suggestion').textContent,/What changed|Late stale/);
});

test('Mac call capture is opt-in before a live call, sends the mixed audio only, and mute/pause/stop cover both sources',async t=>{
  const {$,state,win}=await mount(t);
  $('speakerphone-tab').click();assert.equal($('live-audio-source').value,'room');assert.equal($('mac-call-guide').hidden,true);
  $('live-audio-source').value='mac-call';$('live-audio-source').dispatchEvent(new win.Event('change'));
  assert.equal($('mac-call-guide').hidden,false);assert.match($('page-description').textContent,/call on your Mac/);
  $('mac-call-instructions').click();await tick();assert.equal(state.openedSource,'https://support.apple.com/en-us/102405');
  $('start').click();await tick(100);
  assert.equal(state.displayCaptures,1);assert.equal(state.sentAudioTrack,state.directOutput);
  assert.equal(state.directVideo.readyState,'ended');assert.equal($('live-audio-source').disabled,true);
  assert.equal($('direct-audio-levels').hidden,false);assert.equal(win.document.body.classList.contains('in-call'),true);
  $('mute').click();assert.equal(state.directSource.enabled,false);assert.equal(state.tracks[0].enabled,false);assert.equal(state.directOutput.enabled,false);
  $('mute').click();assert.equal(state.directSource.enabled,true);
  $('pause').click();assert.equal(state.directSource.enabled,false);assert.equal(state.tracks[0].enabled,false);
  $('pause').click();assert.equal(state.directSource.enabled,true);
  $('start').click();assert.equal(state.directSource.readyState,'ended');assert.equal(state.directOutput.readyState,'ended');
  assert.equal($('direct-audio-levels').hidden,true);assert.equal($('live-audio-source').disabled,false);
});

test('practice never requests Mac call capture even if that option was previously selected for Speakerphone',async t=>{
  const {$,state}=await mount(t);$('speakerphone-tab').click();$('live-audio-source').value='mac-call';
  $('practice-tab').click();$('start').click();await tick();assert.equal(state.displayCaptures,undefined);assert.equal($('direct-audio-levels').hidden,true);
});

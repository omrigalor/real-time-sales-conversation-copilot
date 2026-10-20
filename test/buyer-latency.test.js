import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceSession } from '../app/session.js';
import { sessionConfig } from '../api.js';

function setup(t, mode = 'simulation') {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const sent = [], events = [];
  const session = new VoiceSession({ mode, bridge: {}, onEvent: e => events.push(e), onStatus() {}, onError: assert.fail, onLevel() {} });
  session.channel = { readyState: 'open', send: raw => sent.push(JSON.parse(raw)), close() {} };
  session.playbackBlocked = false;session.buyerInstructions=sessionConfig('simulation').instructions;
  t.after(() => session.stop());
  const input = (type, extra = {}, id = 'rep') => session.handleInput({ type, item_id: id, ...extra });
  const responses = () => sent.filter(e => e.type === 'response.create');
  return { session, sent, events, input, responses };
}

test('completed native audio with positive streaming speech starts before final transcription, exactly once', t => {
  const { session, input, responses } = setup(t);
  input('input_audio_buffer.speech_started');
  input('conversation.item.input_audio_transcription.delta', { delta: 'Could we look at the handoff?' });
  t.mock.timers.tick(1000);
  assert.equal(responses().length, 0, 'Streaming words do not end a turn');
  input('input_audio_buffer.speech_stopped');
  t.mock.timers.tick(1000);
  assert.equal(responses().length, 0, 'Wait for committed audio');
  input('input_audio_buffer.committed');
  t.mock.timers.tick(1);
  assert.equal(responses().length, 1, 'No need for the separate final transcript');
  assert.equal(session.submittedInputs.get('rep').final, false);
  t.mock.timers.tick(1000);
  assert.equal(input('conversation.item.input_audio_transcription.completed', { transcript: 'Could we look at that handoff?' }), true);
  assert.equal(session.submittedInputs.get('rep').text, 'Could we look at that handoff?');
  t.mock.timers.tick(1000);
  assert.equal(responses().length, 1, 'Late correction cannot authorize another reply');
});

test('fast path retains semantic completion, resumed speech, local speech and pause protections', t => {
  const { session, input, responses } = setup(t);
  input('input_audio_buffer.speech_started');
  input('conversation.item.input_audio_transcription.delta', { delta: 'Hello there.' });
  input('input_audio_buffer.speech_stopped'); input('input_audio_buffer.committed');
  t.mock.timers.tick(100);
  input('input_audio_buffer.speech_started', {}, 'continuation');
  t.mock.timers.tick(1000); assert.equal(responses().length, 0);
  input('conversation.item.input_audio_transcription.delta', { delta: 'One more thing.' }, 'continuation');
  input('input_audio_buffer.speech_stopped', {}, 'continuation');
  input('input_audio_buffer.committed', {}, 'continuation');
  session.lastLocalSpeechAt = Date.now();
  session.scheduleReply();
  t.mock.timers.tick(175); assert.equal(responses().length, 0);
  session.setPaused(true); t.mock.timers.tick(1000); assert.equal(responses().length, 0);
  session.setPaused(false); t.mock.timers.tick(1); assert.equal(responses().length, 1);
  assert.equal(sessionConfig('simulation').audio.input.turn_detection.eagerness, 'medium');
});

test('noise, filler and an empty final correction before submission do not trigger buyer speech', t => {
  const { input, responses } = setup(t);
  for (const [id, text] of [['noise', ''], ['filler', 'Um...'], ['corrected', 'Hi']]) {
    input('input_audio_buffer.speech_started', {}, id);
    input('input_audio_buffer.speech_stopped', { audio_end_ms: 5000 }, id);
    input('input_audio_buffer.committed', {}, id);
    input('conversation.item.input_audio_transcription.delta', { delta: text }, id);
    if (id === 'corrected') input('conversation.item.input_audio_transcription.completed', { transcript: '' }, id);
    t.mock.timers.tick(1000);
  }
  assert.equal(responses().length, 0);
});

test('silent state bookkeeping continues without an echo delay and retains full request-to-audio timing', t => {
  const { session, responses, events } = setup(t);
  session.repStoppedAt = Date.now(); session.repLocalEndedAt = Date.now() - 500;
  session.inputTurns.set('caller',{text:'Hello',stopped:true,committed:true,final:true,usable:true});
  session.requestBuyer();
  session.handlePlayback({ type: 'response.created', response: { id: 'state' } });
  t.mock.timers.tick(400);
  session.handlePlayback({ type: 'response.done', response: { id: 'state', status: 'completed', output: [
    { type: 'function_call', name: 'update_buyer_state', call_id: 'state-call', arguments: '{"engagement":"interested","ended":false}' },
  ] } });
  assert.equal(responses().length, 2, 'Immediate continuation, not the 220ms room-echo timer');
  assert.equal(responses()[1].response.tool_choice, 'none');
  assert.equal(session.playbackBlocked, true);
  assert.equal(session.buyerState.engagement, 'interested');
  session.handlePlayback({ type: 'response.created', response: { id: 'audio' } });
  t.mock.timers.tick(600);
  session.handlePlayback({ type: 'output_audio_buffer.started', response_id: 'audio' });
  const timing = events.find(e => e.type === 'voice.timing').timing;
  assert.equal(timing.requestToAudioMs, 1000, 'Include the state round trip, not only the final audio request');
  assert.equal(timing.lastRequestToAudioMs, 600);
  assert.equal(timing.estimatedSpeechToAudioMs, 1500);
  session.handlePlayback({ type: 'response.done', response: { id: 'audio', status: 'completed', output: [{ content: [{ type: 'audio' }] }] } });
  session.handlePlayback({ type: 'output_audio_buffer.stopped', response_id: 'audio' });
  t.mock.timers.tick(219); assert.equal(session.playbackBlocked, true, 'Real audio retains echo protection');
  t.mock.timers.tick(1); assert.equal(session.playbackBlocked, false);
});

test('latency optimization cannot generate a buyer in Speakerphone', t => {
  const { input, responses, session } = setup(t, 'speakerphone');
  input('input_audio_buffer.speech_started');
  input('input_audio_buffer.speech_stopped'); input('input_audio_buffer.committed');
  input('conversation.item.input_audio_transcription.delta', { delta: 'Hello.' });
  t.mock.timers.tick(10000); session.requestBuyer();
  assert.equal(responses().length, 0);
});

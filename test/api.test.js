import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionConfig, coachingRequest, connectOpenAI, sseEvents, streamCoach } from '../api.js';
import { Transcript } from '../app/state.js';

test('simulation uses explicit interruption to protect against echo; speakerphone cannot generate speech', () => {
  const sim = sessionConfig('simulation', 'CRM for retail');
  assert.deepEqual(sim.output_modalities, ['audio']);
  assert.deepEqual(sim.audio.input.turn_detection, { type: 'semantic_vad', eagerness: 'medium', create_response: false, interrupt_response: false });
  assert.equal(sim.audio.output.voice, 'marin');
  const speaker = sessionConfig('speakerphone');
  assert.equal(speaker.type, 'transcription');
  assert.equal(speaker.audio.output, undefined);
  assert.equal(speaker.instructions, undefined);
  assert.throws(() => sessionConfig('zoom'));
});
test('speakerphone handshake uses a transcription-scoped token; keys do not enter SDP', async () => {
  const calls = [];
  const answer = await connectOpenAI({ key: 'secret-permanent', mode: 'speakerphone', sdp: 'v=0\r\n', fetcher: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json({ value: 'secret-ephemeral' }) : new Response('v=0\r\nanswer');
  } });
  assert.equal(answer, 'v=0\r\nanswer');
  assert.equal(JSON.parse(calls[0].options.body).session.type, 'transcription');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer secret-ephemeral');
  assert.equal(calls[1].options.body, 'v=0\r\n');
});
test('simulation handshake posts multipart configuration once', async () => {
  let count = 0;
  await connectOpenAI({ key: 'secret', mode: 'simulation', sdp: 'v=0\r\n', fetcher: async (_url, options) => {
    count++;
    assert.equal(JSON.parse(options.body.get('session')).type, 'realtime');
    assert.equal(JSON.parse(options.body.get('session')).max_output_tokens, undefined, 'Voice replies use the API default budget, not the short text-coaching budget');
    assert.equal(options.body.get('sdp'), 'v=0\r\n');
    return new Response('v=0\r\nanswer');
  } });
  assert.equal(count, 1);
});
test('authentication and usage failures are actionable', async () => {
  for (const [status, pattern] of [[401, /replace it/], [429, /billing/], [403, /permissions/]]) {
    await assert.rejects(connectOpenAI({ key: 'x', mode: 'simulation', sdp: 'v=0', fetcher: async () => Response.json({ error: { message: 'upstream detail' } }, { status }) }), pattern);
  }
});
test('coaching uses only bounded conversation data and no provider storage', () => {
  const request = coachingRequest({ mode: 'speakerphone', turns: Array.from({ length: 100 }, (_, i) => ({ speaker: 'unknown', text: `Line ${i}` })) });
  assert.equal(request.store, false);
  assert.equal(JSON.parse(request.input).transcript.length, 60);
  assert.equal(JSON.parse(request.input).transcript[0].speaker, 'unassigned');
});
function chunks(text, size = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size)); controller.close(); } });
}
test('stream decoder handles UTF-8, CRLF, keepalives, and arbitrary byte boundaries', async () => {
  const events = [];
  for await (const e of sseEvents(chunks(': ping\r\n\r\nevent: test\r\ndata: {"text":"Let’s talk ☀"}\r\n\r\ndata: [DONE]\r\n\r\n'))) events.push(e);
  assert.deepEqual(events, [{ text: 'Let’s talk ☀' }]);
});
test('streamed coaching accumulates text and rejects an interrupted success-looking stream', async () => {
  const metadata = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '{"roles":[],"for":"seller","action":"suggest"}\n' })}\n\n`;
  const stream = metadata + 'data: {"type":"response.output_text.delta","delta":"How "}\n\ndata: {"type":"response.output_text.delta","delta":"does that work?"}\n\n';
  const deltas = [];
  const args = { key: 'x', payload: { mode: 'simulation' }, onDelta: text => deltas.push(text) };
  const result = await streamCoach({ ...args, fetcher: async () => new Response(chunks(stream + 'data: {"type":"response.completed"}\n\n')) });
  assert.equal(result, 'How does that work?');
  assert.deepEqual(deltas, ['How ', 'How does that work?']);
  await assert.rejects(streamCoach({ ...args, fetcher: async () => new Response(chunks(stream)) }), /did not finish/);
});
test('transcript keeps spoken order despite late input transcription and deduplicates finals', () => {
  const t = new Transcript();
  t.reserve('input-1', 'seller'); t.reserve('output-1', 'buyer');
  t.complete('output-1', 'buyer', 'We use spreadsheets.');
  t.complete('input-1', 'seller', 'What are you using today?');
  t.complete('input-1', 'seller', 'What are you using today?');
  assert.deepEqual(t.snapshot().map(t => t.speaker), ['seller', 'buyer']);
  assert.equal(t.rows.length, 2);
  t.delta('output-1', 'buyer', 'duplicate late delta');
  assert.equal(t.rows[1].text, 'We use spreadsheets.');
});
test('manual speaker corrections persist when a final transcript arrives', () => {
  const t = new Transcript(); t.delta('a', 'unassigned', 'Hi'); t.label('a', 'seller');
  t.complete('a', 'unassigned', 'Hi, this is Sam.');
  assert.equal(t.snapshot()[0].speaker, 'seller');
});
test('interruption is final even when generated transcript events arrive after playback stops', () => {
  const t = new Transcript();
  t.delta('buyer', 'buyer', 'The part you heard.');
  t.interrupt('buyer');
  t.complete('buyer', 'buyer', 'The full answer including words that were never played.');
  t.delta('buyer', 'buyer', 'More unplayed words.');
  assert.equal(t.rows[0].text, '[Buyer interrupted]');
  assert.equal(t.rows[0].interrupted, true);
});

test('SSE completion is recognized even without a trailing blank line', async () => {
  const events = [];
  for await (const event of sseEvents(chunks('data: {"type":"response.completed"}'))) events.push(event);
  assert.equal(events[0].type, 'response.completed');
});

test('missing rep sentence retries once with a compact response instead of leaving the preparing placeholder', async () => {
  let calls = 0; const holds = [], deltas = [];
  const payload = { mode: 'simulation', turns: [{ id: 'b', speaker: 'buyer', speakerSource: 'native', text: 'What gap would you help us address?' }] };
  const result = await streamCoach({ key: 'test', payload, onDelta: text => deltas.push(text), onHold: reason => holds.push(reason), fetcher: async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    if (calls === 2) { assert.match(request.instructions, /RECOVERY OUTPUT/); assert.equal(request.max_output_tokens, 900); }
    const text = calls === 1 ? '{"roles":[],"for":"seller","action":"suggest","progress":{"score":20,"stage":"discovery","reason":"Buyer asks about value"}}\n' : '{"roles":[],"for":"seller","action":"suggest"}\nWhere is your current setup falling short?';
    return new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: {"type":"response.completed"}`);
  } });
  assert.equal(calls, 2); assert.deepEqual(holds, ['retrying']);
  assert.equal(result, 'Where is your current setup falling short?');
  assert.equal(deltas.at(-1), result);
});

test('terminal response text fills in missing incremental text without duplicating the sentence', async () => {
  const header = '{"roles":[],"for":"seller","action":"suggest"}\n';
  const events = [{ type: 'response.output_text.delta', delta: header }, { type: 'response.completed', response: { output: [{ content: [{ type: 'output_text', text: header + 'What is driving the extra work?' }] }] } }];
  const deltas = [];
  const result = await streamCoach({ key: 'test', payload: { mode: 'simulation' }, onDelta: text => deltas.push(text), fetcher: async () => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')) });
  assert.equal(result, 'What is driving the extra work?'); assert.deepEqual(deltas, [result]);
});

test('broken secondary insights do not discard a valid rep suggestion', async () => {
  let calls = 0;
  const text = '{"roles":[],"for":"seller","action":"suggest"}\nWhich handoff causes the delay?\n{"opportunity":';
  const result = await streamCoach({ key: 'test', payload: { mode: 'simulation' }, onDelta() {}, fetcher: async () => { calls++; return new Response(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: {"type":"response.completed"}\n\n`); } });
  assert.equal(result, 'Which handoff causes the delay?'); assert.equal(calls, 1);
});


test('live two-person transcription has its own model and sensitive far-field boundary profile without changing practice',()=>{
  const live=sessionConfig('speakerphone').audio.input,practice=sessionConfig('simulation').audio.input;
  assert.equal(live.transcription.model,'gpt-4o-transcribe');assert.equal(practice.transcription.model,'gpt-4o-mini-transcribe');
  assert.equal(live.noise_reduction.type,'far_field');
  assert.ok(live.turn_detection.threshold<0.5 && live.turn_detection.threshold>0);
  assert.ok(live.turn_detection.prefix_padding_ms>=500);assert.ok(live.turn_detection.silence_duration_ms>=600);
  assert.equal(practice.turn_detection.type,'semantic_vad');
  assert.equal(sessionConfig('speakerphone').output_modalities,undefined);
});

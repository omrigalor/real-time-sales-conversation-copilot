import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachOutput, spokenLine } from '../coach-output.js';
import { streamCoach } from '../api.js';
import { Transcript } from '../app/state.js';

const turn = (id, speakerSource = 'unknown') => ({ id, speaker: 'unassigned', speakerSource, text: 'Example turn' });

test('streaming speaker labels and quote wrappers never appear as suggested speech', () => {
  for (const mode of ['simulation', 'speakerphone']) {
    for (const [repName, raw, expected] of [
      ['Omri', 'Omri: "Hi Mark, this is Omri from Salesforce."', 'Hi Mark, this is Omri from Salesforce.'],
      ['A.J. Reed', 'A.J. Reed: “Hi, this is A.J. Reed.”', 'Hi, this is A.J. Reed.'],
      ['Élodie Martin', '**Élodie:** "What prompted the conversation?"', 'What prompted the conversation?'],
      ['Omri', 'Salesforce rep: "That makes sense."', 'That makes sense.'],
      ['Omri', '"Hi Mark, this is Omri."', 'Hi Mark, this is Omri.']
    ]) {
      const updates = [];
      const output = new CoachOutput({ mode, repName, turns: [{ ...turn('b', 'native'), speaker: 'buyer' }], onDelta: text => updates.push(text) });
      output.append('{"roles":[],"for":"seller","action":"suggest"}\n');
      for (const character of raw) output.append(character);
      output.finish();
      assert.equal(output.text, expected);
      assert.ok(updates.every(text => expected.startsWith(text)), JSON.stringify(updates));
    }
  }
});

test('format cleanup preserves spoken names, meaningful colons and quotations inside dialogue', () => {
  for (const text of ['Hi Mark, this is Omri from Salesforce.', 'One thing matters: whether it helps.', 'You mentioned "too much work".']) {
    assert.equal(spokenLine(text, 'Omri'), text);
  }
  assert.equal(spokenLine('"Service Cloud" is the product name.', 'Omri'), '"Service Cloud" is the product name.');
  assert.equal(spokenLine('Mark: that is the contact name.', 'Omri'), 'Mark: that is the contact name.');
});

test('speaker analysis is hidden even when JSON and newline arrive one character at a time', () => {
  const updates = [], roles = [];
  const output = new CoachOutput({ mode: 'speakerphone', turns: [turn('a'), turn('b')], onDelta: text => updates.push(text), onRoles: data => roles.push(...data) });
  for (const char of '{"for":"seller","action":"suggest","roles":[[0,"seller",0.99],[1,"buyer",0.96]]}\nWhat would make switching worthwhile?') output.append(char);
  assert.deepEqual(roles, [{ id: 'a', speaker: 'seller' }, { id: 'b', speaker: 'buyer' }]);
  assert.equal(output.text, 'What would make switching worthwhile?');
  assert.ok(updates.every(text => !/[{}\[\]]/.test(text)));
});

test('unreliable roles, older turns and protected labels cannot overwrite transcript attribution', () => {
  let result;
  const turns = Array.from({ length: 10 }, (_, i) => turn(String(i)));
  turns[2].speakerSource = 'manual'; turns[3].speakerSource = 'native';
  const output = new CoachOutput({ mode: 'speakerphone', turns, onDelta() {}, onRoles: roles => { result = roles; } });
  output.append('{"for":"seller","action":"suggest","roles":[[0,"buyer",1],[2,"buyer",1],[3,"seller",1],[4,"buyer",0.5],[5,"alien",1],[6,"seller",2],[8,"buyer",0.99],[9,"unassigned",0.2]]}\nLet them answer.');
  assert.deepEqual(result, [{ id: '8', speaker: 'buyer' }, { id: '9', speaker: 'unassigned' }]);
});

test('manual corrections made during inference win; inferred roles can be revised', () => {
  const transcript = new Transcript();
  transcript.complete('a', 'unassigned', 'We already use Salesforce.');
  transcript.infer([{ id: 'a', speaker: 'seller' }]);
  transcript.infer([{ id: 'a', speaker: 'buyer' }]);
  assert.equal(transcript.snapshot()[0].speaker, 'buyer');
  transcript.label('a', 'seller');
  transcript.infer([{ id: 'a', speaker: 'buyer' }]);
  assert.equal(transcript.snapshot()[0].speaker, 'seller');
  assert.equal(transcript.snapshot()[0].speakerSource, 'manual');
  transcript.complete('b', 'buyer', 'Native simulation buyer.');
  transcript.infer([{ id: 'b', speaker: 'seller' }]);
  assert.equal(transcript.snapshot()[1].speaker, 'buyer');
});

test('invalid or missing classification header cannot leak into the coaching card', () => {
  for (const header of ['null', '{}', 'Here is what the buyer should say:', '```json']) {
    const updates = [];
    const output = new CoachOutput({ mode: 'speakerphone', turns: [], onDelta: text => updates.push(text) });
    assert.throws(() => output.append(header + '\nSome text'), /Speaker analysis/);
    assert.deepEqual(updates, []);
  }
});

test('speakerphone API stream delivers role hints and only spoken rep text across event boundaries', async () => {
  const events = [
    { type: 'response.output_text.delta', delta: '{"for":"seller","action":"suggest","roles":[[0,"buyer",0.99]]}' },
    { type: 'response.output_text.delta', delta: '\nWhich part ' },
    { type: 'response.output_text.delta', delta: 'is working well?' },
    { type: 'response.completed' },
  ];
  const updates = [], roles = [];
  const result = await streamCoach({ key: 'test', payload: { mode: 'speakerphone', turns: [turn('client')] }, onDelta: text => updates.push(text), onRoles: hints => roles.push(...hints), fetcher: async () => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')) });
  assert.equal(result, 'Which part is working well?');
  assert.deepEqual(updates, ['Which part ', result]);
  assert.deepEqual(roles, [{ id: 'client', speaker: 'buyer' }]);
});

test('rep questions and pitches cannot release a client answer even when the model proposes one', () => {
  for (const text of ['How do you handle returns?', 'Salesforce can help with those handoffs.']) {
    for (const source of ['manual', 'native', 'unknown']) {
      const updates = [], holds = [];
      const output = new CoachOutput({ mode: 'speakerphone', turns: [{ id: 'rep', text, speaker: source === 'unknown' ? 'unassigned' : 'seller', speakerSource: source }], onDelta: value => updates.push(value), onHold: reason => holds.push(reason) });
      const role = source === 'unknown' ? 'seller' : 'buyer'; // Try to override a protected rep label.
      output.append(JSON.stringify({ roles: [[0, role, 0.99]], for: 'seller', action: 'suggest' }) + '\nWe manage returns in a spreadsheet.');
      output.append('Can you tell me more about your product?');
      assert.deepEqual(updates, []);
      assert.deepEqual(holds, ['wait']);
    }
  }
});

test('ambiguous, mixed and weakly classified turns do not generate either side of the dialogue', () => {
  for (const roles of [[], [[0, 'unassigned', 1]], [[0, 'buyer', 0.89]]]) {
    const updates = [], holds = [];
    const output = new CoachOutput({ mode: 'speakerphone', turns: [turn('a')], onDelta: value => updates.push(value), onHold: reason => holds.push(reason) });
    output.append(JSON.stringify({ roles, for: 'seller', action: 'suggest' }) + '\nInvented answer');
    assert.deepEqual(updates, []); assert.deepEqual(holds, ['uncertain']);
  }
});

test('an explicit buyer-targeted suggestion is blocked in both modes', () => {
  for (const mode of ['simulation', 'speakerphone']) {
    const updates = [];
    const output = new CoachOutput({ mode, turns: [{ ...turn('a', 'native'), speaker: 'buyer' }], onDelta: value => updates.push(value) });
    output.append('{"roles":[],"for":"buyer","action":"suggest"}\nWe are interested in buying Salesforce.');
    assert.equal(output.held, true); assert.deepEqual(updates, []);
  }
});

test('manual rep turns can update insights while their proposed client answer is blocked', async () => {
  let fetched = false, hold;
  const events = [{ type: 'response.output_text.delta', delta: '{"roles":[[0,"buyer",1]],"for":"seller","action":"suggest"}\nA client answer' }, { type: 'response.completed' }];
  await streamCoach({ key: 'test', payload: { mode: 'speakerphone', turns: [{ ...turn('a', 'manual'), speaker: 'seller' }] }, onDelta() { assert.fail('No spoken line is allowed'); }, onHold: reason => { hold = reason; }, fetcher: async () => { fetched = true; return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')); } });
  assert.equal(hold, 'wait'); assert.equal(fetched, true);
});

test('wait response ending at the JSON header still updates readiness without leaking metadata', async () => {
  const metadata = { roles: [[0, 'seller', 1]], for: 'seller', action: 'wait', progress: { score: 30, stage: 'discovery', reason: 'Need identified; impact still unclear.' } };
  const events = [{ type: 'response.output_text.delta', delta: JSON.stringify(metadata) }, { type: 'response.completed' }];
  let progress, held;
  await streamCoach({ key: 'test', payload: { mode: 'speakerphone', turns: [turn('a')] }, onDelta() { assert.fail('No spoken line while waiting'); }, onHold: reason => { held = reason; }, onProgress: value => { progress = value; }, fetcher: async () => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')) });
  assert.equal(held, 'wait'); assert.equal(progress.score, 30);
});

test('selected cold opening is constant with the saved name and cannot accumulate generated research prose',()=>{
  for(const mode of ['simulation','speakerphone'])for(const repName of ['Omri','Alex']){
    const updates=[];
    const output=new CoachOutput({mode,opening:true,repName,turns:[{id:'b',speaker:'buyer',speakerSource:'native',text:'Hello.'}],onDelta:text=>updates.push(text)});
    output.append('{"roles":[],"for":"seller","action":"suggest","delivery":"cold_opening"}\n');
    for(const fragment of ['With your growing delivery options, ','marketing could face coordination challenges.'])output.append(fragment);
    output.append('\n{}');output.finish();
    const expected=`Hi, it’s ${repName} from Salesforce. Do you have a few minutes to chat?`;
    assert.equal(output.text,expected);assert.deepEqual(updates,[expected]);
  }
});
test('fixed opener cannot bypass HOLD, ambiguous live ownership or replace a scheduled natural opener',()=>{
  for(const [mode,speaker,action,delivery] of [['simulation','seller','suggest','cold_opening'],['simulation','buyer','hold','cold_opening'],['speakerphone','unassigned','suggest','cold_opening']]){
    const updates=[];
    const output=new CoachOutput({mode,turns:[{id:'last',speaker,speakerSource:'native',text:'Hello.'}],onDelta:text=>updates.push(text)});
    output.append(JSON.stringify({roles:[],for:'seller',action,delivery})+'\nDo not display this.\n{}');output.finish();
    assert.equal(updates.length,0);
  }
  const output=new CoachOutput({mode:'simulation',opening:true,turns:[],onDelta(){}});
  output.append('{"roles":[],"for":"seller","action":"suggest","delivery":"natural"}\nWhat would make this meeting useful?\n{}');output.finish();
  assert.equal(output.text,'What would make this meeting useful?');
  const missing=new CoachOutput({mode:'simulation',opening:true,turns:[],onDelta:()=>assert.fail('Do not display an unclassified generated opener')});
  assert.throws(()=>missing.append('{"roles":[],"for":"seller","action":"suggest"}\nLong generated opener'),/Opening context was missing/);
});

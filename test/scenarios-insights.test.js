import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../app/scenarios.js';
import { sessionConfig, coachingRequest } from '../api.js';
import { ReminderMemory } from '../app/state.js';
import { readReminders } from '../reminders.js';
import { readOpportunity } from '../opportunity.js';
import { CoachOutput } from '../coach-output.js';

const buyer = { id: 'client', speaker: 'buyer', speakerSource: 'native', text: 'We waste time looking up each order in another system.' };
const fit = { motion: 'optimize', product: 'Service Cloud', reason: 'Reduce the order lookup handoff.', validate: 'Check existing integration capabilities.' };
const pain = { id: 'manual-lookup', text: 'Manual order lookup', turn: 0, quote: 'looking up each order in another system' };

test('selected scenario reaches voice and coach; private buyer facts stay out of coach context', () => {
  for (const scenario of SCENARIOS) {
    const voice = sessionConfig('simulation', '', scenario.id);
    const coach = coachingRequest({ mode: 'simulation', scenarioId: scenario.id });
    assert.ok(voice.instructions.includes(scenario.contact));
    assert.ok(voice.instructions.includes(scenario.company));
    assert.deepEqual(JSON.parse(coach.input).practice_brief, scenario);
    assert.match(voice.instructions, /PRIVATE BUYER BACKGROUND/);
    assert.doesNotMatch(coach.instructions + coach.input, /PRIVATE BUYER BACKGROUND|You have not established a cost-per-contact baseline/);
  }
  const live = coachingRequest({ mode: 'speakerphone', scenarioId: 'target-service' });
  assert.equal(JSON.parse(live.input).practice_brief, undefined);
  assert.throws(() => sessionConfig('simulation', '', 'unknown'), /valid practice scenario/);
});

test('reminder memory removes covered items and does not resurrect a dismissal after rewording', () => {
  const memory = new ReminderMemory();
  memory.update({ items: [{ id: 'baseline', text: 'Ask about current costs.' }], covered: [] });
  memory.dismiss('baseline');
  memory.update({ items: [{ id: 'baseline', text: 'What is the cost today?' }, { id: 'owner', text: 'Confirm the owner.' }], covered: [] });
  assert.deepEqual(memory.items.map(x => x.id), ['owner']);
  memory.update({ items: [{ id: 'owner', text: 'Ask who owns this.' }], covered: ['owner'] });
  assert.deepEqual(memory.items, []);
  assert.deepEqual(memory.snapshot().covered, ['baseline', 'owner']);
  assert.deepEqual(new ReminderMemory().snapshot(), { items: [], covered: [] });
});

test('reminder validation limits bullets, deduplicates topics and excludes covered items', () => {
  const result = readReminders({ items: [{ id: 'done', text: 'Already asked' }, { id: 'x', text: 'Ask impact' }, { id: 'x', text: 'Duplicate' }, { id: 'y', text: 'Ask owner' }, { id: 'z', text: 'Ask timing' }, { id: 'four', text: 'Too many' }], covered: ['done'] });
  assert.deepEqual(result.items.map(x => x.id), ['x', 'y', 'z']);
  assert.equal(readReminders({ items: 'bad' }), null);
});

test('opportunity rejects seller hypotheses and fabricated quotes, and cannot recommend a product without buyer evidence', () => {
  assert.equal(readOpportunity({ pains: [pain], fit }, [{ ...buyer, speaker: 'seller' }]).fit, null);
  assert.deepEqual(readOpportunity({ pains: [{ ...pain, quote: 'Our costs doubled' }], fit }, [buyer]).pains, []);
  const valid = readOpportunity({ pains: [pain], fit }, [buyer]);
  assert.equal(valid.pains[0].turnId, 'client'); assert.deepEqual(valid.fit, fit);
  const retained = readOpportunity({ pains: [{ id: pain.id, turn: null }], fit }, [], [], valid);
  assert.deepEqual(retained.pains, valid.pains);
  const corrected = readOpportunity({ pains: [], fit }, [buyer], [], valid);
  assert.deepEqual(corrected, { pains: [], fit: null });
});

test('the rep sentence streams before insights; trailing JSON never appears as spoken words', () => {
  const deltas = [], updates = [];
  const output = new CoachOutput({ mode: 'simulation', turns: [buyer], onDelta: text => deltas.push(text), onOpportunity: value => updates.push(value) });
  output.append('{"roles":[],"for":"seller","action":"suggest"}\nWhere does the lookup slow you down?');
  assert.equal(deltas.at(-1), 'Where does the lookup slow you down?');
  assert.equal(updates.length, 0);
  const tail = '\n' + JSON.stringify({ opportunity: { pains: [pain], fit }, reminders: { items: [], covered: [] } });
  for (const char of tail) output.append(char);
  assert.equal(updates.length, 0); output.finish();
  assert.equal(updates[0].pains[0].id, 'manual-lookup');
  assert.ok(deltas.every(text => !text.includes('opportunity') && !text.includes('{')));
});

test('insights still update while a recognized rep turn blocks the proposed client line', () => {
  let update;
  const output = new CoachOutput({ mode: 'speakerphone', turns: [{ ...buyer, speaker: 'seller', speakerSource: 'manual' }], onDelta() { assert.fail('No client answer allowed'); }, onReminders: value => { update = value; } });
  output.append('{"roles":[],"for":"seller","action":"wait"}\n\n{"reminders":{"items":[],"covered":["baseline"]}}');
  output.finish();
  assert.equal(output.held, true); assert.deepEqual(update.covered, ['baseline']);
});

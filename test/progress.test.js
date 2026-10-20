import test from 'node:test';
import assert from 'node:assert/strict';
import { readProgress } from '../progress.js';
import { coachingRequest } from '../api.js';
import { CoachOutput } from '../coach-output.js';

test('readiness rejects invalid data and cannot show a completed close in an early stage', () => {
  for (const value of [null, { score: -1 }, { score: 101 }, { score: '80' }, { score: 20, stage: 'made up', reason: 'x' }, { score: 20, stage: 'discovery', reason: '' }]) assert.equal(readProgress(value), null);
  assert.equal(readProgress({ score: 100, stage: 'discovery', reason: 'Early discovery' }).score, 35);
  assert.equal(readProgress({ score: 100, stage: 'commitment', reason: 'Still discussing' }).score, 95);
  assert.equal(readProgress({ score: 100, stage: 'agreed', reason: 'Buyer accepted the meeting time.' }).score, 100);
});

test('both production modes use evidence-based objectives instead of numeric close targets', () => {
  for (const mode of ['simulation', 'speakerphone']) {
    const request = coachingRequest({mode, goal:'purchase'});
    assert.equal(JSON.parse(request.input).close_goal, undefined);
    assert.match(request.instructions, /CONVERSATION FOCUS/);
    assert.doesNotMatch(request.instructions, /score.*0_to_100/);
  }
});

test('both modes deliver progress separately from the rep sentence', () => {
  for (const mode of ['simulation', 'speakerphone']) {
    let progress; const updates = [];
    const output = new CoachOutput({ mode, turns: [{ id: 'b', speaker: 'buyer', speakerSource: 'manual', text: 'That answers my concern.' }], onDelta: value => updates.push(value), onProgress: value => { progress = value; } });
    const header = { roles: [], for: 'seller', action: 'suggest', progress: { score: 70, stage: 'objections', reason: 'Concern resolved; no next step agreed.' } };
    output.append(JSON.stringify(header) + '\nWould Tuesday work for a walkthrough?');
    assert.equal(progress.score, 70);
    assert.deepEqual(updates, ['Would Tuesday work for a walkthrough?']);
  }
});

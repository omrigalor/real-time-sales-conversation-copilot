import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { sessionConfig, coachingRequest } from '../api.js';
import { observeRequest } from '../training-api.js';
import { loadCases, evaluateOne } from '../evaluation/runner.js';

function mockBuyerSocket() {
  const sent = [];
  const socketFactory = () => {
    const socket = new EventEmitter();
    socket.close = () => socket.emit('close');
    socket.send = raw => {
      const event = JSON.parse(raw); sent.push(event);
      if (event.type === 'session.update') queueMicrotask(() => socket.emit('message', JSON.stringify({type:'session.updated',session:{model:'gpt-realtime-2.1'}})));
      if (event.type === 'response.create') queueMicrotask(() => socket.emit('message', JSON.stringify({type:'response.done',response:{id:'mock-only',status:'completed',output:[{content:[{type:'output_text',text:'Fixture transport reply; not an evaluated buyer response.'}]}]}})));
    };
    queueMicrotask(() => socket.emit('open'));
    return socket;
  };
  return { sent, socketFactory };
}

test('buyer perspective is shared by all artificial buyers and never becomes seller or live guidance', () => {
  for (const trainingMode of ['assisted','blind','demo','observe']) {
    const config = sessionConfig('simulation','','target-service',{trainingMode,difficulty:5});
    assert.match(config.instructions,/BUYER'S OWN POINT OF VIEW/);
    assert.match(config.instructions,/Before speaking, silently check/);
    assert.match(config.instructions,/A sophisticated buyer is not a sales examiner/);
    assert.match(config.instructions,/know the cause without caring enough/);
  }
  const turns = [{id:'b',speaker:'buyer',speakerSource:'native',text:'I only have a minute.'}];
  for (const salesRole of ['BDR','AE']) {
    for (const trainingMode of ['assisted','blind','demo','observe','live']) {
      const payload = {mode:trainingMode==='live'?'speakerphone':'simulation',trainingMode,salesRole,turns};
      const request = trainingMode==='observe'?observeRequest(payload):coachingRequest(payload);
      assert.doesNotMatch(request.instructions,/SILENT BUYER-PERSPECTIVE CHECK|PRIVATE PRACTICE CONDITIONS/);
      assert.match(request.instructions,/brief read-aloud edit/);
      assert.match(request.instructions,/A theoretically useful extra detail is not by itself/);
      assert.match(request.instructions,/Never manufacture credibility/);
      assert.match(request.instructions,/different from establishing solution fit/);
    }
  }
  assert.equal(sessionConfig('speakerphone','','target-service',{difficulty:5}).instructions,undefined);
});

test('buyer comparison fixtures are fixed, independent of production and remain separate from the expanded conversational suite', async () => {
  const matrix = await loadCases({buyerRealism:true});
  assert.equal(matrix.cases.length,10);
  assert.equal(new Set(matrix.cases.map(item=>item.id)).size,10);
  assert.ok(matrix.cases.every(item=>item.kind==='buyer' && item.payload.accountContext && item.manual_review));
  assert.equal((await loadCases({realism:true})).cases.length,94);
  assert.ok(matrix.cases.some(item=>item.id==='legitimate-sharp-question'));
  assert.ok(matrix.cases.some(item=>item.id==='earned-commitment'));
});

test('buyer replay actually passes the selected level and personal knowledge, without coach or review leakage', async () => {
  const fixture = (await loadCases({buyerRealism:true})).cases.find(item=>item.id==='pain-without-cause');
  fixture.payload.accountContext.objective = 'SECRET_SELLER_DESTINATION';
  fixture.payload.accountContext.entries.push({kind:'hypothesis',text:'SECRET_RESEARCH_HYPOTHESIS'});
  fixture.payload.previousRecommendation = {text:'SECRET_COACH_LINE'};
  let items;
  const prompts = [];
  for (const level of [1,3,5]) {
    const socket = mockBuyerSocket();
    const result = await evaluateOne(fixture,`level-${level}`,{key:'fixture-only',socketFactory:socket.socketFactory});
    assert.equal(result.status,'completed'); assert.equal(result.difficulty,level);
    const actual = socket.sent.find(event=>event.type==='session.update').session;
    assert.match(actual.instructions,new RegExp(`LEVEL ${level} OF 5`));
    assert.match(actual.instructions,/has not traced the process/);
    assert.match(actual.instructions,/VP Customer Experience/);
    assert.doesNotMatch(actual.instructions,/SECRET_/);
    assert.ok(!actual.instructions.includes(fixture.manual_review));
    const messages = socket.sent.filter(event=>event.type==='conversation.item.create');
    if (items) assert.deepEqual(messages,items); else items=messages;
    prompts.push(actual.instructions);
  }
  assert.equal(new Set(prompts).size,3);
  const supplied = await evaluateOne({...fixture,payload:{...fixture.payload,difficulty:4}},'current',{key:'fixture-only',socketFactory:mockBuyerSocket().socketFactory});
  assert.match(supplied.request.session.instructions,/LEVEL 4 OF 5/);
  await assert.rejects(evaluateOne({...fixture,kind:'coach'},'level-5',{key:'unused'}),/buyer-only/);
  await assert.rejects(evaluateOne(fixture,'toString',{key:'unused'}),/Unknown comparison variant/);
});

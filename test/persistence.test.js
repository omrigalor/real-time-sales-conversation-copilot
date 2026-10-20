import test from 'node:test';
import assert from 'node:assert/strict';
import {coachingRequest,sessionConfig} from '../api.js';
import {observeRequest} from '../training-api.js';
import {readConversationMemory} from '../conversation-memory.js';
import {memoryContext} from '../thread-memory.js';
import {loadCases} from '../evaluation/runner.js';
import {lifecycleRequest} from '../call-lifecycle-api.js';

test('shared commercial-persistence policy reaches BDR and AE in every seller mode without entering buyer context',()=>{
  for(const salesRole of ['BDR','AE'])for(const trainingMode of ['live','assisted','blind','demo','observe']){
    const payload={mode:trainingMode==='live'?'speakerphone':'simulation',salesRole,trainingMode};
    const request=trainingMode==='observe'?observeRequest(payload):coachingRequest(payload);
    assert.match(request.instructions,/COMMERCIAL PERSISTENCE/);assert.match(request.instructions,/generally make ONE strong, concise attempt/);
    assert.match(request.instructions,/renewed refusal, firm email-only boundary/);assert.match(request.instructions,/Do not repeat the same ask/);
    assert.match(request.instructions,/fixed, minimal cold-call introduction/);
    assert.doesNotMatch(request.instructions,/Send information: agree, and if welcome/);
  }
  for(const trainingMode of ['assisted','blind','demo','observe'])assert.doesNotMatch(sessionConfig('simulation','','target-service',{trainingMode}).instructions,/COMMERCIAL PERSISTENCE|objection_attempts/);
});
test('objection-attempt memory records only actual identified seller speech, survives window changes, and never establishes buyer agreement',()=>{
  const seller={id:'s',speaker:'seller',speakerSource:'manual',text:'Before I send it, could I ask one quick question about the manual checks?'};
  const attempt={id:'time-pressure',kind:'relevance',concern:'Busy and prefers email',turn:0,quote:'could I ask one quick question about the manual checks?'};
  const memory=readConversationMemory({objection_attempts:[attempt]},[seller]);
  assert.equal(memory.objection_attempts.length,1);assert.equal(memory.next_step,undefined);
  const later=readConversationMemory({next_step:{state:'none'}},[],[],memory);
  assert.deepEqual(memoryContext(later).objection_attempts,memory.objection_attempts);
  for(const turn of [{...seller,speaker:'buyer'},{...seller,speakerSource:'unassigned',speaker:'unassigned'}])assert.equal(readConversationMemory({objection_attempts:[attempt]},[turn]).objection_attempts.length,0);
  assert.equal(readConversationMemory({objection_attempts:[{...attempt,quote:'unsaid recommendation'}]},[seller]).objection_attempts.length,0);
  assert.equal(readConversationMemory({objection_attempts:[{...attempt,turn:null}]},[seller]).objection_attempts.length,0);
  const live=coachingRequest({mode:'speakerphone',conversationMemory:later,turns:[]});
  assert.equal(JSON.parse(live.input).conversation_memory.objection_attempts[0].turnId,'s');
});
test('regression fixtures cover the first brush-off, renewed and hard refusal, earned meeting, AE stage, old attempts and lifecycle',async()=>{
  const cases=(await loadCases({realism:true})).cases.filter(c=>c.id.startsWith('persistence-'));
  assert.equal(cases.length,17);
  for(const id of ['soft-live','soft-observe','investment','earned-meeting','meeting-concern','renewed-refusal','hard-no','departure','settled-email','ae-evaluation','attempt-memory','lifecycle-soft'])assert.ok(cases.some(c=>c.id==='persistence-'+id));
  const request=lifecycleRequest(cases.find(c=>c.id==='persistence-lifecycle-soft').payload);
  assert.match(request.instructions,/first soft brush-off/);assert.match(request.instructions,/proposal and acceptance/);
  assert.equal(Object.keys(JSON.parse(request.input)).join(','),'transcript');
});

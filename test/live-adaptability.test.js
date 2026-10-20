import test from 'node:test';
import assert from 'node:assert/strict';
import { coachingRequest, sessionConfig } from '../api.js';
import { scopedSalesContext } from '../app/call-context.js';
import { speakerphoneDecision } from '../speakerphone-policy.js';
import { updateThreads } from '../thread-memory.js';

// Wiring/contract checks, not claims that an LLM has passed these conversations.
test('live BDR and AE receive arbitrary industries and actual problems without simulation inputs',()=>{
  for(const salesRole of ['BDR','AE'])for(const [company,industry,problem] of [
    ['Cobalt Manufacturing','Industrial equipment','Our channel partners wait days for a quote.'],
    ['Beacon Software','B2B software','Customer renewals are falling through the cracks.'],
    ['Harbor Logistics','Freight','Dispatch exceptions are handled over email.']
  ]){
    const payload={mode:'speakerphone',salesRole,scenarioId:'target-service',difficulty:5,hiddenBuyerState:{trust:'PRIVATE_SENTINEL'},accountContext:{company,industry,person:'Jordan',callType:salesRole==='AE'?'scheduled discovery':'cold outbound'},turns:[{id:'r',speaker:'seller',speakerSource:'manual',text:'What prompted the conversation?'},{id:'b',speaker:'buyer',speakerSource:'manual',text:problem}]};
    const request=coachingRequest({...payload,context:scopedSalesContext(payload)}),input=JSON.parse(request.input);
    assert.equal(input.account_context.company,company);assert.equal(input.transcript.at(-1).text,problem);
    assert.equal(input.sales_role,salesRole);assert.equal(input.practice_brief,undefined);
    assert.doesNotMatch(request.input,/Target|Pandora|PRIVATE_SENTINEL|difficulty|hiddenBuyerState/);
    const transport=sessionConfig('speakerphone','',payload.scenarioId,payload);
    assert.equal(transport.type,'transcription');assert.equal(transport.instructions,undefined);assert.equal(transport.tools,undefined);assert.equal(transport.audio.output,undefined);
  }
  const unknown=JSON.parse(coachingRequest({mode:'speakerphone',accountContext:null,scenarioId:'target-service'}).input);
  assert.equal(unknown.account_context,null);assert.equal(unknown.practice_brief,undefined);
});

test('live buyer corrections replace an earlier inferred thread; rep and uncertain turns cannot produce buyer dialogue',()=>{
  const previous=[{id:'main-issue',kind:'inferred',topic:'pain',summary:'Possible service capacity issue',quote:'busy team',turnId:'old',speaker:'buyer',status:'open'}];
  const turns=[{id:'new',speaker:'buyer',speakerSource:'manual',text:'Service capacity is fine. The problem is slow partner quotes.'}];
  const updated=updateThreads([{id:'main-issue',kind:'known',topic:'pain',summary:'Slow partner quotes, not service capacity',turn:0,quote:'The problem is slow partner quotes.',status:'open'}],turns,[],previous);
  const input=JSON.parse(coachingRequest({mode:'speakerphone',turns,conversationMemory:{threads:updated}}).input);
  assert.match(input.conversation_memory.threads[0].summary,/Slow partner quotes/);
  assert.equal(input.conversation_memory.threads.length,1);
  assert.equal(speakerphoneDecision([{...turns[0],speaker:'seller'}],[],{for:'seller',action:'suggest'}),'wait');
  assert.equal(speakerphoneDecision([{...turns[0],speaker:'unassigned',speakerSource:'unknown'}],[],{for:'seller',action:'suggest'}),'uncertain');
  assert.equal(speakerphoneDecision(turns,[],{for:'buyer',action:'suggest'}),'wait');
});

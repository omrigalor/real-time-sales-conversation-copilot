import {loadCases,evaluateOne,renderReport} from '../evaluation/runner.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {accountForCall,normalizeAccount,demoAccount} from '../app/account-context.js';
import {coachingRequest,sessionConfig} from '../api.js';
import {readConversationMemory} from '../conversation-memory.js';
import {productKnowledge,readSupport} from '../product-knowledge.js';
import {researchAccount} from '../research-api.js';
import {handoffCall,handoffRequest} from '../handoff-api.js';
import {observeRequest} from '../training-api.js';
import {CoachOutput} from '../coach-output.js';

const buyer={id:'buyer-early',speaker:'buyer',speakerSource:'manual',text:'Delivery exceptions mean checking the carrier portal.'};
const json=value=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('account snapshot is detached, editable context reaches both roles, and demo never enters a live prompt',()=>{
  const brief=normalizeAccount({company:'User supplied account',person:'Jordan',buyerRole:'Service director',callType:'Scheduled discovery',entries:[{text:'Costs might be affected',kind:'hypothesis'}]});
  const snapshot=accountForCall(brief,'speakerphone');brief.company='Changed draft';brief.entries[0].text='New research';
  assert.equal(snapshot.company,'User supplied account');assert.equal(snapshot.entries[0].text,'Costs might be affected');
  for(const salesRole of ['BDR','AE']) {
    const data=JSON.parse(coachingRequest({mode:'speakerphone',salesRole,accountContext:snapshot}).input);
    assert.equal(data.account_context.callType,'Scheduled discovery');assert.equal(data.practice_brief,undefined);
    assert.equal(JSON.parse(coachingRequest({mode:'speakerphone',accountContext:demoAccount()}).input).account_context,null);
  }
  assert.equal(accountForCall(demoAccount(),'simulation').company,'Northstar Retail Group');
});
test('custom simulation buyer receives its public circumstances but not seller objectives, notes or hypotheses',()=>{
  const account={...demoAccount(),objective:'SECRET_DESIRED_CLOSE',notes:'SECRET_SELLER_NOTES',entries:[{text:'SECRET_HYPOTHESIS',kind:'hypothesis'}]};
  const instructions=sessionConfig('simulation','','target-service',{accountContext:account}).instructions;
  assert.match(instructions,/Northstar Retail Group/);assert.doesNotMatch(instructions,/SECRET_/);
  assert.match(observeRequest({scenarioId:'target-service',salesRole:'BDR',accountContext:account,turns:[]}).input,/SECRET_DESIRED_CLOSE/,'Seller can use its own objective');
});
test('important threads survive the recent transcript window and next-step-only updates',()=>{
  const value={threads:[{id:'carrier-lookup',kind:'known',topic:'workflow',summary:'Delivery exceptions require a carrier portal lookup.',turn:0,quote:'checking the carrier portal',status:'open'}]};
  const memory=readConversationMemory(value,[buyer]);
  const later=readConversationMemory({next_step:{state:'none'}},[],[],memory);
  assert.equal(later.threads[0].turnId,buyer.id);
  const current=Array.from({length:70},(_,i)=>({id:`later-${i}`,speaker:'buyer',speakerSource:'manual',text:'We are discussing another topic.'}));
  const input=JSON.parse(coachingRequest({mode:'speakerphone',turns:current,conversationMemory:later}).input);
  assert.equal(input.transcript.length,60);assert.equal(input.conversation_memory.threads[0].quote,'checking the carrier portal');
  assert.ok(!input.transcript.some(t=>t.text.includes('carrier')));
});
test('memory cannot launder an inference into a fact, fabricate a quote or confirm a seller claim',()=>{
  const base={id:'impact',kind:'inferred',topic:'pain',summary:'Possible investigation friction',turn:0,quote:'checking the carrier portal',status:'open'};
  const memory=readConversationMemory({threads:[base]},[buyer]);
  assert.equal(readConversationMemory({threads:[{...base,kind:'known',summary:'Major costly pain'}]},[buyer],[],memory).threads[0].kind,'inferred');
  assert.equal(readConversationMemory({threads:[{...base,kind:'known',quote:'urgent and expensive'}]},[buyer]).threads.length,0);
  assert.equal(readConversationMemory({threads:[{...base,kind:'known'}]},[{...buyer,speaker:'seller'}]).threads.length,0);
  const confirmed={...buyer,id:'buyer-new',text:'Yes, those portal checks do slow the team down.'};
  assert.equal(readConversationMemory({threads:[{...base,kind:'known',quote:'portal checks do slow the team down'}]},[confirmed],[],memory).threads[0].kind,'known');
});
test('SAY/HOLD is binary; attention cues stay under HOLD and cannot become spoken dialogue',()=>{
  let hold,spoken='';const output=new CoachOutput({mode:'speakerphone',turns:[buyer],onDelta:t=>spoken=t,onHold:(reason,focus)=>hold={reason,focus}});
  output.append('{"roles":[],"for":"seller","action":"hold","listen_for":"Whether these exceptions happen often"}\nDo not speak this.\n{}');output.finish();
  assert.equal(hold.reason,'hold');assert.match(hold.focus,/often/);assert.equal(spoken,'');
  const request=coachingRequest({mode:'speakerphone'});
  assert.match(request.instructions,/suggest\|hold\|keep/);assert.doesNotMatch(request.instructions,/action.*suggest\|wait\|listen/);
});
test('Why and product basis only expose valid evidence and controlled source IDs',()=>{
  const product=productKnowledge().find(p=>p.name==='Service Cloud');
  const result=readSupport({why:{reason:'The lookup is known; its impact is still unclear.',evidence:[{turn:0,quote:'checking the carrier portal'},{turn:0,quote:'millions wasted'}]},products:[product.id,'invented-source']},[buyer]);
  assert.equal(result.why.evidence.length,1);assert.equal(result.products.length,1);assert.match(result.products[0].url,/salesforce.com/);
  assert.equal(readSupport({why:{reason:'Invented',evidence:[{turn:0,quote:'millions wasted'}]}},[buyer]).why,null);
  for(const mode of ['simulation','speakerphone']) assert.match(coachingRequest({mode}).instructions,/exact pricing, security guarantees/);
});
test('research uses the existing key, sends public identity only, and rejects invented provenance',async()=>{
  const requests=[];
  const result=await researchAccount({key:'test-key',payload:{company:'Example Retail',person:'Jordan',notes:'PRIVATE_INTERNAL_NOTE',entries:[{kind:'user',text:'PRIVATE_CRM_NOTE'}]},fetcher:async(url,options)=>{
    requests.push(JSON.parse(options.body));
    if(requests.at(-1).tools)return Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://example.com/investors',title:'Investor update'}]}},{content:[{type:'output_text',text:'The company describes ecommerce growth. The annual report lists approximately 1200 employees as of 2025.'}]}]});
    return json({fields:[{field:'size',value:'About 1200 (2025)',confidence:'high',source:'https://example.com/investors',evidence:'approximately 1200 employees as of 2025'},{field:'products',value:'Service Cloud',confidence:'high',source:'https://example.com/investors',evidence:'Uses Service Cloud'}],entries:[{kind:'public',text:'Ecommerce grew.',source:'https://example.com/investors'},{kind:'public',text:'Invented budget.',source:'https://invented.example/budget'},{kind:'hypothesis',text:'Support demand may change.'}]});
  }});
  assert.equal(requests.filter(r=>r.tools).length,3);assert.equal(result.fields.length,1);assert.equal(result.fields[0].field,'size');
  assert.equal(requests[0].tools[0].type,'web_search');assert.equal(requests[0].tool_choice,'required');
  assert.doesNotMatch(JSON.stringify(requests),/PRIVATE_/);assert.equal(result.entries.length,2);
  assert.equal(result.entries[0].sourceTitle,'Investor update');assert.equal(result.entries[1].kind,'hypothesis');
  assert.equal(result.entries.some(e=>e.text==='Invented budget.'),false);
  await assert.rejects(researchAccount({key:'x',payload:demoAccount(),fetcher:()=>assert.fail()}),/Fictional/);
  await assert.rejects(researchAccount({key:'x',payload:{company:'A'},provider:'off',fetcher:()=>assert.fail()}),/Enable/);
});
test('BDR handoff keeps buyer language and separates unknowns; invented agreement cannot produce a brief',async()=>{
  const agreement={id:'yes',speaker:'buyer',speakerSource:'manual',text:'Yes, let us meet with your AE to look at the delivery investigation workflow.'};
  const payload={mode:'speakerphone',salesRole:'BDR',turns:[buyer,agreement],accountContext:{company:'Example',person:'Jordan',buyerRole:'Service director'}};
  const result=await handoffCall({key:'test',payload,fetcher:async()=>json({eligible:true,reason:'Review the actual workflow.',buyer:'Jordan · Service director',known:[{text:'Carrier portal lookup',turnId:buyer.id,quote:'checking the carrier portal'}],inferred:['Possible workflow friction'],unknown:['Frequency and impact'],agreement:{text:'AE workflow meeting',turnId:agreement.id,quote:'meet with your AE'},ae_objective:'Understand the investigation before proposing a solution.'})});
  assert.equal(result.eligible,true);assert.equal(result.known[0].quote,'checking the carrier portal');assert.deepEqual(result.unknown,['Frequency and impact']);
  const invalid=await handoffCall({key:'test',payload,fetcher:async()=>json({eligible:true,agreement:{turnId:'yes',quote:'Approved purchase of Agentforce'}})});
  assert.equal(invalid.eligible,false);
  const input=JSON.parse(handoffRequest({...payload,accountContext:demoAccount()}).input);assert.equal(input.account,null);
  assert.throws(()=>handoffRequest({...payload,salesRole:'AE'}),/BDR/);
});


test('45-case suite is additive and contains independent current-mode intelligence probes',async()=>{
  const suite=await loadCases({intelligence:true});
  assert.equal(suite.cases.length,45);assert.equal(new Set(suite.cases.map(c=>c.id)).size,45);
  const previous=await loadCases({extended:true,crossMode:true});
  assert.deepEqual(suite.cases.slice(0,33),previous.cases);
  assert.equal(suite.cases.filter(c=>c.kind==='handoff').length,1);
});

test('handoff evaluation runs the production validator and report retains the actual brief',async()=>{
  const fixture=(await loadCases({intelligence:true})).cases.find(c=>c.kind==='handoff');
  const agreement=fixture.payload.turns.at(-1);
  const result=await evaluateOne(fixture,'current',{key:'test',fetcher:async()=>json({eligible:true,reason:'Buyer accepted a focused AE conversation.',agreement:{text:'AE discussion next week',turnId:agreement.id,quote:'send two times for a conversation with your AE next week'},known:[],inferred:[],unknown:['Frequency'],ae_objective:'Understand the lookup.'})});
  assert.equal(result.status,'completed');assert.equal(result.handoff.eligible,true);
  assert.match(renderReport({status:'test',variants:['current'],cases:[{...fixture,results:[result]}]}),/Understand the lookup/);
  const old=await evaluateOne(fixture,'before-training',{fetcher:()=>assert.fail()});assert.equal(old.status,'unavailable');
});

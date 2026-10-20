import test from 'node:test';
import assert from 'node:assert/strict';
import {callContext, scopedSalesContext, normalizeContextNotes} from '../app/call-context.js';
import {demoAccount} from '../app/account-context.js';
import {coachingRequest} from '../api.js';
import {observeRequest} from '../training-api.js';
import {normalizeLibrary,saveToLibrary,trainingAccount} from '../app/account-library.js';
import {researchedTarget} from '../app/researched-target.js';
import {loadCases} from '../evaluation/runner.js';

test('role/scenario context reaches seller requests without leaking notes across setups',()=>{
  const bdr={mode:'simulation',salesRole:'BDR',scenarioId:'target-service'};
  const ae={...bdr,salesRole:'AE',scenarioId:'ae-discovery'};
  const notes={[callContext(bdr).scope]:'Target-specific BDR instructions'};
  assert.match(scopedSalesContext(bdr,notes),/Target-specific/);
  const context=scopedSalesContext(ae,notes);
  assert.match(context,/Salesforce AE/);assert.doesNotMatch(context,/Target-specific/);
  assert.equal(JSON.parse(coachingRequest({...ae,context}).input).sales_context,context);
  assert.equal(JSON.parse(observeRequest(ae,context,'Omri').input).sales_context,context);
  assert.notEqual(callContext({...bdr,salesRole:'AE'}).scope,callContext(bdr).scope);
});

test('live context excludes fictional defaults and preserves only its own account notes',()=>{
  const live={mode:'speakerphone',salesRole:'AE',accountContext:demoAccount()};
  assert.doesNotMatch(scopedSalesContext(live),/Target|Northstar|retail|upsell/i);
  assert.match(scopedSalesContext(live),/Company: Not specified/);
  const custom={...live,accountContext:{company:'Private Client',person:'Sam',callType:'Negotiation'}};
  const notes={[callContext(custom).scope]:'Confirm purchasing timeline'};
  assert.match(scopedSalesContext(custom,notes),/Private Client/);
  assert.match(scopedSalesContext(custom,notes),/Confirm purchasing timeline/);
  assert.doesNotMatch(scopedSalesContext({...custom,accountContext:{...custom.accountContext,company:'Different Client'}},notes),/Confirm purchasing timeline/);
  assert.doesNotMatch(scopedSalesContext({...custom,mode:'simulation'},notes),/Confirm purchasing timeline/);
});

test('note storage accepts bounded scope entries, not a legacy global paragraph',()=>{
  assert.deepEqual(normalizeContextNotes('Old global Target paragraph'),{});
  assert.deepEqual(normalizeContextNotes({context:'Old global Target paragraph'}),{});
  const key=callContext({mode:'speakerphone'}).scope;
  assert.equal(normalizeContextNotes({[key]:'a'.repeat(3500)})[key].length,3000);
});

test('researched Target seed keeps real evidence and user-authorized assumptions distinguishable',()=>{
  const account=researchedTarget();assert.equal(account.demo,false);
  assert.equal(account.person,'Mark Weinstein');assert.match(account.fieldSources.size.source,/10-k/);
  assert.match(account.relationship,/user provided/);assert.match(account.products,/assumption/);
  assert.equal(account.fieldSources.products,undefined);
  assert.ok(account.entries.some(e=>e.kind==='unknown'));
  assert.equal(normalizeLibrary([demoAccount(),account]).length,1);
  const edited={...account,size:'My corrected size'};
  const library=saveToLibrary([account],edited);assert.equal(library.length,1);assert.equal(library[0].fieldSources.size,undefined);
  assert.match(trainingAccount(account,'BDR').callType,/unexpected/);
  assert.match(trainingAccount(account,'AE','commercial').callType,/commercial/);
  assert.equal(account.callType,'','Training assumptions do not mutate the real account brief');
});

test('realism regression suite preserves the previous 45 inputs and adds buyer/seller counterexamples',async()=>{
  const original=await loadCases({intelligence:true}),next=await loadCases({realism:true});
  assert.equal(next.cases.length,94);assert.deepEqual(next.cases.slice(0,45),original.cases);
  assert.equal(new Set(next.cases.map(c=>c.id)).size,94);
  assert.ok(next.cases.some(c=>c.id==='engaged-buyer-depth'));
  assert.ok(next.cases.some(c=>c.id==='earned-fast-advance'));
});

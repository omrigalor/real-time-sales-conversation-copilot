import test from 'node:test';
import assert from 'node:assert/strict';
import { readOpportunity, readProductFocus } from '../opportunity.js';
import { productFocusRequest, assessProductFocus } from '../product-focus-api.js';
import { coachingRequest, sessionConfig } from '../api.js';
import { researchedTarget } from '../app/researched-target.js';
import { observeRequest, reviewRequest } from '../training-api.js';

const focus = {product_id:'sf-25',motion:'undetermined',reason:'Investigate whether context handoffs need integration.',validate:'Actual stack and unmet need.'};

test('product hypothesis is separate from confirmed pain and accepts only catalog names',()=>{
  const result=readOpportunity({pains:[],fit:{product:'MuleSoft',motion:'expand',reason:'No buyer evidence',validate:'Need'},focus},[]);
  assert.equal(result.fit,null);
  assert.equal(result.focus.product,'MuleSoft Anypoint Platform');
  assert.equal(result.focus.url,'https://www.salesforce.com/mulesoft/');
  assert.equal(readProductFocus({...focus,product_id:'made-up-product'}),undefined);
  assert.equal(readProductFocus({...focus,motion:'confirmed'}),undefined);
  assert.equal(readOpportunity({pains:[],fit:null,focus:null},[]).focus,null,'Explicit removal is retained');
  const none=readProductFocus({product_id:null,motion:'none',reason:'Existing tools cover the need.',validate:'No further discovery needed now.'});
  assert.equal(none.product,'');
  assert.equal(readProductFocus({...focus,product_id:null}),undefined);
});

test('BDR and AE pre-call focus use shared intelligence and real supplied account uncertainty',()=>{
  for(const salesRole of ['BDR','AE']) {
    const request=productFocusRequest({mode:'speakerphone',salesRole,accountContext:researchedTarget()});
    const data=JSON.parse(request.input);
    assert.equal(data.sales_role,salesRole);
    assert.equal(data.account_context.company,'Target Corporation');
    assert.match(data.account_context.products,/NOT verified/);
    assert.equal(data.practice_brief,undefined);
    assert.match(request.instructions,/PRODUCT FOCUS/);
    assert.match(request.instructions,/REPRESENTATIVE OPENING PREFERENCE/);
    assert.doesNotMatch(request.instructions,/PRIVATE PRACTICE CONDITIONS/);
    assert.match(coachingRequest({mode:'speakerphone',salesRole}).instructions,/opportunity.focus/);
  }
  assert.equal(JSON.parse(productFocusRequest({mode:'speakerphone',salesRole:'BDR',accountContext:{demo:true,company:'Fiction'}}).input).account_context,null);
});

test('focus can reach Observe seller without leaking to buyer or becoming a review answer key',()=>{
  const payload={mode:'simulation',scenarioId:'target-service',salesRole:'BDR',turns:[],productFocus:{...focus,reason:'PRIVATE_SELLER_HYPOTHESIS'}};
  assert.match(observeRequest(payload).input,/PRIVATE_SELLER_HYPOTHESIS/);
  assert.doesNotMatch(reviewRequest(payload).input,/PRIVATE_SELLER_HYPOTHESIS/);
  assert.doesNotMatch(sessionConfig('simulation','','target-service',payload).instructions,/PRIVATE_SELLER_HYPOTHESIS/);
});

test('pre-call assessment validates the actual returned model product rather than substituting a default',async()=>{
  let sent;
  const fetcher=async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(focus)}]}]})};};
  const result=await assessProductFocus({key:'test-only',payload:{mode:'speakerphone',salesRole:'AE',accountContext:{company:'Example',products:'Unknown'}},fetcher});
  assert.equal(result.product,'MuleSoft Anypoint Platform');
  assert.equal(sent.store,false);assert.equal(JSON.parse(sent.input).account_context.company,'Example');
  const bad=async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"product_id":"made-up"}'}]}]})});
  await assert.rejects(assessProductFocus({key:'test-only',payload:{mode:'speakerphone'},fetcher:bad}),/grounded product focus/);
});

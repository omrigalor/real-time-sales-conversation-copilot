import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { coachingRequest, sessionConfig } from '../api.js';
import { getScenario, SCENARIOS, scenariosForRole } from '../app/scenarios.js';
import { readConversationMemory } from '../conversation-memory.js';
import { CoachOutput } from '../coach-output.js';
import { loadCases, evaluateOne, runSuite, renderReport } from '../evaluation/runner.js';
const buyer={id:'buyer',speaker:'buyer',speakerSource:'native',text:'Yes, send a couple of times for the review.'};
test('buyer context excludes seller objectives, hypotheses, user sales instructions and batch principles for every scenario',()=>{
  for(const s of SCENARIOS){
    const config=sessionConfig('simulation','SECRET_SELLER_CONTEXT',s.id);
    assert.ok(!config.instructions.includes(s.objective));
    assert.ok(!config.instructions.includes(s.hypothesis));
    assert.doesNotMatch(config.instructions,/SECRET_SELLER_CONTEXT|PROVISIONAL BDR TRANSCRIPT/);
    assert.doesNotMatch(config.instructions,/PRIVATE BUYER BACKGROUND: undefined/);
  }
  assert.ok(scenariosForRole('AE').length>=7); assert.ok(scenariosForRole('BDR').length>=7);
});
test('BDR and AE share natural reasoning but receive distinct objectives and only BDR gets Batch 1',()=>{
  const request=role=>coachingRequest({mode:'speakerphone',salesRole:role,turns:[buyer]});
  const bdr=request('BDR'),ae=request('AE');
  assert.match(bdr.instructions,/PROVISIONAL BDR TRANSCRIPT/); assert.doesNotMatch(ae.instructions,/PROVISIONAL BDR TRANSCRIPT/);
  assert.match(ae.instructions,/SELECTED ROLE: AE/); assert.match(bdr.instructions,/SELECTED ROLE: BDR/);
  assert.deepEqual(JSON.parse(ae.input).transcript,JSON.parse(bdr.input).transcript);
  assert.ok(!JSON.parse(bdr.input).practice_brief);
  const off=coachingRequest({mode:'speakerphone',useBatch1:false,turns:[buyer]});
  assert.doesNotMatch(off.instructions,/PROVISIONAL BDR TRANSCRIPT/);
});
test('commitment memory requires actual buyer evidence, preserves confirmed state and accepts explicit reversal',()=>{
  const value={next_step:{state:'agreed',detail:'Send review times',turn:0,quote:'send a couple of times'}};
  const known=readConversationMemory(value,[buyer]);
  assert.equal(known.next_step.state,'agreed');
  assert.equal(readConversationMemory(value,[{...buyer,speaker:'seller'}]),null);
  assert.equal(readConversationMemory({...value,next_step:{...value.next_step,quote:'I will buy today'}},[buyer]),null);
  assert.equal(readConversationMemory({next_step:{state:'none'}},[],[],known).next_step.state,'agreed');
  const no={...buyer,text:'Actually, cancel the review.'};
  assert.equal(readConversationMemory({next_step:{state:'declined',detail:'Cancel',turn:0,quote:'cancel the review'}},[no],[],known).next_step.state,'declined');
});
test('WAIT/LISTEN never leak model dialogue; KEEP cannot cross a seller turn',()=>{
  for(const action of ['wait','listen']){
    let held;const parser=new CoachOutput({mode:'simulation',turns:[buyer],onDelta:()=>assert.fail('No speech'),onHold:(reason,focus)=>{held={reason,focus};}});
    parser.append(JSON.stringify({roles:[],for:'seller',action,listen_for:'Whether the buyer continues'})+'\nWrong spoken sentence\n{}');parser.finish();
    assert.equal(held.reason,action); assert.equal(held.focus,'Whether the buyer continues');
  }
  const previousRecommendation={action:'suggest',text:'A previous suggestion',turnId:buyer.id};
  for(const [turns,expected] of [[[buyer],'keep'],[[buyer,{id:'rep',speaker:'seller',speakerSource:'native',text:'Done'},{...buyer,id:'b2'}],'wait']]){
    let held;const parser=new CoachOutput({mode:'simulation',turns,previousRecommendation,onDelta:()=>assert.fail(),onHold:r=>{held=r;}});
    parser.append('{"roles":[],"for":"seller","action":"keep"}\n\n{}');parser.finish();assert.equal(held,expected);
  }
});
test('baseline snapshot files are byte-exact and fixed suite has 15 unique cases',async()=>{
  const root=new URL('../evaluation/baseline/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  for(const [name,hash] of Object.entries(manifest.sha256)) assert.equal(createHash('sha256').update(await readFile(new URL(name,root))).digest('hex'),hash,name);
  const suite=await loadCases();assert.equal(suite.cases.length,15);assert.equal(new Set(suite.cases.map(c=>c.id)).size,15);
});
test('evaluator sends the real production request, isolates reviewer notes and captures actual output and separate objective',async()=>{
  const c=(await loadCases()).cases[0];const calls=[];
  const result=await evaluateOne(c,'current',{key:'test-only',fetcher:async(_url,options)=>{
    calls.push(JSON.parse(options.body));
    return Response.json({status:'completed',id:'mock-id',model:'mock-boundary',output:[{content:[{type:'output_text',text:calls.length===1?'{"roles":[],"for":"seller","action":"listen","listen_for":"Time available"}\n\n{}':'Respect the buyer’s limited attention.'}]}]});
  }});
  assert.deepEqual(calls[0],{...coachingRequest(c.payload),stream:false,store:false});
  assert.ok(!JSON.stringify(calls).includes(c.manual_review));
  assert.equal(result.action,'HOLD');assert.equal(result.spoken_line,'');assert.equal(result.status,'completed');assert.match(result.objective,/limited attention/);
  assert.equal(result.response_id,'mock-id');
});
test('request errors and no-key runs remain visibly unrun, never filled with invented recommendations',async()=>{
  const c=(await loadCases()).cases[0];
  const result=await evaluateOne(c,'current',{key:'test',fetcher:async()=>new Response('',{status:429})});
  assert.equal(result.status,'error');assert.equal(result.spoken_line,undefined);
  const directory=await mkdtemp(path.join(os.tmpdir(),'copilot-eval-'));
  try { const r=await runSuite({key:'',directory,extended:false,fetcher:()=>assert.fail()}); assert.equal(r.cases.length,15);assert.ok(r.cases.every(c=>c.results.length===0));assert.match(renderReport(r),/Not run/);assert.ok(!renderReport({...r,cases:[{...c,title:'<script>alert(1)</script>',results:[]}]}).includes('<script>')); }
  finally {await rm(directory,{recursive:true,force:true});}
});

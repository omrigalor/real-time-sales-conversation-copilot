import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { briefOverview, normalizeAccount } from '../app/account-context.js';
import { PreCallBrief } from '../app/brief.js';
import { researchedPandora, upgradePandoraBrief } from '../app/researched-pandora.js';
import { researchedTarget } from '../app/researched-target.js';
import { updateResearchLibrary } from '../app/account-seeds.js';

test('brief distinguishes a remaining pain hypothesis from historical problems and reported improvements',()=>{
  const account=researchedPandora(),view=briefOverview(account);
  assert.equal(account.demo,false);
  assert.equal(view.pain.kind,'hypothesis');
  assert.match(view.pain.text,/may still/);
  assert.equal(view.evidence.length,3);
  assert.ok(view.evidence.some(e=>e.id==='pandora-improvement'));
  assert.match(view.products[0].text,/already use/);assert.equal(view.products[0].productName,'Agentforce — expand existing use');
  assert.match(view.unknowns[0].text,/significant staff time/);
  const selected={...view.pain,evidenceIds:[],evidenceSelected:true,source:'https://example.com/source'};
  assert.equal(briefOverview({...account,entries:[selected,...view.facts]}).evidence.length,0);
  assert.equal(normalizeAccount({...account,entries:[selected]}).entries[0].source,selected.source);
});

test('research library upgrade preserves custom Target edits and does not add duplicate or overwrite Pandora',()=>{
  const target=researchedTarget();target.entries.find(e=>e.id==='target-hypothesis').text='My own hypothesis';
  const result=updateResearchLibrary({accountBrief:target,accountLibrary:[target],researchedDefaultVersion:1});
  assert.equal(result.accountBrief.company,'Pandora');
  assert.equal(result.accountLibrary.find(a=>a.company==='Target Corporation').entries.find(e=>e.id==='target-hypothesis').text,'My own hypothesis');
  assert.deepEqual(updateResearchLibrary(result),result);
  const edited={...researchedPandora(),size:'Human corrected size'};
  const custom=normalizeAccount({company:'Acme Manufacturing',person:'Jordan'});
  const existing=updateResearchLibrary({accountBrief:custom,accountLibrary:[edited,custom],researchedDefaultVersion:1});
  assert.equal(existing.accountBrief.company,custom.company);
  assert.equal(existing.accountLibrary.find(a=>a.company==='Pandora').size,'Human corrected size');
});

test('brief UI leads with pain and product, collapses sources, keeps edits and respects no-fit',async()=>{
  const win=new Window();win.document.write(readFileSync(new URL('../app/index.html',import.meta.url),'utf8').replace(/<script[^>]*>.*?<\/script>/gs,''));
  try{
    let focus;const account=researchedPandora();
    const brief=new PreCallBrief({document:win.document,bridge:{},initial:account,onSaved(){},getActive:()=>null,getProductFocus:()=>focus});
    brief.open();
    const content=win.document.getElementById('account-overview');
    assert.ok(content.textContent.indexOf('Most likely product to explore')<content.textContent.indexOf('Find out on the call'));assert.equal(content.querySelector('.brief-evidence').open,false);assert.equal(content.querySelectorAll('.brief-evidence .source-link').length,1);
    assert.equal(win.document.getElementById('brief-product').value,'Agentforce — expand existing use');
    const input=win.document.getElementById('brief-pain');input.value='An edited hypothesis';input.dispatchEvent(new win.Event('input'));
    assert.equal(brief.draft.entries.find(e=>e.id==='pandora-pain').text,'An edited hypothesis');
    assert.equal(win.document.querySelector('[data-entry-id="pandora-pain"]').value,'An edited hypothesis');
    brief.accepted=normalizeAccount(brief.draft);focus={product:'',reason:'No current product fit: buyer says their current tools cover the need.'};brief.renderOverview();
    assert.match(content.textContent,/No current product fit/);
    assert.equal(win.document.getElementById('brief-product').value,'');
    while(content.querySelector('input:checked')){const checkbox=content.querySelector('input:checked');checkbox.checked=false;checkbox.dispatchEvent(new win.Event('change'));}
    assert.equal(briefOverview(brief.draft).evidence.length,0);
  }finally{await win.happyDOM.close();}
});


test('plain-language Pandora migration preserves user edits, deletions and selected evidence',()=>{
  const old=researchedPandora();
  old.entries.find(e=>e.id==='pandora-pain').text='Some requests may still require enough manual work to strain service capacity. Whether this remains a material problem today is unconfirmed.';
  old.entries.find(e=>e.id==='pandora-pain').evidenceIds=['pandora-boundary'];
  old.entries.find(e=>e.id==='pandora-product').text='Agentforce expansion within existing service operations — hypothesis only. Validate a remaining gap and incremental licensing need; they already use the product. Optimization may suffice.';
  delete old.entries.find(e=>e.id==='pandora-product').productName;
  const migrated=upgradePandoraBrief(old);
  assert.match(briefOverview(migrated).pain.text,/order changes/);
  assert.equal(briefOverview(migrated).products[0].productName,'Agentforce — expand existing use');
  assert.deepEqual(briefOverview(migrated).pain.evidenceIds,['pandora-boundary']);
  const edited=structuredClone(old);edited.entries.find(e=>e.id==='pandora-pain').text='My researched issue';edited.entries=edited.entries.filter(e=>e.id!=='pandora-product');
  const kept=upgradePandoraBrief(edited);assert.equal(briefOverview(kept).pain.text,'My researched issue');assert.equal(briefOverview(kept).products.length,0);
});
test('editing the leading product preserves a separate accepted brief until Save',async()=>{
  const win=new Window();win.document.write(readFileSync(new URL('../app/index.html',import.meta.url),'utf8').replace(/<script[^>]*>.*?<\/script>/gs,''));
  try{
    const brief=new PreCallBrief({document:win.document,bridge:{},initial:researchedPandora(),onSaved(){},getActive:()=>null});brief.open();
    const input=win.document.getElementById('brief-product');input.value='Service Cloud';input.dispatchEvent(new win.Event('input'));
    assert.equal(briefOverview(brief.draft).products[0].productName,'Service Cloud');
    assert.equal(briefOverview(brief.accepted).products[0].productName,'Agentforce — expand existing use');
    assert.doesNotMatch(briefOverview(brief.draft).products[0].text,/already use Agentforce/);
  }finally{await win.happyDOM.close();}
});

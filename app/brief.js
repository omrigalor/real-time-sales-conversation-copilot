import { ACCOUNT_FIELDS, normalizeAccount, briefOverview } from './account-context.js';

export class PreCallBrief {
  constructor({document,bridge,initial,onSaved,getActive,getProductFocus=()=>undefined}) {
    Object.assign(this,{document,bridge,onSaved,getActive,getProductFocus});
    this.accepted=normalizeAccount(initial);this.draft=normalizeAccount(this.accepted)||normalizeAccount({});this.revision=0;
    this.$=id=>document.getElementById(id);
    this.$('account-button').onclick=()=>this.open();
    this.$('close-account').onclick=()=>this.$('account-dialog').close();
    this.$('new-account').onclick=()=>{this.draft=normalizeAccount({demo:false});this.revision++;this.render();};
    this.$('add-account-fact').onclick=()=>{if(this.draft.entries.length>=16){this.status('Keep the brief to 16 useful facts. Remove or consolidate a detail first.');return;}this.draft.entries.push({id:crypto.randomUUID(),kind:'user',text:'',important:false,source:''});this.revision++;this.renderEntries();};
    this.$('save-account').onclick=()=>this.save(false);
    this.$('apply-active-account').onclick=()=>this.save(true);
    this.$('research-account').onclick=()=>this.research();
  }
  open() {this.render();this.$('account-dialog').showModal();}
  render() {
    this.$('account-demo-note').hidden=false;
    this.$('account-status').textContent='';this.$('research-results').replaceChildren();
    this.$('account-basic').replaceChildren();this.$('account-extra').replaceChildren();
    for(const [key,label] of ACCOUNT_FIELDS) {
      const wrap=this.document.createElement('label');wrap.textContent=label;
      const input=this.document.createElement(key==='notes'?'textarea':'input');input.id=`account-${key}`;input.value=this.draft[key]||'';input.maxLength=key==='notes'?1000:300;input.placeholder='Unknown / not supplied';
      input.oninput=()=>{this.draft[key]=input.value;delete this.draft.fieldSources[key];sourceNote?.remove();this.revision++;};
      let sourceNote=null;
      wrap.append(input);
      if(this.draft.fieldSources[key]){const source=this.draft.fieldSources[key];sourceNote=this.document.createElement('button');sourceNote.className='text-button source-link';sourceNote.textContent=`Source · ${source.sourceTitle||'Public research'} · ${source.checkedAt?.slice(0,10)||''}`;sourceNote.type='button';sourceNote.onclick=()=>this.bridge.openSource(source.source).catch(error=>this.status(error.message));wrap.append(sourceNote);}
      this.$(['company','person','buyerRole','callType','objective'].includes(key)?'account-basic':'account-extra').append(wrap);
    }
    this.renderEntries();
    const active=this.getActive();this.$('apply-active-account').hidden=!active || active.mode!=='speakerphone';
    this.$('save-account').textContent=active?'Save account for next call':'Save & use account';
    this.$('account-active-note').textContent=active?'The current call keeps its snapshot. Only “Apply edits to this call” changes live context.':'Field values are user provided. Mark hypotheses and unknowns separately.';
  }
  renderEntries() {
    this.renderOverview();
    const container=this.$('account-entries');container.replaceChildren();
    this.draft.entries.forEach((entry,index)=>{
      const row=this.document.createElement('div');row.className='account-entry';
      const kind=this.document.createElement('select');kind.setAttribute('aria-label','Evidence type');
      for(const [value,label] of [['user','User provided'],['public','Public source · review'],['hypothesis','Hypothesis'],['unknown','Unknown']]) {const option=this.document.createElement('option');option.value=value;option.textContent=label;option.disabled=value==='public'&&!entry.source;kind.append(option);}
      kind.value=entry.kind;kind.onchange=()=>{entry.kind=kind.value;this.revision++;this.renderOverview();};
      const text=this.document.createElement('textarea');text.dataset.entryId=entry.id;text.value=entry.text;text.rows=2;text.maxLength=350;text.setAttribute('aria-label','Account fact or hypothesis');
      text.oninput=()=>{entry.text=text.value;this.revision++;if(entry.kind==='public'){entry.kind='user';kind.value='user';}this.renderOverview();};
      const important=this.document.createElement('button');important.className='text-button';important.textContent=entry.important?'★':'☆';important.title='Mark important';important.setAttribute('aria-pressed',String(entry.important));
      important.onclick=()=>{entry.important=!entry.important;this.revision++;this.renderEntries();};
      const remove=this.document.createElement('button');remove.className='text-button';remove.textContent='Remove';remove.onclick=()=>{this.draft.entries.splice(index,1);this.revision++;this.renderEntries();};
      row.append(kind,important,remove,text);
      if(entry.source) {const link=this.document.createElement('button');link.className='source-link text-button';link.textContent=`Source: ${entry.sourceTitle||entry.source}`;link.onclick=()=>this.bridge.openSource(entry.source).catch(error=>this.status(error.message));row.append(link);}
      container.append(row);
    });
  }
  renderOverview() {
    const container=this.$('account-overview');container.replaceChildren();
    const view=briefOverview(this.draft);
    const heading=this.document.createElement('h3');heading.textContent='Possible problem';
    const tag=this.document.createElement('span');tag.className='hypothesis-label';tag.textContent='Working hypothesis · not yet confirmed';
    container.append(heading,tag);
    const painChoices=view.hypotheses.filter(e=>e.purpose!=='product');
    if(painChoices.length>1){
      const choose=this.document.createElement('select');choose.id='brief-primary-hypothesis';choose.setAttribute('aria-label','Primary pain hypothesis');
      for(const entry of painChoices){const option=this.document.createElement('option');option.value=entry.id;option.textContent=entry.text.slice(0,90);choose.append(option);}
      choose.value=view.pain?.id||'';choose.onchange=()=>{this.draft.primaryHypothesisId=choose.value;this.revision++;this.renderOverview();};container.append(choose);
    }
    const statement=this.document.createElement('textarea');statement.id='brief-pain';statement.rows=2;statement.maxLength=350;statement.setAttribute('aria-label','Working pain hypothesis');statement.placeholder='What might be hurting this buyer? Keep it a hypothesis until confirmed.';statement.value=view.pain?.text||'';
    statement.oninput=()=>{
      let entry=view.pain;
      if(!entry){if(this.draft.entries.length>=16){this.status('Remove a detail before adding a new hypothesis.');return;}entry={id:crypto.randomUUID(),kind:'hypothesis',purpose:'pain',text:'',important:true,source:'',evidenceIds:[]};this.draft.entries.push(entry);view.pain=entry;}
      const actual=this.draft.entries.find(e=>e.id===entry.id);actual.text=statement.value;actual.kind='hypothesis';actual.purpose='pain';this.draft.primaryHypothesisId=actual.id;this.revision++;
      for(const input of this.$('account-entries').querySelectorAll('textarea'))if(input.dataset.entryId===actual.id)input.value=actual.text;
    };
    container.append(statement);
    const section=(title,text)=>{const h=this.document.createElement('h4');h.textContent=title;container.append(h);if(text){const p=this.document.createElement('p');p.textContent=text;container.append(p);}};
    const focus=JSON.stringify(normalizeAccount(this.draft))===JSON.stringify(this.accepted)?this.getProductFocus(this.draft):undefined;
    const product=view.products.find(e=>e.productName)||view.products[0];
    const chosen=focus!==undefined?focus?.product:product?.productName;
    const label=this.document.createElement('label');label.className='brief-product-heading';label.textContent='Most likely product to explore';label.htmlFor='brief-product';container.append(label);
    const productInput=this.document.createElement('input');productInput.id='brief-product';productInput.className='brief-product-name';productInput.maxLength=90;productInput.value=chosen||'';productInput.placeholder=focus!==undefined?'No current product fit':'Add a leading product hypothesis';
    productInput.oninput=()=>{
      let entry=this.draft.entries.find(e=>e.id===product?.id);
      if(!entry){if(this.draft.entries.length>=16){this.status('Remove a detail before adding a product hypothesis.');return;}entry={id:crypto.randomUUID(),purpose:'product',kind:'hypothesis',important:true,text:'',source:''};this.draft.entries.push(entry);}
      entry.productName=productInput.value;entry.text=productInput.value?`Explore ${productInput.value}. Confirm the need and fit with the buyer.`:'';this.revision++;
      for(const input of this.$('account-entries').querySelectorAll('textarea'))if(input.dataset.entryId===entry.id)input.value=entry.text;
      productReason.textContent=entry.text||'No product hypothesis selected.';
    };
    container.append(productInput);
    const productReason=this.document.createElement('p');productReason.className='brief-product-reason';
    productReason.textContent=focus!==undefined?(focus?.reason||'No current product fit established.'):(product?.text||'Research the account or add a product hypothesis.');container.append(productReason);
    section('Find out on the call',focus?.validate || (view.unknowns.length?view.unknowns.map(e=>e.text).join(' '):'Does this problem matter enough to address?'));
    const evidenceDetails=this.document.createElement('details');evidenceDetails.className='brief-evidence';
    const evidenceSummary=this.document.createElement('summary');evidenceSummary.textContent=`Why this hypothesis · evidence & sources (${view.evidence.length})`;evidenceDetails.append(evidenceSummary);
    if(!view.evidence.length){const p=this.document.createElement('p');p.textContent='No supporting signal linked yet. This is an untested idea.';evidenceDetails.append(p);}
    const sourceLinks=new Map();
    for(const entry of view.evidence){
      const p=this.document.createElement('p');p.textContent=entry.kind==='public'?entry.text:`User provided: ${entry.text}`;evidenceDetails.append(p);
      if(entry.source)sourceLinks.set(entry.source,entry.sourceTitle||'View source');
    }
    for(const [url,title] of sourceLinks){const link=this.document.createElement('button');link.className='text-button source-link';link.textContent=title;link.onclick=()=>this.bridge.openSource(url).catch(error=>this.status(error.message));evidenceDetails.append(link);}
    container.append(evidenceDetails);
    if(view.pain && view.facts.length){
      const details=this.document.createElement('details'),summary=this.document.createElement('summary');summary.textContent='Choose supporting signals';details.append(summary);
      for(const entry of view.facts){
        const label=this.document.createElement('label'),check=this.document.createElement('input');check.type='checkbox';check.checked=view.evidence.some(e=>e.id===entry.id);
        check.onchange=()=>{const selected=Array.from(details.querySelectorAll('input:checked')).map(c=>c.value);const actual=this.draft.entries.find(e=>e.id===view.pain.id);actual.evidenceIds=selected;actual.evidenceSelected=true;this.revision++;this.renderOverview();};check.value=entry.id;label.append(check,this.document.createTextNode(entry.text));details.append(label);
      }
      container.append(details);
    }

  }
  status(text) {this.$('account-status').textContent=text;}
  async save(toActive) {
    try {
      const value=normalizeAccount(this.draft);
      if(toActive&&value.demo) throw new Error('Fictional demo information cannot be applied to a real call. Create a real brief instead.');
      this.accepted=await this.bridge.saveAccount(value);this.draft=normalizeAccount(this.accepted);this.onSaved(this.accepted,toActive);
      this.$('account-dialog').close();
    } catch(error) {this.status(error.message);}
  }
  async research() {
    const revision=this.revision;
    this.$('research-account').disabled=true;this.status('Researching public sources… Your accepted brief stays unchanged.');
    try {
      const result=await this.bridge.research(normalizeAccount(this.draft));
      if(revision!==this.revision) {this.status('Inputs changed while researching. Run research again for the updated person/company.');return;}
      let filled=0;
      const conflicts=[];
      for(const field of result.fields||[]) {
        if(!ACCOUNT_FIELDS.some(([key])=>key===field.field))continue;
        if(!this.draft[field.field]){this.draft[field.field]=field.value;this.draft.fieldSources[field.field]={...field};filled++;}
        else if(this.draft[field.field]!==field.value) conflicts.push(field);
      }
      if(filled)this.revision++;
      this.render();
      this.status(`${filled ? `Filled ${filled} supported fields in your editable draft. ` : ''}Review findings before saving. ${(result.coverageGaps||[]).join(' ')}`);

      const container=this.$('research-results');container.replaceChildren();const checks=[];
      for(const field of conflicts){
        const row=this.document.createElement('p');row.textContent=`Research suggests ${field.field}: ${field.value}. Your existing value was kept. `;
        const source=this.document.createElement('button');source.className='text-button source-link';source.textContent='Source';source.onclick=()=>this.bridge.openSource(field.source).catch(error=>this.status(error.message));
        const use=this.document.createElement('button');use.className='text-button';use.textContent='Use researched value';use.onclick=()=>{this.draft[field.field]=field.value;this.draft.fieldSources[field.field]={...field};this.revision++;this.$('account-'+field.field).value=field.value;row.textContent='Researched value applied to draft.';};row.append(source,use);container.append(row);
      }

      for(const entry of result.entries) {
        const row=this.document.createElement('div');row.className='research-result';
        const label=this.document.createElement('label'),check=this.document.createElement('input');check.type='checkbox';check.checked=true;
        label.append(check,this.document.createTextNode(`${entry.kind==='public'?'Public source':entry.kind==='hypothesis'?'Hypothesis':'Unknown'}: ${entry.text}`));row.append(label);
        if(entry.source) {const link=this.document.createElement('button');link.className='text-button source-link';link.textContent=entry.sourceTitle||entry.source;link.onclick=()=>this.bridge.openSource(entry.source).catch(error=>this.status(error.message));row.append(link);}
        checks.push({check,entry});container.append(row);
      }
      const add=this.document.createElement('button');add.className='primary-button';add.textContent='Add selected findings';add.onclick=()=>{const selected=checks.filter(c=>c.check.checked).map(c=>c.entry);if(this.draft.entries.length+selected.length>16){this.status('Select fewer findings or remove existing details: the brief holds 16 useful facts.');return;}this.draft.entries=[...this.draft.entries,...selected];this.revision++;container.replaceChildren();this.renderEntries();this.status('Draft updated. Edit as needed, then use or save the brief.');};container.append(add);
      return result;
    } catch(error) {this.status(error.message);}
    finally {this.$('research-account').disabled=false;}
  }
}

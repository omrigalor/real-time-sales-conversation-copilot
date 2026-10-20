export const BUYER_VOICES = [['ash', 'Masculine · Ash'], ['marin', 'Feminine · Marin'], ['alloy', 'Neutral · Alloy']];
// Cedar was the previous masculine buyer preset. Upgrade saved accounts too.
export const normalizeBuyerVoice = value => value==='cedar' ? 'ash' : BUYER_VOICES.some(([id])=>id===value) ? value : '';
export function buyerVoiceDelivery(value) {
  const voice=normalizeBuyerVoice(value);
  const casting=voice==='ash'?'Use a consistently masculine adult voice in a comfortable lower register.':voice==='marin'?'Use a consistently feminine adult voice.':'Maintain the selected neutral voice.';
  return `VOICE DELIVERY: ${casting} Keep ordinary conversational intonation and natural variation without exaggeration. Preserve your assigned voice through greetings, objections and connection checks; do not imitate the caller’s vocal register or switch speaking persona. This is synthetic role-play casting, not an imitation of a real individual.`;
}
export const ACCOUNT_FIELDS = [
  ['company','Company'], ['person','Person'], ['buyerRole','Role / seniority'], ['industry','Industry'],
  ['size','Size / segment'], ['relationship','Salesforce relationship'], ['products','Products already used'],
  ['callType','Call type / stage'], ['objective','Call objective'], ['notes','Prior interactions / your notes'],
];
export const cleanText = (value, limit = 400) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
export function publicURL(value) {
  try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password && !/^(localhost|127\.|0\.|\[|.*\.local$)/i.test(url.hostname) ? url.href : ''; } catch { return ''; }
}
export function normalizeAccount(value) {
  if (!value || typeof value !== 'object') return null;
  const fields=Object.fromEntries(ACCOUNT_FIELDS.map(([key])=>[key,cleanText(value[key],key==='notes'?1000:300)]));
  const fieldSources=Object.fromEntries(ACCOUNT_FIELDS.filter(([key])=>value.fieldSources?.[key]?.value===fields[key] && publicURL(value.fieldSources[key].source)).map(([key])=>{
    const record=value.fieldSources[key];
    return [key,{value:fields[key],source:publicURL(record.source),sourceTitle:cleanText(record.sourceTitle,120),checkedAt:cleanText(record.checkedAt,40),evidence:cleanText(record.evidence,500)}];
  }));
  return {...fields,buyerVoice:normalizeBuyerVoice(value.buyerVoice),primaryHypothesisId:cleanText(value.primaryHypothesisId,60),fieldSources,demo:value.demo===true, entries:(Array.isArray(value.entries)?value.entries:[]).slice(0,16).map((entry,index)=>({
    id:cleanText(entry.id,60)||`fact-${index}`, purpose:['pain','product'].includes(entry.purpose)?entry.purpose:'', productName:entry.purpose==='product'?cleanText(entry.productName,90):'', evidenceSelected:entry.evidenceSelected===true, evidenceIds:(Array.isArray(entry.evidenceIds)?entry.evidenceIds:[]).filter(x=>typeof x==='string').slice(0,8), text:cleanText(entry.text,350),
    kind:['public','user','hypothesis','unknown'].includes(entry.kind)?entry.kind:'user', important:entry.important===true,
    source:publicURL(entry.source), sourceTitle:cleanText(entry.sourceTitle,120), checkedAt:cleanText(entry.checkedAt,40),
  })).filter(entry=>entry.text).map(entry=>entry.kind==='public'&&!entry.source?{...entry,kind:'user'}:entry)};
}
export function accountForCall(value, mode) {
  const account=normalizeAccount(value);
  if (!account || (!ACCOUNT_FIELDS.some(([key])=>account[key]) && !account.entries.length) || (mode==='speakerphone'&&account.demo)) return null;
  // Detached snapshot: research drafts cannot mutate active call context.
  const snapshot=JSON.parse(JSON.stringify(account));
  delete snapshot.buyerVoice; // Playback setting is not seller/account intelligence.
  return snapshot;
}
export function demoAccount() {
  return normalizeAccount({demo:true,buyerVoice:'marin',company:'Northstar Retail Group',person:'Maya Chen',buyerRole:'VP, Customer Experience',industry:'Retail',size:'About 18,000 employees',relationship:'Existing Salesforce customer (fictional)',products:'Service Cloud, Sales Cloud',callType:'BDR cold outbound',objective:'Establish relevance and whether further conversation is useful.',entries:[
    {id:'footprint',kind:'user',text:'Existing Service Cloud customer in this fictional exercise.',important:true},
    {id:'trigger',kind:'user',text:'Guest-service operating costs rose while ecommerce order volume grew (fictional trigger).'},
    {id:'hypothesis',kind:'hypothesis',text:'Agents may lose time retrieving order and delivery information outside the service workflow.'},
    {id:'owners',kind:'hypothesis',text:'Service Operations, Order Management and IT may be relevant stakeholders.'},
    {id:'unknowns',kind:'unknown',text:'Frequency, cost impact, urgency, ownership and whether the issue matters enough to change.'},
    {id:'areas',kind:'hypothesis',text:'Service Cloud workflows and integration capabilities may be relevant; validate before proposing products.'},
  ]});
}

// Present existing evidence; never infer a pain from a product or promote a guess.
export function briefOverview(value) {
  const account=normalizeAccount(value);
  const entries=account?.entries||[];
  const hypotheses=entries.filter(e=>e.kind==='hypothesis');
  const pain=hypotheses.find(e=>e.id===account.primaryHypothesisId)||hypotheses.find(e=>e.purpose==='pain')||hypotheses.find(e=>e.purpose!=='product');
  const facts=entries.filter(e=>['public','user'].includes(e.kind));
  const evidence=pain ? (pain.evidenceSelected || pain.evidenceIds.length ? facts.filter(e=>pain.evidenceIds.includes(e.id)) : facts.filter(e=>pain.source && e.kind==='public' && e.source===pain.source)) : [];
  return {pain,evidence,unknowns:entries.filter(e=>e.kind==='unknown'),products:hypotheses.filter(e=>e.purpose==='product'),hypotheses,facts};
}

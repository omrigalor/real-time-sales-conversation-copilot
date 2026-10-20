import { PRODUCTS } from './product-catalog.js';
// Provider boundary: replace this adapter with approved documentation retrieval
// later, without changing seller reasoning or the UI source schema.
export function productKnowledge() {
  return PRODUCTS.map(([name, capability, url],index)=>({id:`sf-${index+1}`,name,capability,url,checkedAt:'2026-09-28',scope:'High-level capability only; verify edition, integration, security, pricing and contractual details.'}));
}
export function productReference() {
  return `CONTROLLED SALESFORCE PRODUCT BASIS\n${productKnowledge().map(p=>`[${p.id}] ${p.name}: ${p.capability}`).join('\n')}\nThese summaries support high-level capability explanations, not specific entitlements, connector compatibility, contractual commitments, security guarantees, discounts or implementation estimates. Answer confidently within supplied evidence. If detail is absent, give the useful supported part and propose confirming the unresolved detail; do not repeatedly hedge well-supported facts. Do not invent a claim and attach a vaguely related source. No product claim is required every turn.`;
}
export const SUPPORT_PROTOCOL = `OPTIONAL EXPLANATION / PRODUCT BASIS (final insights JSON)
Include "support":{"why":{"reason":"one brief factual decision rationale, NOT private reasoning","evidence":[{"turn":0,"quote":"exact observed words"}]},"products":["sf-id"]}.
Explain briefly what observable fact makes this move useful; no hidden chain-of-thought, invented motives or causal certainty. Require actual transcript evidence for why; if unavailable, omit why. For factual Salesforce claims in the spoken line, cite only IDs from the controlled product basis that actually support them. Leave products empty for no product claim. Broad capability summaries cannot support exact pricing, security guarantees, contractual promises or arbitrary integrations; explicitly qualify or defer those details when unsupported. These IDs are private metadata, not words to say aloud.`;
export function readSupport(value, turns) {
  if(!value || typeof value!=='object') return null;
  const evidence=(Array.isArray(value.why?.evidence)?value.why.evidence:[]).filter(e=>Number.isInteger(e.turn)&&typeof e.quote==='string'&&e.quote.trim().length>=3&&turns[e.turn]?.text.toLowerCase().includes(e.quote.trim().toLowerCase())).slice(0,2).map(e=>({quote:e.quote.trim().slice(0,220),turnId:turns[e.turn].id}));
  const ids=Array.isArray(value.products)?value.products:[];
  return {why:evidence.length&&typeof value.why?.reason==='string'?{reason:value.why.reason.trim().slice(0,240),evidence}:null,products:productKnowledge().filter(p=>ids.includes(p.id)).slice(0,3)};
}

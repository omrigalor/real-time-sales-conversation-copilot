import { normalizeAccount } from './account-context.js';
const checkedAt='2026-09-29';
const annual='https://corporate.target.com/investors/annual/2025-annual-report/10-k-report/10-k-part-i/item-1-business';
const results='https://corporate.target.com/press/release/2026/08/target-corporation-reports-second-quarter-earnings';
const call='https://corporate.target.com/getmedia/d01cb805-63cb-4150-bae4-8d717f0d9ed3/Q2-2026-Target-Corp-Earnings-Call.pdf';
const bio='https://corporate.target.com/about/leadership-team/mark-weinstein';
const ai='https://corporate.target.com/press/fact-sheet/2026/06/conversational-ai';
const api='https://www.salesforce.com/mulesoft/agentforce/';
const service='https://www.salesforce.com/service/cloud/';
const field=(value,source,sourceTitle)=>({value,source,sourceTitle,checkedAt});
const entry=(id,text,kind,source='',sourceTitle='')=>({id,text,kind,source,sourceTitle,checkedAt,important:true});
export function researchedTarget() {return normalizeAccount({
  primaryHypothesisId:'target-hypothesis', buyerVoice:'ash', company:'Target Corporation', person:'Mark Weinstein', buyerRole:'EVP and Chief Marketing and Guest Experience Officer',
  industry:'General merchandise retail',size:'Approximately 415,000 full-time, part-time and seasonal employees as of January 31, 2026',
  relationship:'Existing Salesforce customer (user provided; public research did not establish exact products).',
  products:'Service Cloud (practice assumption, NOT verified). Other products and editions unknown; confirm before a real sales claim.',
  callType:'',objective:'Explore whether guest-experience growth creates a meaningful unmet need; validate the existing stack before proposing an upsell.',
  notes:'Research checked September 29, 2026. Company, named executive and sourced facts are real. AI dialogue, temperament, availability and any practice meeting are invented for role-play, not statements by Mark Weinstein. Customer relationship is user provided. Service Cloud ownership is assumed for practice, not publicly verified. No private CRM access. No verified rising guest-service cost claim.',
  fieldSources:{company:field('Target Corporation',annual,'Target 2025 Form 10-K'),industry:field('General merchandise retail',annual,'Target 2025 Form 10-K'),size:field('Approximately 415,000 full-time, part-time and seasonal employees as of January 31, 2026',annual,'Target 2025 Form 10-K'),person:field('Mark Weinstein',bio,'Target executive biography'),buyerRole:field('EVP and Chief Marketing and Guest Experience Officer',bio,'Target executive biography')},
  entries:[
    entry('target-growth','Q2 2026: digital comparable sales grew 8.7%; same-day delivery grew more than 25%. Growth does not establish service friction.','public',results,'Target Q2 2026 earnings release · Aug 19'),
    entry('target-businesses','Q2 2026: non-merchandise sales grew 20.1%, with strength in Roundel, Circle 360 and Target Plus.','public',results,'Target Q2 2026 earnings release'),
    entry('target-progress','Q2 earnings commentary reported improving inventory reliability and guest satisfaction alongside continued technology investment. Do not pitch a failing operation as fact.','public',call,'Target Q2 2026 earnings call · Aug 19'),
    entry('target-ai','Target already offers shopping experiences through Google/Gemini, Microsoft Copilot and OpenAI ChatGPT. Establish what its existing capabilities already solve.','public',ai,'Target conversational AI fact sheet · Jun 18'),
    entry('target-role','Mark Weinstein leads marketing, brand, loyalty, guest experience and digital, including Roundel and Target Plus. Detailed operational ownership must still be confirmed.','public',bio,'Target executive biography'),
    {...entry('target-hypothesis','Agents may spend extra time resolving delivery questions as order volume grows. Extra work, higher service cost and buyer concern are not confirmed.','hypothesis',results,'Hypothesis prompted by Q2 growth; not a reported workflow problem'),purpose:'pain',evidenceIds:['target-growth']},
    {purpose:'product',...entry('target-integration','Possible fit only if an unmet integration need emerges: MuleSoft can expose APIs and actions to Agentforce. Existing architecture, access, licensing and incremental value need validation.','hypothesis',api,'Salesforce MuleSoft for Agentforce · product basis, not Target fit evidence')},
    {purpose:'product',...entry('target-service','Possible fit only if a service gap is confirmed: Service Cloud / Agentforce Service capabilities may support service workflows. No claim of Target ownership, implementation fit or cost reduction.','hypothesis',service,'Salesforce Service Cloud · product basis, not Target fit evidence')},
    entry('target-footprint','The user identifies Target as an existing Salesforce customer. Service Cloud ownership is an explicit practice assumption, not a researched fact; confirm actual products before proposing an upsell.','hypothesis'),
    entry('target-unknown','Unknown: current CRM/service tools, integration ownership, exception frequency, business impact, urgency, budget and whether existing initiatives already solve the issue.','unknown'),
    entry('target-discovery','Worth learning: where guest context is lost, if anywhere; what the team already handles well; whether any remaining gap matters. Select a relevant thread, not a checklist.','hypothesis'),
  ]
});}

// Upgrade only untouched authored content; human edits remain authoritative.
export function upgradeTargetBrief(value) {
  const account=normalizeAccount(value);
  if(account?.company!=='Target Corporation' || account.person!=='Mark Weinstein')return account;
  const defaults=researchedTarget();
  const old='Hypothesis: growing delivery and channel variety may create exceptions or context handoffs worth investigating. Frequency, friction and buyer concern are not confirmed.';
  account.entries=account.entries.map(e=>e.id==='target-hypothesis'&&e.text===old?defaults.entries.find(d=>d.id===e.id):e);
  if(!account.primaryHypothesisId && account.entries.some(e=>e.id==='target-hypothesis'))account.primaryHypothesisId='target-hypothesis';
  for(const e of account.entries)if(!e.purpose&&['target-service','target-integration'].includes(e.id)&&defaults.entries.some(d=>d.id===e.id&&d.text===e.text))e.purpose='product';
  return account;
}

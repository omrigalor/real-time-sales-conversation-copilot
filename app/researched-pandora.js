import { normalizeAccount } from './account-context.js';
const story='https://www.salesforce.com/customer-stories/pandora/';
const company='https://www.pandoragroup.com/news/27746';
const checkedAt='2026-09-30';
const field=(value,source=story)=>({value,source,sourceTitle:source===story?'Salesforce customer story · October 2025':'Pandora company announcement · January 2026',checkedAt});
const entry=(id,text,kind,extra={})=>({id,text,kind,important:true,checkedAt,...extra});
const evidence={source:story,sourceTitle:'Salesforce customer story · October 2025'};
export function researchedPandora(){
  const products='Agentforce, Service Cloud, Commerce Cloud, Data 360, MuleSoft, Loyalty Management (reported October 2025; current scope unverified).';
  return normalizeAccount({
    company:'Pandora',person:'David Walmsley',buyerRole:'Chief Digital & Technology Officer (reported October 2025; reconfirm)',buyerVoice:'ash',
    industry:'Jewellery retail',size:'Approximately 37,000 employees (January 2026)',
    relationship:'Publicly documented Salesforce customer',products,callType:'',
    objective:'Learn whether any remaining service workload justifies expanding existing capabilities.',
    primaryHypothesisId:'pandora-pain',
    notes:'Real account; sourced executive identity, not a recording or prediction of that person. AI personality, dialogue, availability and private buying conditions are role-play assumptions. The October 2025 story describes both historical problems and improvements. Do not portray those historical problems as unresolved today. No verified new buying project, budget or license gap. Public research checked September 30, 2026.',
    fieldSources:{company:field('Pandora'),person:field('David Walmsley'),buyerRole:field('Chief Digital & Technology Officer (reported October 2025; reconfirm)'),industry:field('Jewellery retail'),size:field('Approximately 37,000 employees (January 2026)',company),relationship:field('Publicly documented Salesforce customer'),products:field(products)},
    entries:[
      entry('pandora-history','In 2024, holiday customer enquiries overwhelmed the service team, even with seasonal staff.','public',evidence),
      entry('pandora-improvement','By October 2025, Agentforce was handling routine questions and deflecting 60% of cases.','public',evidence),
      entry('pandora-boundary','The October 2025 story says order changes still went to people. AI service was expanding into more markets.','public',evidence),
      entry('pandora-pain','Staff may still spend too much time on order changes that the AI hands over to them.','hypothesis',{purpose:'pain',evidenceIds:['pandora-history','pandora-improvement','pandora-boundary']}),
      entry('pandora-unknown','Do order changes still take significant staff time, and does Pandora want to reduce it?','unknown'),
      entry('pandora-product','They already use Agentforce. Explore whether extending it to more service tasks could reduce manual work. Confirm safe scope and whether existing licences cover it; an extra purchase may not be needed.','hypothesis',{purpose:'product',productName:'Agentforce — expand existing use'}),
    ]
  });
}

// Migrate only untouched stock wording. Never replace a user's edited or removed entry.
export function upgradePandoraBrief(value) {
  const account=normalizeAccount(value);
  if(!account || account.company!=='Pandora' || account.person!=='David Walmsley')return account;
  const oldText=["Historical: holiday inquiry volumes exceeded service capacity in 2024.", "Reported improvement: Agentforce handled routine inquiries; the story reports 60% case deflection.", "The story describes order changes being handed to people and a staged market rollout. Current coverage is unknown.", "Some requests may still require enough manual work to strain service capacity. Whether this remains a material problem today is unconfirmed.", "Confirm remaining request types, volume, time spent, current rollout, existing entitlements, buyer priority, budget and ownership. No additional purchase may be needed.", "Agentforce expansion within existing service operations — hypothesis only. Validate a remaining gap and incremental licensing need; they already use the product. Optimization may suffice."];
  const seed=researchedPandora();
  for(const entry of account.entries){
    const replacement=seed.entries.find(e=>e.id===entry.id);
    if(replacement && oldText.includes(entry.text)){entry.text=replacement.text;if(replacement.productName)entry.productName=replacement.productName;}
  }
  return account;
}

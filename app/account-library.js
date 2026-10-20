import { normalizeAccount } from './account-context.js';
export const accountKey = account => `${account?.company?.trim().toLowerCase() || ''}|${account?.person?.trim().toLowerCase() || ''}`;
export function normalizeLibrary(values) {
  const result=new Map();
  for(const value of Array.isArray(values)?values:[]) {const account=normalizeAccount(value);if(account?.company&&!account.demo)result.set(accountKey(account),account);}
  return [...result.values()].slice(-100);
}
export function saveToLibrary(values,account) {return normalizeLibrary([...normalizeLibrary(values).filter(a=>accountKey(a)!==accountKey(account)),account]);}
export function trainingAccount(value,role,stage='all') {
  const account=normalizeAccount(value);if(!account)return null;
  // Call setup is an exercise assumption, never a researched customer fact.
  const stages={discovery:'scheduled discovery',demo:'scheduled solution demonstration',evaluation:'solution evaluation',business_case:'business-case exploration',commercial:'commercial discussion',follow_up:'follow-up',closing:'next-step / decision discussion'};
  account.callType=role==='AE'?`${stages[stage]||'scheduled discovery'} (practice setup; meeting not verified)`:'unexpected outbound (practice setup; no prior permission assumed)';
  account.objective=role==='AE'?'Explore the relevant business outcome and actual gaps at this stage; progress only when warranted.':'Earn attention, test relevance and qualify whether a useful next step exists.';
  return account;
}

// Fill missing playback settings only from a matching authored profile, never
// infer gender from a name or overwrite a user's explicit voice selection.
export function inheritProfileVoice(value, profiles) {
  const account=normalizeAccount(value);
  if(!account || account.buyerVoice)return account;
  const profile=profiles.find(p=>accountKey(p)===accountKey(account));
  return normalizeAccount({...account,buyerVoice:profile?.buyerVoice});
}

import { accountForCall } from './account-context.js';
import { getScenario } from './scenarios.js';

// One projection for Settings and requests. Never borrow a training account for live calls.
export function callContext(selection = {}) {
  const mode = selection.mode === 'speakerphone' ? 'speakerphone' : 'simulation';
  const role = selection.salesRole === 'AE' ? 'AE' : 'BDR';
  const account = accountForCall(selection.accountContext, mode);
  const scenario = mode === 'simulation' && !account ? getScenario(selection.scenarioId) : null;
  const company = account?.company || scenario?.company || 'Not specified';
  const person = account?.person || scenario?.contact || 'Not specified';
  const callType = account?.callType || scenario?.callType || 'Not specified — infer from the conversation';
  const scope = JSON.stringify([mode, role, account ? ['account', account.company, account.person, account.callType] : scenario ? ['scenario', scenario.id] : ['live', 'unassigned']]);
  const objective = account?.objective || scenario?.objective;
  const summary = [
    `Salesforce ${role} · ${mode === 'speakerphone' ? 'Real call' : 'Fictional training scenario'}`,
    `Company: ${company}. Contact: ${person}.`,
    `Call context: ${callType}.`,
    `Relationship: ${account?.relationship || scenario?.relationship || 'Unknown'}`,
    role === 'AE' ? 'Role objective: Progress a legitimate opportunity at the appropriate stage; a close is not required on every call.' : 'Role objective: Establish relevance, qualify legitimate pipeline and earn an appropriate next step; disqualification can be useful.',
    objective ? `Call objective: ${objective}` : 'Call objective: Establish what would make this conversation useful.',
    'Account assumptions remain provisional; the actual conversation takes priority.',
  ].join('\n');
  return { scope, summary };
}

export function scopedSalesContext(selection, notes = {}) {
  const { scope, summary } = callContext(selection);
  const extra = Object.hasOwn(notes, scope) && typeof notes[scope] === 'string' ? notes[scope].slice(0, 3000) : '';
  return summary + (extra.trim() ? `\nUser notes for this setup (not verified facts):\n${extra}` : '');
}

export function normalizeContextNotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([scope, note]) => scope.startsWith('[') && scope.length <= 1600 && typeof note === 'string').slice(-200).map(([scope, note]) => [scope, note.slice(0, 3000)]));
}

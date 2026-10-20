import { readFileSync } from 'node:fs';
export const normalizeRole = role => role === 'AE' ? 'AE' : 'BDR';
export function roleReference(role) {
  const selected = normalizeRole(role);
  const libraries = ['universal', selected.toLowerCase()].map(name => JSON.parse(readFileSync(new URL(`./knowledge/${name}.json`, import.meta.url), 'utf8')));
  return `SELECTED ROLE: ${selected}. Role is a strong prior, never a mandatory stage or script. Current conversation > buyer/account context > role/stage > distilled principles > individual examples. ${selected === 'BDR' ? 'Create and qualify legitimate pipeline; favor an earned live discovery/demo next step, with a purpose and the right participants. Handle mild resistance concisely before settling for material. Referral, follow-up or a graceful exit remain appropriate when justified. Not every call merits a demo.' : 'Progress the broader opportunity through relevant discovery, value development, alignment and commercial decisions; do not try to close on every call.'}
EDITORIAL REFERENCES (not learned from a call corpus): ${JSON.stringify(libraries)}`;
}
export function batchReference(role, enabled = true) {
  if (!enabled || normalizeRole(role) !== 'BDR') return '';
  const library = JSON.parse(readFileSync(new URL('./knowledge/bdr-batch1.json', import.meta.url), 'utf8'));
  if (!library.enabled) return '';
  return `PROVISIONAL BDR TRANSCRIPT REFERENCE: ${JSON.stringify(library)}
These six user-provided synthetic examples are weak, correlated evidence, not universal truth. They supply no scripts. The live conversation always outranks them. Never imitate wording, impose ratios or manufacture a meeting.`;
}

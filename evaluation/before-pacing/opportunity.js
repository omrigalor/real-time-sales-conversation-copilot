// A pain must cite actual buyer words, or retain a previously validated pain.
export function readOpportunity(value, turns, roles = [], previous = { pains: [] }) {
  if (!value || !Array.isArray(value.pains)) return null;
  const pains = [], seen = new Set();
  for (const item of value.pains.slice(0, 8)) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(item.id) || seen.has(item.id)) continue;
    const prior = previous?.pains?.find(pain => pain.id === item.id);
    if (item.turn === null && prior) { pains.push(prior); seen.add(item.id); continue; }
    if (!Number.isInteger(item.turn)) continue;
    const turn = turns[item.turn];
    if (!turn || typeof item.quote !== 'string' || item.quote.trim().length < 8 || typeof item.text !== 'string' || !item.text.trim()) continue;
    const speaker = ['manual', 'native'].includes(turn.speakerSource) ? turn.speaker : roles.find(role => role.id === turn.id)?.speaker || turn.speaker;
    if (speaker !== 'buyer' || !turn.text.toLowerCase().includes(item.quote.trim().toLowerCase())) continue;
    pains.push({ id: item.id, text: item.text.trim().slice(0, 160), quote: item.quote.trim().slice(0, 200), turnId: turn.id }); seen.add(item.id);
    if (pains.length === 4) break;
  }
  const fit = value.fit;
  const validFit = pains.length && fit && ['expand', 'optimize', 'undetermined'].includes(fit.motion) && ['product', 'reason', 'validate'].every(key => typeof fit[key] === 'string' && fit[key].trim());
  return { pains: pains.slice(0, 4), fit: validFit ? { motion: fit.motion, product: fit.product.trim().slice(0, 90), reason: fit.reason.trim().slice(0, 180), validate: fit.validate.trim().slice(0, 180) } : null };
}
export const OPPORTUNITY_PROTOCOL = `ACCOUNT OPPORTUNITY (in the final insights JSON)
Include "opportunity":{"pains":[{"id":"stable-pain-slug","text":"brief buyer-confirmed pain","turn":transcript_turn_number,"quote":"exact short excerpt of buyer words"}],"fit":{"motion":"expand|optimize|undetermined","product":"one actual Salesforce product name only, not an activity","reason":"one short mechanism, preferably under 12 words","validate":"one concise validation gap, preferably under 9 words"} or null}.
Prefer one or two pains, at most three; each pain label should use roughly 4–10 plain words. Keep only material pains supported by CLIENT statements, not the seller's hypotheses, scenario signals, or unspoken background. Exact quotes must come from the cited buyer turn. For previously validated pains in opportunity_memory you may retain their id with turn:null, without changing their meaning. Omit a pain when corrected or resolved; revise it only with new buyer evidence. This is the full current list, not an append-only history.
Choose at most one leading fit, treating it as a hypothesis that may change with evidence. Respect the customer's existing Salesforce footprint; distinguish optimization/adoption from additional licensed capability. Do not pitch an already-owned product as new. No pain means fit:null. An unresolved business-process problem may mean optimize or undetermined, not an upsell. A complaint about cost does not automatically mean Agentforce; a data mention does not automatically mean Data 360. A workflow review, demo, meeting or integration optimization is an activity, not a product name. Use the actual product name and motion:optimize when improving an owned product. Explain the mechanism and one validation gap, not a feature list. Never invent commercial terms, product inclusions, ROI or integrations. Use the supplied product reference. This panel advises ONLY the Salesforce rep.`;

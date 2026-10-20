export function readReminders(value) {
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.covered)) return null;
  const validKey = key => typeof key === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(key);
  const covered = [...new Set(value.covered.filter(validKey))].slice(0, 12);
  const seen = new Set(covered);
  const items = [];
  for (const item of value.items) {
    if (!item || !validKey(item.id) || typeof item.text !== 'string' || !item.text.trim() || seen.has(item.id)) continue;
    seen.add(item.id); items.push({ id: item.id, text: item.text.trim().slice(0, 180) });
    if (items.length === 3) break;
  }
  return { items, covered };
}
export const REMINDERS_PROTOCOL = `DON'T MISS PANEL (in the final insights JSON)
Include "reminders":{"items":[{"id":"stable-topic-slug","text":"one brief thing for the Salesforce REP to ask or say"}],"covered":["topic-slugs-now-covered"]}.
Return zero to three genuinely important, currently relevant gaps. Prefer 4–9 plain words per bullet, specific to this conversation, not a generic qualification checklist. These are only for the REP. Never supply a client answer. Do not repeat the immediate suggestion in this panel. Never use unspoken private scenario facts; signals are hypotheses, not established pain.
Compare the WHOLE provided transcript and reminder_memory. Drop a bullet as soon as the rep asks/says it OR the buyer volunteers its answer, even if the topic could be explored more deeply. Record its stable id in covered. Do not suggest the same topic with a different id, and do not resurrect a dismissed/covered topic. Use the same id when rewording a retained bullet. Covered is an incremental update, not a replacement for the memory. A genuinely different follow-up must ask for new information and have a new specific id. Prefer fewer bullets over filler. With no substantive conversation, return empty items and covered. Update this panel even when action is wait; it is a reminder for later, never a reason to interrupt.`;

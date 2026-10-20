export const OBJECTIVE_PROTOCOL = `CONVERSATION FOCUS (final insights JSON)
Include "objective":{"current":"one short useful conversational objective","known":[{"text":"brief observed fact","turn":0,"quote":"exact transcript excerpt"}],"unknown":["one useful uncertainty"]}.
Use at most two concise known facts and two uncertainties. Known facts require exact spoken evidence from an identified speaker, interpreted conservatively: a seller claim is not buyer confirmation. Buyer certainty, urgency, interest and willingness to buy must not be inferred as facts. Hypotheses belong under unknown, explicitly tentative. Do not treat a fictional account brief as spoken confirmation. Current objective is advisory, never a mandatory stage. A useful result can be understanding, an answer, referral, disqualification, follow-up or earned commercial progress. No readiness percentage, score, mandatory meeting target or invented facts.`;

export function readObjective(value, turns, roles = []) {
  if (!value || typeof value.current !== 'string' || !value.current.trim()) return null;
  const known = (Array.isArray(value.known) ? value.known : []).filter(item => {
    const turn = turns[item?.turn];
    const speaker = ['native', 'manual'].includes(turn?.speakerSource) ? turn.speaker : roles.find(role => role.id === turn?.id)?.speaker;
    return Number.isInteger(item?.turn) && speaker === 'buyer' && typeof item.text === 'string' && typeof item.quote === 'string' && item.quote.trim().length >= 3 && turn.text.toLowerCase().includes(item.quote.trim().toLowerCase());
  }).slice(0, 2).map(item => ({ text: item.text.trim().slice(0, 130), quote: item.quote.trim().slice(0, 200) }));
  return { current: value.current.trim().slice(0, 150), known, unknown: (Array.isArray(value.unknown) ? value.unknown : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 2).map(x => x.trim().slice(0, 130)) };
}

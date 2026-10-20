export const CLOSE_GOALS = ['next_step', 'purchase'];
export const closeGoal = value => CLOSE_GOALS.includes(value) ? value : 'next_step';

// This is conversational readiness, never a calibrated likelihood of winning.
export function readProgress(value) {
  if (!value || !Number.isFinite(value.score) || value.score < 0 || value.score > 100) return null;
  const stages = { opening: 15, discovery: 35, fit: 55, objections: 70, commitment: 95, agreed: 100 };
  if (!Object.hasOwn(stages, value.stage) || typeof value.reason !== 'string' || !value.reason.trim()) return null;
  return { score: Math.min(Math.round(value.score), stages[value.stage]), stage: value.stage, reason: value.reason.trim().slice(0, 180) };
}

export const PROGRESS_PROTOCOL = `CLOSE READINESS (in the final insights JSON)
Include "progress":{"score":0_to_100,"stage":"opening|discovery|fit|objections|commitment|agreed","reason":"short evidence-based explanation"}.
This is a conservative conversation-readiness estimate toward close_goal, NOT a statistical win probability. For next_step the goal is an explicitly agreed concrete next step, usually a meeting. For purchase the goal is an explicit purchase commitment; a meeting is NOT a purchase close.
Use only buyer-confirmed evidence: opening 0-15, discovery up to35, established fit up to55, substantive objections being resolved up to70, actual commitment discussion up to95, explicit agreement to the chosen goal100. Use lower scores when evidence is missing. A rep's pitch, question, or proposed meeting alone never raises readiness. Politeness is not buying intent. Score may fall when blockers or refusal emerge. Explain the main remaining blocker or concrete agreement in at most18 words. Do not fabricate budget, authority, timing or commitment. This metadata is separate from the rep's spoken line.
OBJECTIONS TO A CLOSE: Help only the rep acknowledge the concern, clarify the real blocker if needed, and respond with relevant verified value. When the buyer confirms the concern is resolved and interest exists, propose one proportionate next step toward close_goal. Do not keep interrogating a buyer who is ready. An objection is not consent; unresolved blockers, no fit or a clear refusal call for clarification or a respectful stop, not pressure or an invented discount. Never write the client's acceptance for them.`;

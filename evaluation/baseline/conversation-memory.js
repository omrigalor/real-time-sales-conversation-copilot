// Persist an evidenced agreement across the bounded transcript window, not a sales-stage guess.
export function readConversationMemory(value, turns, roles = [], previous = {}) {
  const step = value?.next_step;
  if (!step || !['none', 'proposed', 'agreed', 'declined'].includes(step.state)) return null;
  if (step.state === 'none') return previous.next_step ? previous : { next_step: null };
  if (step.turn === null) return previous.next_step ? previous : null;
  if (!Number.isInteger(step.turn) || typeof step.quote !== 'string' || step.quote.trim().length < 3 || typeof step.detail !== 'string' || !step.detail.trim()) return null;
  const turn = turns[step.turn];
  if (!turn || !turn.text.toLowerCase().includes(step.quote.trim().toLowerCase())) return null;
  const speaker = ['native', 'manual'].includes(turn.speakerSource) ? turn.speaker : roles.find(role => role.id === turn.id)?.speaker || 'unassigned';
  if (speaker !== (step.state === 'proposed' ? 'seller' : 'buyer')) return null;
  return { next_step: { state: step.state, detail: step.detail.trim().slice(0, 160), quote: step.quote.trim().slice(0, 200), turnId: turn.id } };
}
export const CONVERSATION_MEMORY_PROTOCOL = `NEXT-STEP MEMORY (in the final insights JSON)
Include "memory":{"next_step":{"state":"none|proposed|agreed|declined","detail":"concise concrete action, not a buying-stage summary","turn":transcript_turn_number_or_null,"quote":"exact brief supporting words"}}.
Only the rep can propose; only an identified buyer's actual words can establish agreement or refusal. Interpret the quoted reply in its real context: politeness or interest alone is NOT agreement to a next step. Do not invent participants, scope or dates. Use state none when there is no next step. To retain previous next-step memory outside the transcript window, use turn:null with the prior state/detail; never reset a prior agreement merely because it is no longer in the window. A new explicit buyer change can update or withdraw it. A proposed meeting is not an agreed meeting, and an agreed meeting is not a purchase. This state is advisory context for a natural close, not a mechanical sales sequence.`;

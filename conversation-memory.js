import { updateThreads } from './thread-memory.js';
// Persist an evidenced agreement across the bounded transcript window, not a sales-stage guess.
function readNextStepMemory(value, turns, roles = [], previous = {}) {
  const step = value?.next_step;
  if (!step || !['none', 'proposed', 'agreed', 'declined'].includes(step.state)) return null;
  if (step.state === 'none') return previous.next_step ? previous : { next_step: null };
  if (step.turn === null) return previous.next_step ? previous : null;
  if (!Number.isInteger(step.turn) || typeof step.quote !== 'string' || step.quote.trim().length < 3 || typeof step.detail !== 'string' || !step.detail.trim()) return null;
  const turn = turns[step.turn];
  if (!turn || !turn.text.toLowerCase().includes(step.quote.trim().toLowerCase())) return null;
  const speaker = ['native', 'manual'].includes(turn.speakerSource) ? turn.speaker : roles.find(role => role.id === turn.id)?.speaker || 'unassigned';
  if (step.state === 'proposed' ? !['seller', 'buyer'].includes(speaker) : speaker !== 'buyer') return null;
  return { next_step: { state: step.state, detail: step.detail.trim().slice(0, 160), quote: step.quote.trim().slice(0, 200), turnId: turn.id } };
}
export const CONVERSATION_MEMORY_PROTOCOL = `NEXT-STEP MEMORY (in the final insights JSON)
Include "memory":{"next_step":{"state":"none|proposed|agreed|declined","detail":"concise concrete action, not a buying-stage summary","turn":transcript_turn_number_or_null,"quote":"exact brief supporting words"}}.
Either identified party can propose a next step; only an identified buyer's actual words can establish the buyer's agreement or refusal. Interpret the quoted reply in its real context: politeness or interest alone is NOT agreement to a next step. An initial brush-off asking for information is a proposed channel, not yet a mutually settled next action. Do not invent participants, scope or dates. Use state none when there is no next step. To retain previous next-step memory outside the transcript window, use turn:null with the prior state/detail; never reset a prior agreement merely because it is no longer in the window. A new explicit buyer change can update or withdraw it. A proposed meeting is not an agreed meeting, and an agreed meeting is not a purchase. This state is advisory context for a natural close, not a mechanical sales sequence.
Also include memory.objection_attempts as incremental records: [{"id":"stable-concern-slug","kind":"relevance|meeting","concern":"brief buyer concern addressed","turn":seller_transcript_turn_number,"quote":"exact words the seller actually spoke in the attempt"}]. Record the concise attempt to address a brush-off or meeting objection only AFTER the seller actually makes it. An unspoken copilot recommendation is not an attempt. Older records survive without being repeated. Use these to avoid spending the one-attempt allowance again on a paraphrase of the same resistance. These are evidence of seller behavior, never evidence that the buyer agreed or has pain.`;

export function readConversationMemory(value, turns, roles = [], previous = {}) {
  const next = readNextStepMemory(value, turns, roles, previous);
  const result={...previous,...next};
  if(Array.isArray(value?.threads))result.threads=updateThreads(value.threads,turns,roles,previous.threads || []);
  if(Array.isArray(value?.objection_attempts)){
    const attempts=new Map((previous.objection_attempts||[]).map(a=>[a.id,a]));
    for(const attempt of value.objection_attempts.slice(0,3)){
      if(!attempt || !/^[a-z0-9-]{1,64}$/.test(attempt.id) || !['relevance','meeting'].includes(attempt.kind) || !Number.isInteger(attempt.turn) || typeof attempt.concern!=='string' || !attempt.concern.trim() || typeof attempt.quote!=='string' || attempt.quote.trim().length<3)continue;
      const turn=turns[attempt.turn];
      const speaker=['native','manual'].includes(turn?.speakerSource)?turn.speaker:roles.find(r=>r.id===turn?.id)?.speaker;
      if(speaker!=='seller' || !turn.text.includes(attempt.quote.trim()))continue;
      attempts.set(attempt.id,{id:attempt.id,kind:attempt.kind,concern:attempt.concern.trim().slice(0,160),quote:attempt.quote.trim().slice(0,240),turnId:turn.id});
    }
    result.objection_attempts=[...attempts.values()].slice(-6);
  }
  return Object.keys(result).length?result:null;
}

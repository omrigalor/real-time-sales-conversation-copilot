// User-selected fixed cold-call opening. Conversational judgment resumes after it.
export { coldOpeningLine } from './app/scenarios.js';

export const SELLER_OPENING_PREFERENCE = `REPRESENTATIVE OPENING PREFERENCE — takes precedence over general stylistic heuristics
The representative explicitly chose a fixed, minimal cold-call introduction for this platform. For the rep's first contribution on an unexpected call, before identity/permission or a substantive exchange has been established, choose delivery "cold_opening". The app inserts the saved representative name into the standard introduction and asks whether the buyer has a few minutes to chat. Do not expand it with account research, pain, observations, a hypothesis, products or a value proposition. Do not personalize it to the buyer or add another sentence. Account reasoning begins after the buyer responds.
Use delivery "natural" for every other situation. The model still decides whether this is actually a cold opening using the call context and transcript. This applies to an AE prospecting as well as a BDR. It does not apply to an already scheduled or invited conversation: scheduled discovery should establish useful shared purpose; a buyer who already invited the reason for calling should hear that reason; a direct buyer question deserves an answer. Do not repeat identity or request permission again when already established. A greeting alone does not establish engagement. A brief first greeting by the rep does not by itself establish permission; judge what has actually been introduced.
This is a single user-selected opening, not a sales dialogue tree. After it, keep full adaptive reasoning and natural, grounded language. Never infer buyer pain, solution fit or buying intent merely because the buyer permits a conversation.`;

export const OPENING_DELIVERY_PROTOCOL = `DELIVERY FIELD: Include "delivery":"cold_opening|natural" in the action JSON. Select cold_opening only for the initial unexpected-call introduction described in the representative preference; natural otherwise. This does not override speaker ownership or HOLD. With cold_opening, use only the standard short identity-and-permission opening; no research or product explanation. The app supplies the final text.`;

export function coachingTask(opening) {
  return opening
    ? 'CURRENT TASK: Prepare the first rep contribution for the supplied call context. Classify its delivery as cold_opening for an unexpected introduction, or natural for a scheduled/invited meeting. No transcript yet means the conversation has not begun; it does not establish buyer permission. Account objectives and product hypotheses do not belong in the fixed cold opening.'
    : 'CURRENT TASK: Advise only the rep based on what has actually been said. Classify delivery cold_opening only if this is still the initial unexpected introduction; otherwise choose natural and address the actual exchange. Never continue the buyer side.';
}

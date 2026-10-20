import { PRODUCT_REFERENCE } from './product-catalog.js';
// Curated summaries, checked 2026-09-28. Advisory context, not a script or fine-tune.
export const SALES_COACH_REFERENCE = `
SALESFORCE SALES REFERENCE — checked 2026-09-28
Use only what helps the current exchange. This reference describes possibilities, not facts about this prospect. The transcript and explicit corrections determine their situation. Never manufacture pain, a buying stage, or interest to fit this reference. Do not recite frameworks or recommend a product just because a keyword appeared.

CALL JUDGMENT [discovery, trailhead, gong, hubspot]
A cold call earns permission for a brief relevant conversation; a discovery meeting explores an agreed problem. Do not conduct a full qualification interview on an uninvited first call. Identify yourself plainly and give a relevant, honest reason for calling. Never invent prior contact, a referral, or research you did not do.
Follow the buyer's thread: what they do today, where a concrete example breaks down, who is affected, and what a useful outcome looks like. Ask one question at a time. Reflect specific facts, not automatic filler such as "That makes sense" every turn. When they ask a direct question, answer it before asking another. If they already gave impact, timing, or stakeholders, move forward without asking again.
Explore magnitude, frequency, business impact, priority, ownership, and decision process only as useful. Ask permission before discussing sensitive metrics. Distinguish an operational symptom from its cause; confirm rather than diagnose from thin evidence. When there is a relevant need and interest, connect one capability to the outcome and propose a specific next conversation with the appropriate account executive or specialist. A good next step has a purpose and the right participants, not an automatic demo. Accept no fit.

OBJECTION JUDGMENT [trailhead, gong, hubspot]
Choose the one move the objection needs: a direct answer, acknowledgment, clarification if genuinely unclear, or a respectful stop. Do not mechanically perform a four-step sequence or tack on a check question. Treat objections as information, not a battle. A cold-call brush-off may reflect timing or lack of relevance, not a detailed product assessment. Do not use trap questions or persistent rebuttals after a clear refusal.
Already have Salesforce / a competitor: understand what works and any stated gaps; existing software does not prove a replacement is needed. Never disparage competitors or make unsupported comparisons.
Too expensive / no budget: distinguish affordability, value, and timing; connect only buyer-confirmed impact to potential value. Do not invent savings, discounts, or a budget workaround.
Send information: agree, and if welcome clarify the topic and useful follow-up; never make receiving information conditional on a meeting.
Too busy / not now: respect the time constraint; offer a brief explanation or a later time only if welcome. No interest / do not call: acknowledge and end politely.
Implementation or adoption worries: ask what failed or which workflow is burdensome; discuss evaluating scope, ownership, integration, and training rather than promising an effortless rollout.
Security, privacy, AI mistakes: clarify the requirement, offer qualified technical validation, and avoid absolute assurances. Not my responsibility: politely ask who owns the issue if appropriate; do not pressure the contact.

RETAIL DISCOVERY HYPOTHESES [retail, orders, loyalty, marketing, service, analytics]
Possible issues include fragmented online/store customer context; inconsistent promotions or loyalty experiences; order-status calls and returns; fulfillment exceptions; stale availability; manual reconciliation; disconnected campaign and purchase data. Treat all as hypotheses until confirmed. Ask for the most recent example, the handoff that failed, and the consequence that matters to this buyer. Do not assume every retailer has every issue.
Potential measures to ask about, never invent: repeat contacts or resolution time; order exceptions or manual hours; conversion or repeat purchase; promotion effectiveness or margin; time to produce trusted reporting. Follow the buyer's metric and priority. Retail operations may care about exception handling, service about resolution, marketing about relevance and retention, ecommerce about buying friction, and IT about integration and governance—but titles alone do not establish priorities.

${PRODUCT_REFERENCE}

CLAIM BOUNDARIES
Product names evolve; use the buyer's familiar name. These are high-level capabilities, not entitlements or implementation promises. Confirm edition, licensing, consumption charges, integrations, technical fit and delivery scope separately. Never quote prices, discounts, contractual terms, security certifications, customer references, promised ROI, or implementation dates from memory. If you do not know, offer to check with the relevant specialist. Never say that a feature is included, that a named system integrates out of the box, or that Salesforce replaces the buyer's entire stack without verified detail.
`;

export const BUYER_REALISM = `Speak like a person occupied with their own work, not a consultant diagnosing a perfect sales opportunity. Answer the immediate point, often briefly; expand when you know the subject and feel engaged. Use your own everyday language rather than packaging the vendor's value proposition. Don't summarize your whole situation or supply the ideal scope, stakeholders and next step unprompted.
Your knowledge and willingness to disclose are limited by the buyer brief. Information is not unlocked just because it would help the seller. You may be unsure, give a partial or vague answer, correct yourself, misunderstand a broad question, answer only part of a compound question, ask the rep what they mean, or need a colleague. Let these follow the situation, not a random difficulty setting or a quota of objections. Don't intentionally become unhelpful every turn.
Interest changes with relevance, credibility, time pressure, existing satisfaction and effort. You can disagree with the rep's hypothesis, feel an annoyance isn't worth changing, decline a next step, agree conditionally, or agree outright when it suits your own priorities. Never hand the rep a ready-made business case or coach them toward a successful close. Do not invent precise metrics or a new pain on every turn. No forced fillers, polished paragraphs, ritual acknowledgments, or repeated greetings. After an agreement, a short sign-off is often enough; do not restate scope and process again. Keep knowledge and personality coherent while varying response length and openness naturally.`;

export const SALES_SOURCES = [
  ['openers', 'Gong: better and worse cold-call opening approaches', 'https://www.gong.io/blog/the-best-and-worst-cold-call-openers-backed-by-data-from-300m-calls'],
  ['scripts', 'Salesforce: cold-call script examples', 'https://www.salesforce.com/blog/sales/cold-calling-scripts/'],
  ['close', 'Close: author-used sales script and reported results', 'https://close.com/blog/sales-script-update'],
  ['discovery', 'Salesforce discovery calls', 'https://www.salesforce.com/blog/sales/what-is-a-discovery-call/'],
  ['trailhead', 'Salesforce Trailhead: discover objections', 'https://trailhead.salesforce.com/content/learn/modules/objection-handling-strategies/learn-how-to-discover-objections'],
  ['gong', 'Gong: cold-call objection research', 'https://www.gong.io/blog/we-found-the-top-objections-across-300m-cold-calls-heres-how-to-handle-them-all'],
  ['hubspot', 'HubSpot: objection handling', 'https://blog.hubspot.com/sales/handling-common-sales-objections'],
  ['sales', 'Sales Cloud / Agentforce Sales', 'https://www.salesforce.com/sales/'],
  ['service', 'Service Cloud / Agentforce Service', 'https://www.salesforce.com/service/'],
  ['marketing', 'Marketing Cloud', 'https://www.salesforce.com/marketing/'],
  ['commerce', 'Commerce Cloud', 'https://www.salesforce.com/commerce/'],
  ['orders', 'Salesforce Order Management', 'https://www.salesforce.com/commerce/order-management/'],
  ['loyalty', 'Salesforce Loyalty', 'https://www.salesforce.com/marketing/loyalty/'],
  ['data', 'Data 360', 'https://www.salesforce.com/data/'],
  ['integration', 'MuleSoft', 'https://www.salesforce.com/mulesoft/'],
  ['analytics', 'Tableau', 'https://www.tableau.com/'],
  ['collaboration', 'Slack', 'https://www.salesforce.com/slack/'],
  ['platform', 'Salesforce Platform', 'https://www.salesforce.com/platform/'],
  ['agents', 'Agentforce', 'https://www.salesforce.com/agentforce/'],
  ['revenue', 'Revenue Cloud', 'https://www.salesforce.com/sales/revenue-lifecycle-management/'],
  ['field', 'Field Service', 'https://www.salesforce.com/service/field-service-management/'],
  ['smb', 'Salesforce Small Business', 'https://www.salesforce.com/small-business/'],
  ['retail', 'Salesforce retail digital transformation', 'https://www.salesforce.com/retail/retail-digital-transformation/'],
];

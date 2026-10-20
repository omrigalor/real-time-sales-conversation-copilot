// Briefs are training fiction. A real company name does not establish a real customer relationship.
export const SCENARIOS = [
  {
    id: 'target-service', company: 'Target', title: 'Rising cost to serve', contact: 'Maya Chen', position: 'VP, Guest Services',
    relationship: 'Existing Salesforce customer in this exercise. Guest support uses Service Cloud; this is an account expansion conversation.',
    signal: 'In an invented earnings-call summary, the CFO flags rising cost to serve. A fictional hiring snapshot shows more guest-support openings.',
    hypothesis: 'Order-status contacts or manual service work may be increasing cost. Hiring could also reflect seasonality—validate the cause.',
    objective: 'Understand what is driving the workload and earn a focused service-workflow review with the right owner.',
  },
  {
    id: 'northstar-loyalty', company: 'Northstar Outfitters', title: 'Loyalty without repeat purchases', contact: 'Priya Shah', position: 'VP, Loyalty & CRM',
    relationship: 'Existing Marketing Cloud customer in this exercise. The campaign team is already using Salesforce.',
    signal: 'A fictional strategy update celebrates loyalty enrollment, but says repeat purchases are flat and promotional margin is under pressure.',
    hypothesis: 'Purchase context may not reach campaigns in time. The issue could also be offer design or measurement rather than new software.',
    objective: 'Find one measurable retention use case and agree on a review with marketing and the data owner.',
  },
  {
    id: 'harbor-sales', company: 'Harborline Manufacturing', title: 'Forecasts and slow quotes', contact: 'Elena Ruiz', position: 'VP, Sales Operations',
    relationship: 'Existing Sales Cloud customer in this exercise. Sales leadership wants more value from the current investment.',
    signal: 'An invented investor briefing mentions forecast misses. Fictional job listings seek sales-operations analysts and pricing specialists.',
    hypothesis: 'Manual quote approvals or inconsistent CRM usage may be hiding pipeline risk. Establish which issue matters first.',
    objective: 'Identify the costly handoff, existing adoption gaps, and whether a process or quoting workshop is warranted.',
  },
  {
    id: 'meridian-service', company: 'Meridian Hotels', title: 'Guest handoffs after an acquisition', contact: 'Sofia Bennett', position: 'Director, Guest Experience',
    relationship: 'Existing Service Cloud customer in this exercise. Some acquired properties still use different systems.',
    signal: 'A fictional acquisition announcement adds properties. An invented operating update highlights inconsistent guest-service handoffs.',
    hypothesis: 'Agents may repeat questions because reservation and property context are disconnected; processes may matter as much as integration.',
    objective: 'Follow one real service handoff and agree on a scoped discussion with operations and the integration owner.',
  },
  {
    id: 'cedar-onboarding', company: 'Cedar Bank', title: 'New accounts, slow onboarding', contact: 'Rachel Brooks', position: 'VP, Customer Operations',
    relationship: 'Existing Financial Services Cloud and Service Cloud customer in this exercise; established workflows must be respected.',
    signal: 'A fictional annual strategy note targets digital-account growth while an invented hiring plan expands onboarding operations.',
    hypothesis: 'Document follow-ups or fragmented handoffs may slow onboarding; compliance controls are constraints to understand, not bypass.',
    objective: 'Locate the operational bottleneck and earn a workflow review with operations, technology and the relevant control owner.',
  },
{"id": "bdr-inbound", "role": "BDR", "title": "Inbound interest", "company": "Aster Software", "contact": "Jordan Lee", "position": "Head of Support", "relationship": "Downloaded a service automation overview; existing Sales Cloud customer.", "signal": "A fictional inbound inquiry asks about reducing repeated support work.", "hypothesis": "There may be a relevant support use case; an inquiry alone is not buying intent.", "objective": "Establish why they looked and whether a follow-up is useful.", "callType": "inbound follow-up"},
{"id": "bdr-wrong-person", "role": "BDR", "title": "Finding the workflow owner", "company": "Vale Logistics", "contact": "Sam Patel", "position": "Finance Director", "relationship": "Existing Salesforce customer; this contact has not requested a call.", "signal": "A fictional announcement describes a growing field team.", "hypothesis": "Sales operations may be adjusting; finance may not own the workflow.", "objective": "Establish relevance or accept a useful referral without forcing discovery.", "callType": "outbound / wrong stakeholder"},
{"id": "bdr-poor-fit", "role": "BDR", "title": "Growth without a software need", "company": "Birch Services", "contact": "Dana Reed", "position": "COO", "relationship": "Prospective customer; no established Salesforce footprint.", "signal": "A fictional operating update mentions expansion.", "hypothesis": "Growth may or may not create an operational problem.", "objective": "Test relevance and leave cleanly if there is no worthwhile opportunity.", "callType": "cold outbound"},
{"id": "ae-discovery", "role": "AE", "title": "Scheduled service discovery", "company": "Target", "contact": "Maya Chen", "position": "VP, Guest Services", "relationship": "Existing Service Cloud customer; this is a scheduled discovery conversation.", "signal": "The operations team accepted a conversation about delivery investigations.", "hypothesis": "The case workspace may work while investigation outside it remains difficult.", "objective": "Understand the actual workflow and decide together whether further work is warranted.", "callType": "scheduled discovery"},
{"id": "ae-demo", "role": "AE", "title": "Workflow demonstration debrief", "company": "Meridian Hotels", "contact": "Sofia Bennett", "position": "Director, Guest Experience", "relationship": "Existing Service Cloud customer; a scoped workflow demonstration just ended.", "signal": "The buyer saw a demonstration of reservation-context handoffs.", "hypothesis": "A demonstration may leave implementation or adoption concerns unresolved.", "objective": "Understand the reaction and agree only the useful follow-through.", "callType": "demo / solution evaluation"},
{"id": "ae-executive", "role": "AE", "title": "Business case and alignment", "company": "Harborline Manufacturing", "contact": "Elena Ruiz", "position": "VP, Sales Operations", "relationship": "Existing Sales Cloud customer; finance is reviewing an expansion proposal.", "signal": "A fictional internal review questions the assumptions behind the value case.", "hypothesis": "Approval depends on credible impact and stakeholder alignment.", "objective": "Clarify evidence and decision needs without inventing ROI.", "callType": "executive / business case / multi-stakeholder"},
{"id": "ae-evaluation", "role": "AE", "title": "Technical and competitive review", "company": "Cedar Bank", "contact": "Rachel Brooks", "position": "VP, Customer Operations", "relationship": "Existing Financial Services Cloud customer comparing ways to improve onboarding.", "signal": "The team is considering an incumbent workflow tool as well as Salesforce capabilities.", "hypothesis": "Controls and implementation capacity may matter more than feature counts.", "objective": "Identify decision criteria and unresolved constraints honestly.", "callType": "technical / competitive evaluation"},
{"id": "ae-commercial", "role": "AE", "title": "Commercial discussion", "company": "Northstar Outfitters", "contact": "Priya Shah", "position": "VP, Loyalty & CRM", "relationship": "Existing Marketing Cloud customer evaluating an additional capability; commercial terms are unconfirmed.", "signal": "Procurement wants a clearer scope and a price discussion.", "hypothesis": "Budget concern could be value, scope or approval process; do not assume which.", "objective": "Work toward acceptable terms without fabricating pricing or discount authority.", "callType": "procurement / negotiation"},
{"id": "ae-stalled", "role": "AE", "title": "Reopening a stalled opportunity", "company": "Aster Software", "contact": "Jordan Lee", "position": "Head of Support", "relationship": "Existing Salesforce customer; a prior follow-up went quiet.", "signal": "A previously discussed workflow review has not moved forward.", "hypothesis": "Priority, ownership or capacity may have changed.", "objective": "Learn whether there is still a mutual reason to proceed, pause or stop.", "callType": "stalled deal / next step"},
{"id": "ae-close", "role": "AE", "title": "Agreed next step, final details", "company": "Vale Logistics", "contact": "Sam Patel", "position": "Finance Director", "relationship": "Existing Salesforce customer; stakeholders have indicated support, but no signed contract exists.", "signal": "A fictional purchasing review remains open on approval timing.", "hypothesis": "A positive conversation is not a signed agreement.", "objective": "Resolve actual remaining commitments and close the conversation naturally.", "callType": "late-stage commitment"},
];
export function getScenario(id = SCENARIOS[0].id) {
  const scenario = SCENARIOS.find(item => item.id === id);
  if (!scenario) throw new Error('Choose a valid practice scenario.');
  return scenario;
}

export function scenariosForRole(role) { return SCENARIOS.filter(s => (s.role || 'BDR') === role); }

const OPENING_REASONS = {
  'target-service': "I saw the update about rising guest-service costs and wanted to understand what's driving that.",
  'northstar-loyalty': "I saw the focus on repeat purchases and wanted to hear how the loyalty program is performing.",
  'harbor-sales': "I saw the focus on forecast accuracy and wanted to understand where the current sales process gets difficult.",
  'meridian-service': "I wanted to check in on guest-service handoffs as the new properties join the business.",
  'cedar-onboarding': "I saw the focus on digital-account growth and wanted to hear how onboarding is keeping up.",
};
export function openingLine(id, repName = 'Omri') {
  const scenario = getScenario(id);
  if (scenario.role === 'AE') return `Hi ${scenario.contact.split(' ')[0]}, it's ${String(repName || 'Omri').trim()} from Salesforce. Where would you like to pick up today?`;
  const contact = getScenario(id).contact.split(' ')[0];
  return `Hi ${contact}, it's ${String(repName || 'Omri').trim()} from Salesforce. ${OPENING_REASONS[getScenario(id).id] || 'I wanted to see whether the recent changes in your team are something we can help with.'} Have you got a minute?`;
}

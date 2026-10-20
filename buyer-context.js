import { accountForCall } from './app/account-context.js';

// Explicit projection: notes, hypotheses, unknowns and proposed products belong
// to the seller. Never spread a coach/account object into buyer generation.
export function buyerAccountContext(value) {
  const a = accountForCall(value, 'simulation');
  if (!a) return null;
  return { company:a.company, person:a.person, buyerRole:a.buyerRole,
    industry:a.industry, size:a.size, relationship:a.relationship, products:a.products,
    callType:a.callType,
    public_context:a.entries.filter(e => e.kind === 'public' && e.source && e.purpose !== 'product').map(e => e.text) };
}

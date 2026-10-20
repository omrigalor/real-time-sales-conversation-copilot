import { SELLER_OPENING_PREFERENCE } from './seller-opening.js';
import { productReference } from './product-knowledge.js';
import { SALES_CONVERSATION } from './sales-conversation.js';
import { roleReference, batchReference } from './sales-roles.js';
import { SALES_COACH_REFERENCE } from './sales-knowledge.js';

// The only composition point for seller judgment. Adapters own transport/output,
// never a second sales methodology. No buyer-private module is imported here.
export function sellerIntelligence(role = 'BDR', useBatch1 = true) {
  return [SALES_CONVERSATION, roleReference(role), batchReference(role, useBatch1), SALES_COACH_REFERENCE, productReference(), SELLER_OPENING_PREFERENCE].join('\n');
}

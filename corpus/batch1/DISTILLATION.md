# Batch 1: provisional BDR evidence

Six user-provided synthetic conversations; source dialogue and metadata are separate. Every seller turn has a qualitative annotation. These are neither real Salesforce calls nor independent evidence of conversion effects. Nothing is fine-tuned. The application reads only `knowledge/bdr-batch1.json`; raw dialogue stays outside the production prompt.

## Patterns supported within this batch

- **Adapt behavior to available attention** (1, 2 versus 4). Give a relevant reason before asking for effort. Confidence: low empirical; recurring within this constructed set.
- **Test rather than manufacture pain** (2, 3, 6). A clean no-meeting outcome may show good judgment. Confidence: low empirical.
- **Follow buyer language and vary the move** (3, 6 versus 4). Statements and direct answers can advance understanding without another question. Confidence: low empirical.

## Context-dependent patterns

- **Proportional next action** (1, 2, 3, 5): a workflow review, permission to follow up, referral or exit. Confidence: low. No automatic meeting objective.
- **Interpret resistance in context** (1, 6 versus 4). Email requests and installed Salesforce products do not have a single meaning. Confidence: low.

## Anti-patterns

Transcript 4 combines unsupported relevance, large diagnostic effort, repeated questions and ignored time constraints. We cannot isolate which factor caused disengagement. Saying the buyer is busy without reducing the burden is not adaptation. Mild inconvenience must not become invented urgency. A name is not an endorsement; conditional email permission is not a scheduled meeting.

## Competing valid strategies

A rushed prospect could receive a concise hypothesis, a short reason for contact, permission-based follow-up or a graceful exit. A mildly annoying workflow could justify one significance check, a tentative reflection or no further pursuit. An email request may warrant simply sending the agreed information rather than negotiating a meeting. A wrong stakeholder can be thanked and released instead of being asked for a referral. After engagement, deeper discovery can be appropriate even for a BDR.

## Deliberately not made into rules

No exact opener, number of questions, talk ratio, word limit, meeting duration, mandatory referral request, required email-address question or fixed objection rebuttal. No claim that statements always outperform questions. No universal rule that existing customers welcome expansion. No learned Salesforce product claim. No inference that politeness means buying intent.

## Open questions

How does this generalize to inbound, hostile, technical, regulated, multicultural or multi-party contexts? Does a hypothesis help without credible research? When does a follow-up request create burden? Are poor-fit exits appropriately balanced against pursuing strong interest? Six examples cannot resolve these questions. No AE transcript-derived guidance was inferred from this BDR-only batch.

## Outcome fidelity

1: supplied label says meeting earned; dialogue shows conditional permission, without calendar confirmation.
2: no meeting, but relevant graceful exit and permission for later contact.
3: verbal acceptance of discovery; attendance and revenue unknown.
4: disengagement; preserved as negative evidence.
5: referral permission; downstream opportunity unknown.
6: continued conversation; materiality and next step unknown.

## Reversibility

Set `enabled` to false in `knowledge/bdr-batch1.json` to remove this batch without altering shared reasoning. The evaluator also runs the saved pre-batch snapshot and current configuration with Batch 1 disabled, so unrelated code changes can be distinguished from the library addition. Confidence labels are evidence caveats, never numeric live sales scores.

## Latest suite: 45 cases (1.0.13)

The original 42 cases are unchanged. `identity-cases.json` adds three checksum-pinned buyer probes for first-name-only unexpected calls, requests for attention, and scheduled meetings with known purpose. These cases are evaluation inputs, not production scripts. Use **Development → Run 45-case shared intelligence / opener review…** or `npm run eval:behavior -- --intelligence`. A/B compares the actual saved 1.0.10 snapshot with current code, including subsequent changes; this comparison does not isolate Batch 1. Use the separate ablation menu to isolate Batch 1. Actual outputs are pending until run with a key; no scripted examples stand in for generated responses.

# Fixed conversational evaluation — development only

The original 15 fixed cases remain unchanged in `cases.json`. Six additional pacing/disclosure cases are in `pacing-cases.json`; each file has its own pinned checksum. The default suite now has 21 cases. Their checksum is pinned in `cases.sha256`. The human review notes are held out from every model request. These examples never enter production coaching, corpus distillation or buyer simulation. Do not tune prompts to match expected sentences; there are no golden sentences, grades, numerical quality scores or automatic winner selection.

## Expanded shared-intelligence suite (1.0.11)

Run `npm run eval:behavior -- --intelligence` or **Development → Run 42-case shared intelligence / SAY–HOLD review…**. `--preview --intelligence` creates the same case/context report without API calls. The original 15 and six pacing probes are unchanged. Twelve separate cross-mode fixtures test BDR/AE shared reasoning and live ownership; nine intelligence fixtures cover grounded/direct product questions, unsupported technical guarantees, HOLD with attention cues, older threads, inference boundaries, handoff and observable Why rationale. Each additive file is checksum-pinned. They are development holdouts, never training examples.

This comparison uses the exact source snapshot in `before-training/` (1.0.10), not reconstructed dialogue. New Observe and handoff have no historical implementation and are marked unavailable. Current coaching reports SAY/HOLD; old snapshots may retain WAIT/LISTEN as their actual historical actions. Reports retain source-linked support and validated handoff output where present, alongside full input context. No quality scores or self-declared winner. Buyer content replay does not measure voice latency.

## Run in the installed app

Quit and reopen the updated app, then choose **Development → Run 21-case pacing / disclosure comparison…** from the Mac menu bar. The main process uses the same securely held OpenAI key as normal coaching; it does not expose it to the renderer, command line or report. The report opens when finished. It is saved under **Desktop/Sales Copilot Regression Results/<timestamp>/** as HTML and JSON. The default comparison makes 37 coach requests, up to 37 short objective-description requests and four Realtime buyer probes. One baseline opener is read from the saved UI function rather than generated; normal API usage applies. Keep the app open until it finishes. A Dock progress indicator tracks the cases.

**Development → Compare current with / without Batch 1…** isolates the batch addition using otherwise identical current code. Neither menu action changes production configuration or an active conversation. Run evaluations outside a real call to avoid sharing API capacity.

## Run from source

With `OPENAI_API_KEY` already configured in your shell environment:

```sh
npm run eval:behavior
npm run eval:behavior -- --ablation
npm run eval:behavior -- --pre-batch
npm run eval:behavior -- --original
```

Do not put a key into source, reports, command arguments or chat. This CLI does not read the app's encrypted key file. `npm run eval:preview` creates a report containing all case contexts and transcripts, explicitly marked **not run**.

## Comparisons and fidelity

The default A = exact 1.0.9 working configuration before pacing changes (`before-pacing/manifest.json`); B = current configuration. The pre-Batch-1 comparison remains available through the Development menu or `--pre-batch`. Its A is the exact saved configuration immediately before Batch 1 was incorporated. `baseline/manifest.json` identifies and hashes the saved source files. No git history exists for this project. This snapshot includes ongoing natural-conversation and role improvements; it is **not** a reconstruction of older installed version 1.0.8. It does not invent old model outputs. A and B are both run now against the same frozen cases and their saved/current request builders.

The optional ablation compares current code with the batch library disabled versus enabled. Use this comparison to isolate Batch 1 from unrelated changes after the snapshot. AE is a useful negative control because this BDR-only batch is not included in AE prompts. Model randomness can still produce different AE answers.

Requests use the real production prompt builder and response parser, with non-streaming transport for recording. No evaluation instructions or rubric are added to the recommendation prompt. Each result saves the complete request, its SHA-256, the raw response, actual model/response ID, usage, SAY/WAIT/LISTEN, spoken line and listening focus. A separate subsequent request gives a brief **post-hoc conversational objective**; it cannot modify the recommendation and is not an evaluation grade or hidden chain of thought. Parsing/request failures are recorded as errors, not replaced by authored examples. The production compact retry is not invoked in this single-request harness, so incomplete output remains visible.

The six additional cases cover: a buyer answering a simple cold-call attention request; a scheduled buyer invited to provide detail; a colleague mentioned as a knowledge boundary; an explicit invitation to involve a colleague; early executive opener effort; and a clear early redirect. They use different contexts from the reported call. There are no fixed response lengths, fact-count thresholds, mandatory moves or model grades. Judge patterns across repeated samples rather than treating a single verbose reply as failure.

Buyer probes use the production Realtime model and buyer instructions through WebSocket, with typed conversation items and text-only output. The coach's goals, corpus and evaluation questions are excluded. This tests disclosure/content, not acoustic turn-taking, prosody or voice timing. The original opening was hard-coded UI text; the baseline opening case reports that actual saved text, clearly labeled, instead of inventing an old model response. The current opening uses the production coach request with `opening:true`.

The report alternates A/B request order and saves after every result. Outputs are isolated: neither condition sees the other's answer. Re-running uses the same cases, not deterministic model responses; snapshot prompts do not freeze a provider model alias forever. Manually inspect repeated samples before claiming a change is reliable.

## Current execution status

The harness has been tested using mocked API boundaries. This coding environment has no evaluation API key and cannot launch the desktop GUI to access the app's normal secure key handling. The generated preview therefore contains **no actual current or baseline model recommendations**. No claim of improved conversational behavior or new Maya conversation has been made. Use the app menu above to produce those outputs; do not treat mocked test outputs as a real evaluation. Batch 2 remains unadded pending manual review.

## Buyer-perspective matrix (1.0.18)

**Development → Compare buyer realism: levels 1 / 3 / 5…** runs ten unchanged situations at each of those levels. The HTML shows the actual buyer replies side by side; there are no scores. Contexts include a rushed executive, pain without root-cause knowledge, a known cause with no priority, practical implementation concerns, partial answers, missing budget knowledge, a stakeholder mention, an email request, a legitimate technical question and an already-earned commitment. The last two protect against overcorrecting into universal terseness or resistance. Fictional evaluation identities are isolated test fixtures, not additional demo accounts.

`npm run eval:behavior -- --buyer-realism --preview` creates the inspection report without API calls. Remove `--preview` with an authorized `OPENAI_API_KEY` to run 30 text-only Realtime replies. The app menu uses its normal secure key handling. This does not measure voice timing or verify hardware. Reports remain clearly marked **not run** until actual model calls succeed.

Buyer replays now pass the selected difficulty, training mode and projected account context into the production session builder. Previously these payload fields were ignored, which made level/persona comparisons misleading. Reviewer questions and seller objectives remain excluded from buyer requests. The original 57 fixed fixtures and historical prompt snapshots are unchanged.

Latency checks exercise positive streaming evidence after semantic completion, delayed final transcripts, resumed speech, empty/noise fragments, silent tool continuation, full tool-round-trip timing, preserved acoustic echo protection and live-mode isolation. They are mocked event tests, not a claim of a 2× measured speedup. Official implementation references: [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) and [voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad). Keep semantic completion and native streaming audio; do not speed playback or shorten speech detection to manufacture a latency win.

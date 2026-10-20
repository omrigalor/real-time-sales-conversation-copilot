# Sales knowledge and conversation design

Reviewed September 28, 2026. The app uses OpenAI with a short, editable reference in sales-knowledge.js. No fine-tuning, copied dialogue corpus, fixed objection tree, or keyword-to-product router was added. The buyer gets only a brief realism prompt; the larger Salesforce reference is for the rep's silent coach. This limits scripting pressure but does not guarantee naturalness or factual accuracy.

## What the script research supports

Gong's opener comparison reports both stronger and weaker approaches in its own call data. It is observational vendor research, not proof that one sentence universally wins. Salesforce provides illustrative script templates, not independently verified successful call transcripts. Close describes a script its author used with self-reported results. These sources were read as examples of conversational choices; none establishes a reliable dataset of complete calls with independently audited win/loss outcomes.

Applied design: buyers can respond briefly, ask the purpose of the call, give partial answers, lack a metric, or have an adequate incumbent. Interest should develop from relevance. Avoid polished lists of pain points, automatic agreement, forced objections, invented familiarity and canned filler. These are our design conclusions from the sources, not measured guarantees. No source script or published success percentage is supplied to the model.

## Salesforce reference

The reference covers discovery, objection handling, common retail hypotheses, and a high-level product map: Sales, Service, Marketing, Commerce, Order Management, Loyalty, Data 360, MuleSoft, Tableau, Slack, Platform, Agentforce, Revenue, Field Service and small-business suites. Each section cites the source IDs below. Capabilities are starting points for discovery, not verified license entitlements. Edition, pricing, integrations, deployment scope and promised outcomes must be checked separately. The app does not browse during a call; this reference is dated and can become stale.

## Who receives help

In both modes the coach is instructed to suggest only the Salesforce rep's next words. A client question must not turn the coach into the client. Simulation uses known input/output roles. Speakerphone uses conversational context in the same model request that generates the suggestion. It can revise recent inferred roles; manual corrections always win. Mixed or unclear turns remain unassigned. The confidence filter is a model-reported heuristic, not a calibrated accuracy score or acoustic speaker identification. Role metadata is removed before text reaches the suggestion card.

## Closing and turn ownership (1.0.3)

The output parser now blocks suggestions after a recognized rep turn, on ambiguous roles, or when metadata targets the buyer. Speech-start events clear old text before the next transcript arrives. This enforces the turn policy in application code, while role classification and the actual sentence perspective still depend on model accuracy. Short examples illustrate role boundaries, not a prescribed sales script.

The shared readiness bar estimates progress toward the selected next-step or purchase goal. It uses the same model response as coaching. Stage ceilings keep discovery from displaying as a completed close; semantic evidence is still model assessed. A percentage is an ordinal conversation estimate, not a calibrated sales prediction. Direct objections should be clarified and addressed, with a relevant closing question only after readiness is supported. It is appropriate for scores to fall or for a call to end without a close.

Prompt design was also checked against [official OpenAI documentation](https://developers.openai.com/api/docs/guides/prompt-engineering). Automated tests check application behavior, not live model accuracy.

## Verification and live acceptance

Automated tests verify streaming, hidden metadata, protected manual labels, stale result rejection, and the API/renderer wiring. They do not measure the model's judgment. No live OpenAI evaluation was run from the build environment.

Live cases to check after reopening:

- Buyer says they already use Salesforce and asks about cost: label Buyer; suggest the rep's reply without invented pricing.
- Rep introduces themselves as calling from Salesforce: label You; do not manufacture the client's answer.
- Rep asks a discovery question and the client is still quiet: allow the client to answer.
- A short ambiguous response or overlapping voices: avoid confident role assignment; user correction takes priority.
- Buyer has no problem with current tools or declines: do not invent pain or force a meeting.
- Buyer describes order exceptions: ask about the actual workflow before proposing a product.
- Simulation buyer speaks a longer natural answer: verify playback finishes. Click Interrupt deliberately on a separate turn to verify cancellation, playback clearing and microphone reopening work. Version 1.0.6 blocks microphone transmission during buyer audio to prevent room echo loops.

## Sources

- **openers**: [Gong: better and worse cold-call opening approaches](https://www.gong.io/blog/the-best-and-worst-cold-call-openers-backed-by-data-from-300m-calls)
- **scripts**: [Salesforce: cold-call script examples](https://www.salesforce.com/blog/sales/cold-calling-scripts/)
- **close**: [Close: author-used sales script and reported results](https://close.com/blog/sales-script-update)
- **discovery**: [Salesforce discovery calls](https://www.salesforce.com/blog/sales/what-is-a-discovery-call/)
- **trailhead**: [Salesforce Trailhead: discover objections](https://trailhead.salesforce.com/content/learn/modules/objection-handling-strategies/learn-how-to-discover-objections)
- **gong**: [Gong: cold-call objection research](https://www.gong.io/blog/we-found-the-top-objections-across-300m-cold-calls-heres-how-to-handle-them-all)
- **hubspot**: [HubSpot: objection handling](https://blog.hubspot.com/sales/handling-common-sales-objections)
- **sales**: [Sales Cloud / Agentforce Sales](https://www.salesforce.com/sales/)
- **service**: [Service Cloud / Agentforce Service](https://www.salesforce.com/service/)
- **marketing**: [Marketing Cloud](https://www.salesforce.com/marketing/)
- **commerce**: [Commerce Cloud](https://www.salesforce.com/commerce/)
- **orders**: [Salesforce Order Management](https://www.salesforce.com/commerce/order-management/)
- **loyalty**: [Salesforce Loyalty](https://www.salesforce.com/marketing/loyalty/)
- **data**: [Data 360](https://www.salesforce.com/data/)
- **integration**: [MuleSoft](https://www.salesforce.com/mulesoft/)
- **analytics**: [Tableau](https://www.tableau.com/)
- **collaboration**: [Slack](https://www.salesforce.com/slack/)
- **platform**: [Salesforce Platform](https://www.salesforce.com/platform/)
- **agents**: [Agentforce](https://www.salesforce.com/agentforce/)
- **revenue**: [Revenue Cloud](https://www.salesforce.com/sales/revenue-lifecycle-management/)
- **field**: [Field Service](https://www.salesforce.com/service/field-service-management/)
- **smb**: [Salesforce Small Business](https://www.salesforce.com/small-business/)
- **retail**: [Salesforce retail digital transformation](https://www.salesforce.com/retail/retail-digital-transformation/)


## Account scenarios and product breadth (1.0.5)

The five scenarios are authored training fiction inspired by common Salesforce discovery themes. Target is used only as an exercise company; its contact, installed products, CFO signal and hiring activity are invented. The other four account names are fictional. Nothing here is presented as a real Target earnings transcript or verified customer relationship.

Sources reviewed for scenario patterns:

- [L’Oréal order-status support](https://www.salesforce.com/customer-stories/loreal/agentic-order-status-support/): order-system context, brand-specific service and human handoff informed the retail exercise. No reported performance number was copied into the scenario.
- [Siemens](https://www.salesforce.com/customer-stories/siemens/): industrial customer journeys and seller handoffs informed manufacturing context, not a scripted success outcome.
- [PenFed](https://www.salesforce.com/customer-stories/pentagon-federal-credit-union/): connected financial-service data and member experiences informed banking context. The onboarding bottleneck is fictional.
- [Engine](https://www.salesforce.com/customer-stories/engine/agentic-service/): travel-service workflows informed the hospitality context. The acquisition and property details are fictional.
- [Salesforce Marketing](https://www.salesforce.com/marketing/) and [Loyalty](https://www.salesforce.com/marketing/loyalty/): customer engagement and program workflows informed the loyalty exercise.

The expanded [44-offering catalog](PRODUCTS.md) cites official product pages. Problem/capability associations are discovery hypotheses authored from those high-level capabilities. They are not guarantees of fit or claims that every offering is separately licensed. Titles and packaging change, and commercial or technical commitments require verification. No customer-success percentages or fixed pain-to-product rules are supplied to the coach.

Live acceptance additions: choose a non-retail scenario and verify the greeting/company stay consistent; ask a Don’t miss question and check that it disappears on the next analysis; dismiss an item and verify it stays dismissed; introduce a buyer correction and verify pain/fit changes; ensure no private buyer fact is treated as discovered before it is spoken. Change scenarios to verify that insights reset.


## Speaker echo protection (1.0.6)

The repeated greetings and phantom short rep turns are consistent with the buyer's speaker audio entering the live microphone. This is an inference from the reported behavior, not a captured live audio diagnosis. Echo cancellation alone was already requested. The revised simulation gates outgoing microphone transmission while buyer generation/playback is active; it waits for `output_audio_buffer.stopped` or `.cleared` and a short room-decay interval, rather than using `response.done` as proof that playback is finished. Automatic VAD interruption is off; the explicit Interrupt control sends `response.cancel` when generating plus `output_audio_buffer.clear`, then waits for completion before reopening input. It preserves manual mute and rejects stale response IDs. Speakerphone does not use this gate.

Official references checked September 28, 2026:
- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/api/docs/guides/realtime-vad

Regression tests cover greeting and subsequent-reply gating, generation/playback ordering, explicit interruption, manual mute, stale response events, timer cleanup, continuous Speakerphone capture, and the immediate local opening. No live audio audition or GUI layout verification was possible in the build sandbox.


## Explicit simulation turns (1.0.7)

User testing showed that 1.0.6 still interrupted an introduction and produced repeated follow-ups. The microphone gate alone was insufficient: configuration still had `semantic_vad` with `create_response: true`. We do not have a trace proving whether background noise, playback echo, or segmented human speech caused the extra inputs. The revised Simulation config sets `turn_detection` to `null`, so only the explicit turn button commits rep audio and requests a reply. There is one application-issued greeting, then one response per acknowledged submission. Pauses, transcripts, and output completion never request a reply. Input stays blocked throughout buyer playback and uncommitted input is cleared before listening resumes.

OpenAI's [Realtime conversation guide](https://developers.openai.com/api/docs/guides/realtime-conversations) documents disabling turn detection, manually committing input, requesting a response, and explicitly clearing WebRTC input before the next turn. Checked September 28, 2026. This trades hands-free turn endings for explicit user control: an automatic pause detector cannot promise never to mistake a pause for a finished thought. Speakerphone is unaffected. Full input transcription begins at turn submission; buyer/coaching output continues to stream. The user's optional workflow preference was requested; in the absence of a response, explicit control follows the stated requirement that the buyer never interrupt.

Tests cover long pauses, double clicks, acknowledgment ordering/deduplication, noise-like late transcript events, empty submissions, stop/mode-switch cleanup, and the existing audio gate. No live API credential was accessed or decrypted for testing. Real audio/GUI checks remain unavailable in the build sandbox.


## Hands-free completion and conversation pause (1.0.8)

The user rejected manual end-of-turn clicks and requested responsive, contextual turn-taking plus an entire-conversation Pause control. Version 1.0.8 supersedes 1.0.7's manual control. It uses semantic VAD with low eagerness, `create_response: false`, `interrupt_response: false`. Low eagerness adjusts the detector's willingness to declare completion; it is not a fixed silence delay. See the official [VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad), checked September 28, 2026.

The client only requests a reply after fresh speech started while the microphone was available, the segment stopped and committed, and input transcription supplied usable English words (the configured transcription language). Empty, non-English single-character noise and filler-only fragments cannot trigger a reply. The client adds 650 ms of continuation grace on the opening and 250 ms afterward; resumed speech cancels this timer. A local microphone activity check covers some latency before server speech-start events. This is a starting tuning, not a verified ChatGPT Voice latency match or guarantee against interruption. Total latency still includes detection/transcription/network/generation. Completed buyer playback never requests a follow-up; duplicate and rejected input events cannot request one either.

Pause immediately disables microphone transmission and mutes local audio. If the buyer is answering, generation is cancelled and unplayed output is cleared/truncated, including late responses that arrive while paused. Coaching and the clock pause; insights remain on screen. Resume preserves manual mute and either listens or requests one continuation of the interrupted buyer thought. It does not store/replay an audio recording. Speakerphone pause only pauses this app, not the user's separate phone call. Regression tests cover these races using mocked transport/device boundaries. Live acoustics, model completion quality and real latency remain untested in the sandbox.


## September 28: roles, transcript evidence and evaluation

The role design treats BDR pipeline qualification and AE opportunity progression as flexible objectives. Salesforce describes core AEs as owning the full sales cycle: [Salesforce sales careers](https://www.salesforce.com/company/careers/teams/sales/) and [Salesforce Trailhead team roles](https://trailhead.salesforce.com/content/learn/modules/strategies-for-successful-sales-team-interviews/discover-why-our-sales-team-succeeds). These describe role scope, not mandatory behaviors on each call.

[Gong's team-performance documentation](https://help.gong.io/docs/analyze-team-performance) says interaction statistics can differ by deal stage. We use that as a reason to preserve call context, not to encode its numeric talk ratios, question rates or causal success rules. The six Batch 1 conversations are the user's synthetic material, not Gong transcripts or independent real Salesforce calls. Their limited provenance and conditional outcomes remain explicit in the corpus.

[OpenAI semantic VAD documentation](https://developers.openai.com/api/docs/guides/realtime-vad) supports adjusting semantic eagerness. Medium eagerness and a shorter client grace remove avoidable waits while retaining manual response creation and fresh-input authorization. Actual room-echo performance and latency require a real voice session. Do not report measured speed gains from mocked timing tests.

The saved pre-batch configuration and 15 holdout scenarios support manual behavioral comparison; no score, model-generated grade, or claimed improvement substitutes for reviewing actual API outputs. The coding environment could not produce those outputs because no evaluation credential was available and GUI launch is restricted.


## General pacing and disclosure revision (1.0.10)

The observed early call exposed three implementation contributors: a fixed broad diagnostic opener, goal wording that presumed a workflow-review meeting, and buyer background that could be recited as an answer outline. The revision changes shared reasoning and all affected scenario goals rather than matching the reported buyer sentence. A natural disclosure budget is qualitative and context-dependent. Private knowledge limits do not need to be announced unprompted. A stakeholder knowledge boundary is distinct from an invitation, while explicit buyer interest can justify acceleration.

Six new held-out cases extend the frozen original suite. Two exercise the actual buyer model with typed conversation replay, not a coach-model substitute. [OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) documents typed items and text-only responses; [WebSocket connections](https://developers.openai.com/api/docs/guides/voice-websockets?voice-api=realtime) documents server-side authentication. The buyer request uses the production prompt, with text modality and VAD disabled for this development-only replay. This cannot validate actual voice delivery or latency. Actual model results remain pending an authenticated run; mocked protocol tests are not proof of improved conversation quality.


## September 29 opener/context refinement

The guidance favors earning attention on unexpected calls while retaining context-sensitive alternatives. [Gong's opening analysis](https://www.gong.io/blog/the-best-and-worst-cold-call-openers-backed-by-data-from-300m-calls) describes permission-based approaches; its observational results are not a universal rule or a causal guarantee. No reported percentage, opener wording, or question quota was embedded as a product rule. The specific code correction is explicit unexpected-call metadata and separation of buyer-known identity from app-known identity.

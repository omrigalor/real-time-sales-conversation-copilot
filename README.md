# Real-Time Sales Conversation Copilot

A standalone Mac application that listens during sales calls, follows buyer and seller context, and streams concise guidance for what the representative should say next.

## Open it

Open **SalesCopilot.app** on your Desktop. Click **Settings**, paste an OpenAI API key, and save. You can keep the key for the app session or remember it encrypted on this Mac. The app never displays a saved key. Your OpenAI project needs API billing and access to the models below.

The Desktop icon links to the standalone app in `~/Applications/Sales Copilot Fresh.app`. Its graphic is a blue cloud with a microphone. Keeping the signed bundle in Applications avoids cloud-synced Desktop metadata changing its signature.

## Current account experience (1.0.15)

**Company & buyer** opens the editable pre-call brief. Company details includes employees, products and notes. **Research account** uses the existing OpenAI key for public company/profile, filing/earnings and initiative/technology searches; supported empty fields fill the draft. Manual values remain unless the user chooses a researched replacement. Sources attach to unchanged fields. Add selected findings, then **Save & use account** to update the saved account library. The library supplies both Practice and Simulation, with BDR/AE exercise context kept separate from public facts.

Target is the first researched default. Official sources establish company size, current business signals and Mark Weinstein's public role. Salesforce customer status is user provided; Service Cloud is a labeled practice assumption. Simulated executive dialogue and availability remain roleplay. The old fictional rising-service-cost premise is not a verified Target fact. See `app/researched-target.js` and the Desktop Target research report.

Settings derives context from the selected role/account/call type, with supplemental notes scoped to that setup. The old global context is reference only. Active calls use an account snapshot. Background research cannot silently replace it. Setup and navigation collapse during calls; the recommendation, objective, transcript and compact session controls remain. Setup returns after ending; no Call setup button is shown.

`app/call-context.js` composes scoped context, `app/account-library.js` manages the saved library, and `research-api.js` isolates public research and provenance. The 57-case realism review adds twelve cases to the prior 45 without changing their fixtures. Automated checks: 138 passing. Actual model evaluation and audio/hardware checks still require an authorized app session; preview reports are explicitly marked not run.

There are three sections in the left navigation:

- **Simulation:** Choose **AI rep + AI buyer** (Observe, microphone off) or **You + AI buyer** (interactive demo). These are cooperative demonstrations for exploring the app and a constructive sales conversation.
- **Practice:** Choose **Assisted** (visible coaching) or **Blind** (hidden coaching by default). You speak to an independent, realistic AI buyer; outcomes may include earned progress, rejection or disqualification. Choose difficulty 1–5: Easiest, Easy, Realistic, Challenging or Hardest. Level 3 is the default. Level 1 offers patient, receptive conditions; level 5 brings guarded disclosure, stronger competing priorities and a higher need for credible value and stakeholder alignment. Difficulty changes buyer conditions, not a random success rate or the coaching model. Your own sensible approach can work without matching a suggested sentence. No turn-submission button is required; Pause and Interrupt remain available.
- **Speakerphone:** Put your phone on speaker beside the Mac. The microphone hears both people. The app stays silent and streams suggested next words. A single microphone does not provide reliable speaker identities; the coach uses conversational context, and transcript labels can be changed by clicking them.

**Pause conversation** stops mic input, buyer speech, new coaching and the timer while preserving all on-screen details. **Resume conversation** continues the same call; an interrupted buyer answer is continued from the conversation state. Manual mute is preserved.

**Keep on top** keeps the window visible over other applications. **End session** closes the audio connection, releases the microphone, and cancels pending suggestions. Switching modes also ends the current session. Transcripts are cleared for a new session and are not saved to disk. The app sends audio and transcript to OpenAI while in use; OpenAI account data policies apply. Speakerphone audio quality depends on distance, volume, and room noise.

The voice is OpenAI's **Marin** with a short natural buyer prompt, using the Realtime API. This is an API voice experience, not an exact copy of ChatGPT Voice. Suggestions stream as they are generated; the timing label measures **coaching request to first text**, not total audio-to-suggestion latency.

## Small implementation

- `main.js`: desktop window, encrypted key storage, API calls and cancellation. No local web server is used in the installed app.
- `api.js`: direct Realtime voice session, transcription-only speakerphone session, and streamed text coaching.
- `app/session.js`: standard microphone/WebRTC transport and cleanup.
- `app/renderer.js`: two modes, transcript and coaching card.
- `app/state.js`: transcript ordering, protected speaker corrections and readable errors.
- `sales-knowledge.js`: concise Salesforce reference and buyer realism guidance; see [research and sources](RESEARCH.md).
- `coach-output.js`: gates rep suggestions and separates role/readiness metadata from spoken text.
- `speakerphone-policy.js`: turn ownership rules and short role-boundary examples.
- `progress.js`: goal handling and conservative readiness validation.
- `app/scenarios.js` and `buyer-scenarios.js`: public briefs and private buyer-only context.
- `reminders.js` and `opportunity.js`: validated session insights.
- `product-catalog.js`: 44 source-linked offerings without automatic keyword routing.

Simulation uses `gpt-realtime-2.1`; transcription uses `gpt-4o-mini-transcribe`; suggestions use `gpt-4.1-mini`. Coaching is a separate text request and never enters the simulated buyer's conversation. Only the desktop main process handles API credentials. Suggestions use `store: false`. The UI loads only bundled local resources, with sandboxing and context isolation enabled.

The app stores its own settings under `~/Library/Application Support/Sales Copilot Fresh/`. `openai.enc` contains an encrypted key only if Remember is selected. `settings.json` contains the call context and rep name. Forget key removes the saved key and the copy in app memory.

## Develop and check

Requires Node 24+ and Apple Silicon macOS 13+.

```sh
npm ci
# If npm is configured to skip install scripts:
node node_modules/electron/install.js
npm test
npm start
npm run package
```

The package is built in `dist/Sales Copilot Fresh-darwin-arm64/` and ad-hoc signed for local use. It is not notarized for public distribution.

`npm test` exercises the API boundary and the real renderer/session code with mocked OpenAI, audio-device and WebRTC boundaries. `npm run test:ui` runs the additional Chromium integration suite (`npx playwright install chromium --only-shell` installs its browser).

## Version 1.0.13: Four training experiences, blue cloud theme

**Simulation** now contains two demonstration options: AI rep + AI buyer, or You + AI buyer. **Practice** contains Assisted and Blind. **Speakerphone** remains the separate production live-call section. The two human practice options retain context-dependent buyer outcomes; demonstrations provide a more cooperative, constructive path. No failure percentages, automatic wins, exact-word matching, dialogue trees or numerical sales-quality scores were added. Demonstration success is role/stage aware, never a fabricated purchase or unsupported commitment. Explicit poor fit can still teach clean qualification rather than imaginary pipeline. A generative demo is guided toward progress; this is not a guarantee every API run ends in a win.

The shared seller intelligence is unchanged across environments except for context-sensitive opener refinements. Practice buyer responses depend on actual meaning, relevance, timing, concerns and fit. Review uses actual conversation evidence. An unsuccessful call is not automatically bad selling, and a successful call is not proof every seller move was good. An empirical real-world rejection rate has not been established.

Five existing-customer outbound scenarios previously lacked an explicit call type. They now identify the contact as uninvited to the discussion. The shared core distinguishes answering the phone from granting attention: an account objective or research signal is not automatically the first question to ask. A polite diagnostic question can still be too demanding. Scheduled discovery keeps its different opening priorities; no required permission sentence or fixed word limit was added.

Buyer knowledge is now bounded by what the buyer has actually heard or an explicitly established relationship/invitation. Removed the blanket assertion that an unexpected caller is the buyer's Salesforce rep. First name, company Salesforce usage and private scenario facts do not automatically establish caller affiliation or purpose. Recognized callers and scheduled meetings can legitimately provide context. General disclosure guidance discourages volunteering an entire private brief from an opening question; no canned response is installed.

The UI uses Salesforce-inspired blue/navy/pale-blue colors, with a custom cloud/wave mark. The Desktop app has a matching blue cloud icon at macOS icon sizes. Warm HOLD/error colors retain their distinct meanings. Reference: [Salesforce Lightning color tokens](https://www.lightningdesignsystem.com/2e1ef8501/v/55390/p/98b493-styling-hook-index). This is the personal Sales Copilot app, not an official Salesforce product.

The development evaluation now has **45 frozen cases**, adding three caller-knowledge probes to the unchanged earlier 42: first-name-only unexpected call, permission-only opening, and scheduled meeting with established identity. Reports preserve actual outputs when run; the coding-session preview is explicitly unrun. No API key was available to this evaluator, so naturalness, conversion balance and voice behavior have not been validated with live model calls. Structural/interaction tests use mocked boundaries.

Quit the running app with Command-Q and reopen the Desktop icon to load 1.0.13. Older screenshots or a window that stayed open still show the previous version and prompts.

## Version 1.0.12: AirPods for practice

**Assisted and Blind Practice:** connect AirPods to the Mac, then select the desired Input and Output in System Settings → Sound. Simulation follows those system defaults, so you can use the AirPods microphone or the Mac microphone while hearing the buyer through AirPods. Ringing, buyer voice and Observe seller audio use the system output. **Observe** remains microphone-free.

**Speakerphone is separate:** it selects and pins the built-in Mac microphone when identifiable. On a Mac without one, it pins the selected external room input. It rejects an identified headset-only input rather than silently missing the other person. Later AirPods/default-input changes do not move a pinned room microphone. The real call must still be audible on a physical speaker beside the room mic.

Practice input changes use a serialized, bounded microphone reacquisition and WebRTC track replacement. The transcript and buyer connection are retained; mute, pause and buyer-audio echo protection apply to the replacement track. Output-only changes do not unnecessarily reopen a healthy input. Capture failure keeps the previous live mic if available, otherwise reports a clear reconnect error. No rigid sample-rate requirement is imposed on Bluetooth microphones, and device listeners/late captures are released on session end.

Tests cover routing and lifecycle with simulated device boundaries. Actual AirPods hardware, macOS routing transitions and Bluetooth sound quality have **not** been verified in this coding environment. Bluetooth may reduce sound quality while its microphone is active; selecting the Mac microphone with AirPods output is an alternative described by [Apple](https://support.apple.com/102217). [Mac input selection](https://support.apple.com/guide/mac-help/mchlp2567/mac), [device changes](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/devicechange_event), and [WebRTC track replacement](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack) informed this implementation.

## Version 1.0.11

The live card has two primary actions: **SAY** (a line for the Salesforce rep) and **HOLD** (give the buyer space). An optional **Listen for** cue belongs underneath HOLD. Completed buyer turns trigger fresh reasoning; simulation advice may prepare during buyer audio but stays hidden behind HOLD until playback ends. Older WAIT/LISTEN wire outputs remain readable for compatibility and historical evaluation only.

The same `sales-intelligence.js` composition drives Speakerphone, Assisted, Blind, Observe, and post-call seller review, with distinct BDR and AE references. Speakerphone is input-only and excludes fictional/demo accounts, scenario difficulty and private buyer state. The buyer simulator uses its separate persona and actual dialogue; it never sees coaching or hidden answer keys.

Simulation adds **Assisted / Blind / Observe**, **Easy / Realistic / Hard**, random scenario selection and AE stage selection. Observe uses two AI voices with the microphone off. Blind hides advice without stopping transcript understanding; Show/Hide works in both main modes. Practice review and BDR AE handoff appear after the call and refer to actual spoken evidence, with no numerical grade.

**Pre-call brief** is an editable account context builder. The Northstar Retail Group example is visibly fictional and is excluded from real Speakerphone calls. Optional **Research account** uses OpenAI Responses web search with the existing key; enable/disable it in Settings. Research produces source-linked draft findings requiring manual acceptance. No CRM integration exists. Start captures a detached account snapshot; later research cannot silently change the active call. Explicit manual Apply edits is available during Speakerphone.

The large persona panel and visible close percentage have been replaced by a compact call-control strip and conversational objective. The main area contains one prominent action and the side transcript. Pains, product fit, reminders, known/unknown information and remembered threads are in **Call notes**. **Why?** and **Product basis** open on demand. Speakerphone **Focus** hides navigation to give the live card more space. Post-call review and AE handoff do not occupy permanent live panels. Long content can scroll within its panel/dialog; fonts have not been reduced to fit more features.

Important threads persist beyond the recent transcript window as bounded, evidence-linked session memory. Product statements use a controlled 44-offering reference with official source links and explicit limits; it is not a complete technical or contractual documentation database. Why rationales cite observed words and are not hidden chain-of-thought. Model judgments still require manual review; validated quote/source existence alone does not prove the model's interpretation.

Voice keeps semantic turn detection, normal playback speed, echo protection and Pause/Resume. A reply now requires usable final input transcription rather than an audio-duration shortcut. The local extra continuation grace is reduced to 175 ms initially and 70 ms thereafter; this is **not a measured 30% total response-speed improvement**. Invalid transcripts and unsolicited duplicate responses cannot trigger buyer loops. Deliberate silence check-ins are bounded and suspended while paused. Real microphone, acoustic echo and end-to-end timing still need an actual device/API session.

**Development → Run 42-case shared intelligence / SAY–HOLD review…** reruns the fixed original, pacing, cross-mode and intelligence probes, comparing the exact saved 1.0.10 configuration with current code where available. Reports go to **Desktop/Sales Copilot Regression Results**. Historical Observe/handoff implementations are marked unavailable rather than guessed. The coding environment has no evaluation API key and cannot launch the GUI; Desktop previews contain no fabricated recommendations. Automated tests mock device and API boundaries. Quit with Command-Q and reopen the Desktop icon to load this update.

## Historical notes: Version 1.0.10

The persistent **BDR | AE** toggle affects both modes and defaults to BDR. Changing role retains the current transcript, buyer, session insights and audio connection, then reinterprets the conversation for the selected role. New practice calls use the role-specific library: eight BDR scenarios and seven AE scenarios. All account stories are training fiction, not actual company disclosures.

Both roles share `sales-conversation.js`. `sales-roles.js` adds small role references from `knowledge/`; BDR aims for legitimate qualified pipeline and the appropriate next action, while AE considers opportunity context and value/commercial progression. Neither forces a meeting or close. `conversation-memory.js` retains evidence-backed next-step commitments. SAY, WAIT, LISTEN and safe reuse of an unspoken recommendation are supported. Prior advice stays visibly held while new speech arrives; it is not a cue to interrupt. Pains and reminders request compact labels; product-fit copy distinguishes an actual product from a review or optimization activity.

The buyer receives only buyer/account context and private persona knowledge, never the seller objective, hypothesis, coach recommendation or distilled library. Buyer guidance permits uncertainty, incomplete knowledge, skepticism and variable engagement without manufactured difficulty.

Response latency: semantic VAD now uses medium eagerness. The app's extra continuation grace is 250 ms initially and 100 ms subsequently, measured from semantic stop rather than appended after transcription. Fresh, committed substantive audio can authorize one response while independent transcription is still finishing. Late transcripts remain ordered for coaching. New speech or local microphone activity cancels/defer the reply. Echo gating, explicit interruption and Pause/Resume remain in place. This removes waiting in the code; it is **not a verified 2× end-to-end latency result**. Turn detection can still misread pauses and room acoustics need real-device testing.


The 1.0.10 pacing changes apply generally: the buyer treats private context as memory, not an answer outline; disclosure depends on attention, engagement, knowledge and the actual question. Detailed answers remain appropriate when invited. The shared coach considers buyer effort and distinguishes a colleague’s knowledge from permission to involve them. Explicit invitations can still justify immediate progress. Scenario objectives no longer presume a workflow-review meeting. These are judgment principles, not fact-count limits, required question counts or keyword-triggered meeting rules.

The previously scripted diagnostic opening has been removed. A simple identity fallback appears immediately while the shared coach prepares a relevant opener during connection. The suggestion locks when the rep starts speaking. No buyer-generation, microphone, turn-detection or echo-gating code was changed in 1.0.10.

## Behavioral evaluation and evidence

Batch 1's six synthetic examples have separate metadata, dialogue and turn annotations under `corpus/`. Only five provisional comparative principles enter the BDR library; AE receives no fabricated AE corpus. No raw transcript is inserted into a system prompt. See [the distilled findings](corpus/batch1/DISTILLATION.md).

The development-only evaluator keeps the original [15 fixed holdout scenarios](evaluation/CASES.md) and adds [six pacing/disclosure probes](evaluation/PACING-CASES.md), exact saved pre-Batch-1 and pre-pacing working configurations, and a current-with/without-batch ablation. It saves actual recommendations, SAY/WAIT/LISTEN, raw responses, full requests, model identifiers and a separate post-hoc objective. It produces no numerical sales-quality scores or automatic winner.

After reopening the app, choose **Development → Run 21-case pacing / disclosure comparison…**. It uses the app's securely held key and opens a side-by-side HTML report saved under **Desktop/Sales Copilot Evaluations/**. The other Development menu items compare the pre-Batch-1 snapshot or isolate Batch 1 on current code. Source instructions and limitations are in [evaluation/README.md](evaluation/README.md). The test suite does not train or modify the coach.

Automated checks cover startup, transport/protocol boundaries, rep ownership, commitment evidence, role switching, buyer/coach isolation, pause/resume, echo guards, delayed transcription, fixed-case integrity and evaluation report fidelity. These use mocked devices/API boundaries. This environment has no evaluation API key and cannot launch the Mac/Chromium GUI, so actual model recommendations and a new Maya conversation **have not been generated here**. The preview marks every output as not run; there is no claimed quality gain. No Batch 2 has been added.

The app's panels stay in a viewport layout with long content scrolling inside its own panel. Saved key/settings are preserved when installing an update. Quit with **Command-Q** and reopen the Desktop icon to use the new version.

## API references

- [OpenAI WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc)
- [Realtime session and transcription configuration](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets)
- [Streaming Responses API](https://developers.openai.com/api/docs/guides/streaming-responses)

These documents were checked during implementation on September 28, 2026.

## Buyer perspective, response path and name (1.0.18)

The buyer now receives stronger guidance to act from personal incentives and knowledge rather than arranging useful sales-training questions. Levels 1–5 change commercial opportunity conditions, not intelligence or eloquence. A silent perspective check stays inside generation; it adds no separate model call. The shared seller core adds a read-aloud edit, less ceremony/paraphrase, proportionate next steps and an explicit willingness to stop after an earned commitment. All seller adapters receive these changes.

A compact **Your name** input in the top bar saves the existing representative identity automatically. It hides while connecting and throughout active calls, then returns afterward. Settings edits use the same value. The name-only save does not touch the API key or account notes.

The buyer voice path can use positive streaming transcription evidence once semantic VAD has ended and committed the audio; it no longer always waits for the final transcript event. Silence/filler alone still cannot trigger a response, resumed speech cancels pending submission, and final text continues to update the transcript. Silent state-tool responses continue immediately rather than waiting for room-echo decay. State updates only need changed fields. Normal audio retains echo protection; voice speed, model and semantic VAD eagerness are unchanged. Timing now includes state-tool round trips and separates the app gate from generation/network. These changes remove identifiable waits; a 2× end-to-end improvement is a target, **not a measured result**. AirPods and actual microphone/network latency require live testing.

Development → **Compare buyer realism: levels 1 / 3 / 5…** runs ten fixed buyer situations at three levels (30 replies). The separate 57-case suite still covers shared seller behavior. Fixtures are development-only and are never injected into production prompts. Preview reports contain no fabricated model outputs. See `evaluation/README.md`.

## Visible product focus (1.0.19)

The existing objective bar now includes one compact **Product focus**. Before a call, a cached model assessment uses the selected account brief, role/stage, scoped notes and controlled product catalog to choose a leading hypothesis. The same product reasoning is included in the live coach's existing insights output, so there is no extra product-assessment API round trip on every turn. Meaningful buyer evidence can change or remove the hypothesis. Opening the focus shows its short basis, validation gap and official product reference; an idle account can be reassessed there. Product focus remains hidden with the rest of coaching in Blind Practice or when Copilot is hidden.

This is deliberately distinct from buyer-confirmed pain: research can justify a product worth exploring without proving the buyer needs it. Existing ownership can lead to optimization rather than a new-license upsell, and no fit is a valid result. Product IDs are validated against the catalog; no company/keyword mapping determines the answer. BDR and AE use their shared role-aware intelligence. Buyer simulation never receives this seller product hypothesis. Account changes invalidate the visible focus; delayed pre-call results cannot overwrite a live revision.

The cold opener guidance now favors plain identity, a concrete relevant topic and a small invitation to talk, without nested hedges or generic evolving-needs language. Scheduled discovery keeps its distinct behavior. The buyer guidance emphasizes returning the floor once the immediate response is complete, rather than combining a time warning, situation overview, pitch requirements and fallback strategy. These are reasoning principles, not scripts or length caps. Actual model naturalness still requires manual observation.

import { accountKey, normalizeLibrary, saveToLibrary, trainingAccount } from './account-library.js';
import { callContext } from './call-context.js';
import { PreCallBrief } from './brief.js';
import { accountForCall } from './account-context.js';
import { SCENARIOS, getScenario, openingLine, scenariosForRole } from './scenarios.js';
import { VoiceSession } from './session.js';
import { ObserveSession } from './observe.js';
import { Transcript, ReminderMemory, friendlyError } from './state.js';

const $ = id => document.getElementById(id);
const bridge = window.copilot;
let salesRole = 'BDR';
let trainingMode = 'assisted', difficulty = 3, copilotVisible = true, randomScenario = false;
let practiceMode = 'assisted';
let simulationMode = 'observe';
let completedPractice = null, completedCall = null, reviewGeneration = 0;
let liveAccount = null, liveResearchId = 0, liveCompanyApplied = '';
let useAccountBrief = true, settingsContextScope = '', librarySelection = '';

let audioSpeakerEvidence = null;
let activeAccount = null, briefController = null, supportInfo = null, focusMode = false, handoffText = '';
let mode = 'simulation', phase = 'idle', session = null, transcript = new Transcript();
let settings = { hasKey: false, saved: false, context: '' }, pinned = false;
let nameSavePromise = null, startingNameSave = false;
const productFocusCache = new Map();
let productFocusReady = false, callFocusKey = '', liveProductFocus;
let coachId = null, coachTimer, coachStarted = 0, firstToken = false;
let startedAt = 0, timer, muted = false, renderQueued = false;
let paused = false, pausedAt = 0;
let buyerSpeaking = false;
let reminderMemory = new ReminderMemory(), opportunityMemory = { pains: [], fit: null };
let conversationMemory = {}, lastRecommendation = null, pendingRecommendation = null;
let openingPending = false, openingRequested = false, openingLocked = false, openingRequestId = null, openingReady = false, greetingFinished = false;
let scenarioId = SCENARIOS[0].id;
const labels = { seller: 'You', buyer: 'Buyer', unassigned: 'Speaker' };

function selectedAccount() {
  if(mode==='speakerphone')return accountForCall(liveAccount,mode);
  if(mode==='simulation' && librarySelection) {
    const saved=normalizeLibrary(settings.accountLibrary).find(a=>accountKey(a)===librarySelection);
    if(saved)return trainingAccount(saved,salesRole,$('sales-stage').value);
  }
  return accountForCall(mode === 'speakerphone' || useAccountBrief ? briefController?.accepted : null, mode);
}
function settingsSelection() {
  return { mode, salesRole, scenarioId, accountContext: phase === 'idle' ? selectedAccount() : activeAccount };
}
function renderScenario() {
  const scenario = getScenario(scenarioId);
  const account = phase === 'idle' ? selectedAccount() : activeAccount;
  $('scenario-panel').hidden = mode !== 'simulation';
  $('scenario-contact').textContent = account ? `${account.person || 'Your contact'} · ${account.buyerRole || 'Role unknown'} at ${account.company || 'your practice account'}${account.demo ? ' · Fictional demo' : ' · Practice with your brief'}` : `${scenario.contact} · ${scenario.position} at ${scenario.company}`;
  for (const field of ['relationship', 'signal', 'hypothesis', 'objective']) $('scenario-' + field).textContent = account ? (account[field] || '') : scenario[field];
  if (mode === 'simulation') {
    $('person-title').textContent = `Meet ${(account?.person || scenario.contact).split(' ')[0]}.`;
    $('person-description').textContent = `${account?.buyerRole || scenario.position} · ${account?.company || scenario.company}`;
    $('call-note').textContent = 'Speak naturally. Maya waits for your thought to finish. Interrupt lets you cut in.'.replace('Maya', (account?.person || scenario.contact).split(' ')[0]);
  }
  if (productFocusReady) { prepareProductFocus(); renderProductFocus(); }
}
function focusContext() {
  return {mode,salesRole,accountContext:selectedAccount(),scenarioId:mode==='simulation'?scenarioId:undefined};
}
function focusKey() { return JSON.stringify(focusContext()); }
function currentProductFocus() {
  if (liveProductFocus !== undefined && (phase !== 'idle' || (completedCall && focusKey() === callFocusKey))) return {status:'ready',focus:liveProductFocus};
  const assessed=productFocusCache.get(phase === 'idle' ? focusKey() : callFocusKey);
  if(assessed?.status==='ready')return assessed; // Explicit no-fit must not revive the brief's hypothesis.
  const account=phase==='idle'?selectedAccount():activeAccount;
  const saved=account?.entries?.find(e=>e.kind==='hypothesis' && e.purpose==='product' && e.productName);
  return saved?{...assessed,fromBrief:true,focus:{product:saved.productName,reason:saved.text,validate:'Confirm the need and whether existing licences cover it.',motion:'undetermined'}}:assessed;
}
function renderProductFocus() {
  const item = currentProductFocus(), focus = item?.focus;
  $('product-focus-name').textContent = focus?.product || (item?.status === 'pending' ? 'Assessing account…' : item?.status === 'error' ? 'Assessment unavailable' : 'No clear product fit yet');
  $('product-focus-label').textContent = item?.fromBrief ? 'Product hypothesis · from brief' : focus?.product ? ({expand:'Potential upsell · hypothesis',optimize:'Optimize existing · hypothesis',undetermined:'Product focus · validate ownership'}[focus.motion] || 'Product focus · hypothesis') : 'Product focus';
  $('product-focus').title = focus ? `${focus.reason} Validate: ${focus.validate}` : item?.status === 'error' ? 'Open to retry the assessment.' : 'A product hypothesis will appear when account context supports one.';
}
function prepareProductFocus(force = false) {
  if (!productFocusReady || phase !== 'idle' || !settings.hasKey) return;
  const payload = focusContext(), key = JSON.stringify(payload);
  if (!payload.accountContext && mode === 'speakerphone') return;
  if (!force && productFocusCache.has(key)) return;
  const item = {status:'pending'};
  productFocusCache.set(key,item);
  if (productFocusCache.size > 32) productFocusCache.delete(productFocusCache.keys().next().value);
  bridge.productFocus(payload).then(focus => {
    if (productFocusCache.get(key) !== item) return;
    item.status='ready'; item.focus=focus;
    renderProductFocus();
    if($('account-dialog').open && document.activeElement?.tagName!=='TEXTAREA')briefController?.renderOverview();
  }).catch(() => {
    if (productFocusCache.get(key) !== item) return;
    item.status='error'; renderProductFocus();
  });
}
function renderInsights() {
  $('reminders-list').replaceChildren(); $('reminders-empty').hidden = reminderMemory.items.length > 0;
  for (const item of reminderMemory.items) {
    const li = document.createElement('li'); li.append(document.createTextNode(item.text));
    const done = document.createElement('button'); done.textContent = 'Dismiss'; done.title = 'Already covered or not useful';
    done.onclick = () => { reminderMemory.dismiss(item.id); renderInsights(); scheduleCoach(0); };
    li.append(done); $('reminders-list').append(li);
  }
  $('pain-list').replaceChildren(); $('pain-empty').hidden = opportunityMemory.pains.length > 0;
  for (const pain of opportunityMemory.pains) {
    const li = document.createElement('li'); li.textContent = pain.text; li.title = `Client said: ${pain.quote}`; $('pain-list').append(li);
  }
  const fit = opportunityMemory.fit;
  $('fit-product').textContent = fit ? `${fit.motion === 'optimize' ? 'Optimize: ' : fit.motion === 'expand' ? 'Potential upsell: ' : 'Explore: '}${fit.product}` : 'No fit established';
  $('fit-reason').textContent = fit?.reason || 'Confirm the need first.';
  $('fit-validate').textContent = fit ? `Check: ${fit.validate}` : '';
}
function resetInsights() { reminderMemory = new ReminderMemory(); opportunityMemory = { pains: [], fit: null }; liveProductFocus = undefined; conversationMemory = {}; audioSpeakerEvidence = null; lastRecommendation = null; renderInsights(); if(productFocusReady)renderProductFocus(); }
function resetProgress() {
  $('current-objective').textContent = 'Establish what matters in this conversation.';
  $('focus-known').textContent = 'Listening for buyer evidence.';
  $('focus-unknown').textContent = 'What would make this useful?';
}
function renderObjective(value) {
  $('current-objective').textContent = value.current; $('current-objective').title=value.current;
  $('focus-known').textContent = value.known.map(x => x.text).join(' · ') || 'No confirmed buyer facts yet.';
  $('focus-unknown').textContent = value.unknown.join(' · ') || 'Follow the current thread.';
}
function setCopilotVisible(value) {
  copilotVisible = value;
  document.body.classList.toggle('copilot-hidden', !value);
  $('copilot-toggle').textContent = value ? 'Copilot: Shown' : 'Copilot: Hidden';
  $('copilot-toggle').setAttribute('aria-pressed', String(value));
  $('copilot-hidden-note').hidden = value;
  for (const node of document.querySelectorAll('.coach-content, .coach-footer, .insight-grid, .readiness-panel')) node.hidden = !value;
  if (value && phase === 'active') scheduleCoach(0);
}
function practiceContext() {
  return { mode, scenarioId, salesRole, accountContext:activeAccount, conversationMemory, productFocus:currentProductFocus()?.focus, turns: transcript.snapshot() };
}
function showOpening() {
  if (!greetingFinished || buyerSpeaking) {
    showHold(buyerSpeaking ? 'speaking' : 'answering');
    if (!buyerSpeaking) {
      $('suggestion').textContent = 'Waiting for them to answer.';
      $('coach-hint').textContent = 'Your opening will appear after their greeting.';
    }
    return;
  }
  if (openingRequested && !openingReady) { showHold('updating'); return; }
  if (openingReady && lastRecommendation) { restoreRecommendation(); return; }
  setAction('say');
  $('suggestion').classList.remove('placeholder', 'long');
  $('suggestion').textContent = activeAccount && salesRole==='AE' ? `Hi${activeAccount.person ? ` ${activeAccount.person.split(' ')[0]}` : ''}, it’s ${settings.repName || 'Omri'} from Salesforce.` : openingLine(scenarioId, settings.repName || 'Omri');
  $('coach-status').textContent = 'Ready';
  $('coach-hint').textContent = 'Preparing a relevant opening. You can introduce yourself naturally.';
}
function showHold(reason, focus = '') {
  setAction('hold');
  $('suggestion').classList.remove('pending');
  $('suggestion').classList.add('placeholder');
  $('suggestion').textContent = ['hold','listen'].includes(reason) ? 'Give them a moment.' : reason === 'wait' ? 'Let the client respond.' : reason === 'speaking' ? 'Let them finish.' : reason === 'uncertain' ? 'Confirm who just spoke.' : reason === 'retrying' ? 'Retrying your next line…' : reason === 'updating' ? 'Preparing your next line…' : 'Listening to your call…';
  $('coach-status').textContent = ['updating', 'retrying'].includes(reason) ? 'Thinking…' : 'Listening';
  $('coach-hint').textContent = focus ? `Listen for: ${focus}` : reason === 'uncertain' ? 'Click the latest speaker label: You is the Salesforce rep.' : reason === 'wait' ? 'Give them room to respond.' : 'Suggestions are only for you, the Salesforce rep.';
}
function holdDisplay(status) {
  // Room VAD says someone spoke, not who. Keep the line the rep may be reading
  // through onset, partial transcripts and acoustic-evidence refreshes. Only a
  // fresh coach decision from completed dialogue may change SAY to HOLD.
  if(mode==='speakerphone' && !$('suggestion').classList.contains('placeholder') && $('suggestion-label').textContent==='SAY' && $('suggestion').textContent.trim()) {
    $('coach-status').textContent=status==='Listening'?'Listening · line retained':'Updating…';
    $('coach-hint').textContent='Current line stays visible while the next turn is identified.';
    return;
  }
  supportInfo=null;updateSupportControls();
  showHold(status==='Listening'?'speaking':'updating');
}
function restoreRecommendation() {
  if (!lastRecommendation) { showHold('wait'); return; }
  const { action, text, focus } = lastRecommendation;
  if (action !== 'suggest') { showHold(action, focus); return; }
  $('suggestion').textContent = text;
  $('suggestion').classList.remove('pending', 'placeholder');
  setAction('say');
  $('coach-status').textContent = 'Still relevant';
  $('coach-hint').textContent = 'Use what sounds like you.';
}
function showCoachError(message) {
  $('coach-status').textContent = 'Try Refresh'; $('coach-hint').textContent = message;
  if ($('suggestion').classList.contains('placeholder')) $('suggestion').textContent = 'Couldn’t prepare a line. Tap Refresh to try again.';
}
function showError(error) { $('error-text').textContent = friendlyError(error); $('error-banner').hidden = false; }
function setKeyStatus() {
  $('key-dot').classList.toggle('on', settings.hasKey);
  $('key-status').textContent = settings.hasKey ? 'OpenAI · key added' : settings.saved ? 'OpenAI · saved key locked' : 'OpenAI · add your key';
}
function clearCoach() {
  supportInfo = null; updateSupportControls();
  clearTimeout(coachTimer); coachId = null;
  lastRecommendation = null; pendingRecommendation = null; openingRequested = false; openingRequestId = null; openingReady = false;
  $('suggestion').classList.remove('pending');
  bridge.cancelCoach().catch(() => {});
  setAction('say');
  $('coach-status').textContent = 'Standing by';
  $('suggestion').classList.add('placeholder');
  $('suggestion').textContent = 'The right words, right when you need them.';
  $('coach-hint').textContent = 'Your next line appears here as the conversation unfolds.';
}
function renderMode() {
  const sim = mode === 'simulation';
  $('live-setup').hidden=sim;
  const observe = sim && trainingMode === 'observe';
  const demonstration = sim && ['demo','observe'].includes(trainingMode);
  document.body.classList.toggle('speakerphone-mode', !sim);
  $('simulation-tab').classList.toggle('active', demonstration);
  $('practice-tab').classList.toggle('active', sim && !demonstration);
  $('speakerphone-tab').classList.toggle('active', !sim);
  $('simulation-tab').setAttribute('aria-pressed', String(demonstration));
  $('practice-tab').setAttribute('aria-pressed', String(sim && !demonstration));
  $('speakerphone-tab').setAttribute('aria-pressed', String(!sim));
  $('eyebrow').textContent = demonstration ? 'EXPLORE THE APP' : sim ? 'A SPACE TO PRACTICE' : 'SUPPORT IN THE MOMENT';
  $('page-title').textContent = observe ? 'See a strong call unfold.' : demonstration ? 'Try the conversation.' : sim ? 'Find your flow.' : 'Stay in the conversation.';
  $('page-description').textContent = observe ? 'Two AI voices demonstrate an earned next step, including how to work through objections.' : demonstration ? 'You talk to a cooperative AI buyer. Explore the copilot in a guided demo.' : sim ? 'You sell. The AI buyer reacts. Progress and rejection depend on the conversation.' : 'Put your phone on speaker. Your copilot listens and helps you respond.';
  $('mode-badge').textContent = observe ? 'SIMULATION · OBSERVE' : demonstration ? 'SIMULATION · YOU + AI' : sim ? 'PRACTICE' : 'SPEAKERPHONE';
  $('practice-mode-label').hidden = !sim || demonstration;
  $('simulation-mode-label').hidden = !demonstration;
  $('difficulty').value = String(difficulty);
  $('difficulty-label').hidden = !sim || demonstration;
  $('focus-toggle').hidden = sim; document.body.classList.toggle('focus-mode', !sim && focusMode);
  $('call-title').textContent = sim ? 'Your practice call' : 'Your live call';
  $('person-title').textContent = sim ? 'Meet your contact.' : 'You talk. We listen.';
  $('person-description').replaceChildren();
  $('person-description').append(document.createTextNode(sim ? 'Your practice account.' : 'Place your phone beside your Mac.'), document.createElement('br'), document.createTextNode(sim ? 'A real conversation, with room to practice.' : 'Let the microphone hear both sides.'));
  $('call-note').textContent = sim ? 'Your contact answers first. Speak naturally.' : 'Suggestions are silent. Let the other person know you’re using AI assistance.';
  $('speaker-note').hidden = sim;
  renderLiveAudio();
  renderScenario(); updateControls();
}
function renderLiveAudio() {
  const direct = $('live-audio-source').value === 'mac-call';
  $('mac-call-guide').hidden = !direct;
  $('live-audio-help').textContent = direct ? 'Use a call running on your Mac, plus your microphone. Headphones recommended. Expand setup below before your first call.' : 'Put your iPhone on speaker beside the Mac so its microphone can hear both people.';
  if (mode === 'speakerphone') {
    $('page-description').textContent = direct ? 'Take the call on your Mac. Your copilot listens to the shared call audio and your microphone.' : 'Put your phone on speaker. Your copilot listens and helps you respond.';
    $('person-description').textContent = direct ? 'Share the Mac call audio when you start. Use headphones for a cleaner feed.' : 'Place your phone beside your Mac. Let the microphone hear both sides.';
  }
}
function updateControls() {
  const active = phase === 'active', connecting = phase === 'connecting';
  document.body.classList.toggle('in-call', active || connecting);
  $('rep-name-control').hidden = active || connecting;
  $('live-audio-source').disabled = active || connecting;
  $('direct-audio-levels').hidden = mode !== 'speakerphone' || $('live-audio-source').value !== 'mac-call' || !(active || connecting);
  if (!active && !connecting) { $('direct-mic-level').value=0; $('direct-call-level').value=0; }

  $('start').textContent = active ? 'End session  □' : connecting ? 'Cancel connection  ×' : mode === 'simulation' ? trainingMode === 'observe' ? 'Watch simulation  ↗' : trainingMode === 'demo' ? 'Start demo  ↗' : 'Start practice  ↗' : 'Start listening  ↗';
  $('start').classList.toggle('stop', active || connecting);
  $('mute').disabled = !active || paused;
  $('pause').disabled = !active;
  $('pause').textContent = paused ? 'Resume conversation' : 'Pause conversation';
  $('pause').setAttribute('aria-pressed', String(paused));
  $('interrupt').hidden = mode !== 'simulation';
  $('interrupt').disabled = !active || paused || session?.interruptPending || !(session?.playing || session?.generating);
  $('session-dot').classList.toggle('on', active && !paused && !muted && !session?.playbackBlocked);
  $('refresh').disabled = !active || paused;
  $('settings-button').disabled = active || connecting;
  $('scenario-select').disabled = active || connecting;
  for (const id of ['training-mode', 'simulation-mode', 'difficulty', 'sales-stage']) $(id).disabled = active || connecting;
  $('stage-label').hidden = salesRole !== 'AE';
  $('review').hidden = active || connecting || !completedPractice || mode !== 'simulation';
  $('handoff').hidden = active || connecting || !completedCall || completedCall.salesRole !== 'BDR';
  $('mute').hidden = mode === 'simulation' && trainingMode === 'observe';
  if (mode === 'simulation' && trainingMode === 'observe') $('interrupt').hidden = true;

  $('mute').setAttribute('aria-pressed', String(muted));
  $('mute').setAttribute('aria-label', mode === 'speakerphone' ? (muted ? 'Resume all audio capture' : 'Mute all audio capture') : (muted ? 'Unmute microphone' : 'Mute microphone'));
  $('mute').textContent = muted ? '×' : '♫';
}
function updateClock() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function renderTranscript() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const container = $('transcript');
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 65;
    const rows = transcript.rows.filter(row => row.text.trim()).slice(-120);
    container.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'transcript-empty';
      const title = document.createElement('p'); title.textContent = phase === 'idle' ? 'A clean slate.' : 'Listening for the conversation…';
      const note = document.createElement('small'); note.textContent = phase === 'idle' ? 'Your conversation will appear here when you start.' : trainingMode === 'observe' && mode === 'simulation' ? 'Listen to the AI rep and buyer. Your microphone stays off.' : 'Speak naturally. Your words will appear here.';
      empty.append(title, note); container.append(empty);
    }
    for (const row of rows) {
      const line = document.createElement('div'); line.className = `turn${row.final ? '' : ' partial'}`;
      const label = document.createElement(mode === 'speakerphone' ? 'button' : 'span');
      label.className = `speaker-label ${row.speaker}`; label.textContent = mode === 'simulation' && trainingMode === 'observe' && row.speaker === 'seller' ? 'AI rep' : labels[row.speaker];
      if (mode === 'speakerphone') {
        label.title = `${row.speaker === 'seller' ? 'Salesforce rep' : labels[row.speaker]}${row.speakerSource === 'inferred' ? ' · inferred from context' : ''}. Click to correct: Speaker → You → Buyer`;
        label.setAttribute('aria-label', `Change speaker for: ${row.text.slice(0, 60)}`);
        label.onclick = () => {
          const order = ['unassigned', 'seller', 'buyer'];
          transcript.label(row.id, order[(order.indexOf(row.speaker) + 1) % 3]);
          renderTranscript(); scheduleCoach(100);
        };
      }
      const text = document.createElement('p'); text.textContent = row.text;
      line.append(label, text); container.append(line);
    }
    $('transcript-meta').textContent = rows.length ? `${rows.length} turn${rows.length === 1 ? '' : 's'} · ${phase === 'idle' ? 'Session ended' : 'Live transcript'}` : 'Live transcript';
    if (atBottom) container.scrollTop = container.scrollHeight;
  });
}
function scheduleCoach(delay = 100) {
  if (phase !== 'active' || paused) return;
  if (mode === 'simulation' && openingPending) { if (!openingRequested && !openingLocked) requestCoach(true); return; }
  clearTimeout(coachTimer);
  // Immediately invalidate previous output, even during the debounce.
  coachId = null; bridge.cancelCoach().catch(() => {});
  holdDisplay('Updating…');
  coachTimer = setTimeout(requestCoach, delay);
}
function requestCoach(isOpening = false) {
  // Timer callbacks supply no arguments; an opener can prepare during connection.
  if ((phase !== 'active' && !(isOpening && phase === 'connecting')) || paused || (isOpening && openingLocked)) return;
  // A late transcript from the prior speaker must not coach over a newer live turn.
  if (mode === 'speakerphone' && transcript.rows.at(-1)?.final === false) { holdDisplay('Listening'); return; }
  const id = coachId = crypto.randomUUID(); coachStarted = performance.now(); firstToken = false;
  pendingRecommendation = null;
  if (isOpening) { openingRequested = true; openingRequestId = id; }
  supportInfo = null; updateSupportControls();
  $('coach-status').textContent = 'Thinking…';
  $('coach-hint').textContent = 'Updating with the latest conversation…';
  bridge.coach({ id, mode, salesRole, opening: isOpening, scenarioId: mode === 'simulation' ? scenarioId : undefined, reminderMemory: reminderMemory.snapshot(), opportunityMemory:{...opportunityMemory,focus:currentProductFocus()?.focus}, accountContext:activeAccount, audioSpeakerEvidence:mode==='speakerphone'?audioSpeakerEvidence:undefined, conversationMemory, callLifecycle:mode==='simulation'?session?.lifecycle:undefined, previousRecommendation: lastRecommendation, turns: transcript.snapshot() }).catch(error => {
    if (coachId === id) { if (isOpening) { openingRequested = false; openingRequestId = null; } showCoachError(friendlyError(error)); }
  });
}
bridge.onCoach(event => {
  if ((phase !== 'active' && !(phase === 'connecting' && event.id === openingRequestId)) || paused || event.id !== coachId) return;
  if (event.type === 'reminders') { reminderMemory.update(event.reminders); renderInsights(); }
  if (event.type === 'opportunity') {
    opportunityMemory = event.opportunity;
    if (Object.hasOwn(opportunityMemory,'focus')) liveProductFocus=opportunityMemory.focus;
    renderInsights(); renderProductFocus();
  }
  if (event.type === 'memory') { conversationMemory = event.memory; renderThreads(); }
  if (event.type === 'support') { supportInfo = event.support; updateSupportControls(); }
  if (event.type === 'roles' && mode === 'speakerphone') { transcript.infer(event.roles || []); renderTranscript(); }
  if (event.type === 'hold') {
    firstToken = event.reason !== 'retrying';
    if (event.reason === 'keep') { restoreRecommendation(); pendingRecommendation = lastRecommendation; }
    else {
      showHold(event.reason, event.focus);
      if (['hold', 'listen', 'wait'].includes(event.reason)) pendingRecommendation = { action: event.reason, text: '', focus: event.focus || '', turnId: transcript.snapshot().at(-1)?.id };
    }
  }
  if (event.type === 'objective') renderObjective(event.objective);
  if (event.type === 'delta') {
    setAction('say');
    if (!firstToken) { firstToken = true; $('coach-status').textContent = `${((performance.now() - coachStarted) / 1000).toFixed(1)}s to first word`; }
    $('suggestion').classList.remove('placeholder', 'pending'); $('suggestion').classList.toggle('long', event.text.length > 450); $('suggestion').textContent = event.text;
    pendingRecommendation = { action: 'suggest', text: event.text, focus: '', turnId: transcript.snapshot().at(-1)?.id };
    $('coach-hint').textContent = 'Use what sounds like you.';
  }
  if (event.type === 'done') { if (event.id === openingRequestId) openingReady = true; if (pendingRecommendation) lastRecommendation = pendingRecommendation; if (!firstToken) $('coach-status').textContent = 'Ready'; }
  if (event.type === 'error') { if (event.id === openingRequestId) { openingRequested = false; openingRequestId = null; } showCoachError(event.message); }
  // Prepare advice while audio plays, but never tell the rep to speak over it.
  if (openingPending && !openingLocked && ['delta','hold','done'].includes(event.type)) showOpening();
  else if (buyerSpeaking && ['delta','hold','done'].includes(event.type)) showHold('speaking', pendingRecommendation?.focus || '');
});

function handleEvent(event) {
  const inputSpeaker = mode === 'simulation' ? 'seller' : 'unassigned';
  switch (event.type) {
    case 'audio.sources':
      if (mode === 'speakerphone') { $('direct-mic-level').value=event.mic; $('direct-call-level').value=event.call; }
      break;
    case 'conversation.lifecycle':
      if (event.lifecycle.phase==='closing') scheduleCoach(0); break;
    case 'conversation.lifecycle.unavailable':
      $('call-note').textContent='Automatic ending check unavailable. You can end the call manually.'; break;
    case 'speaker.evidence':
      if(mode==='speakerphone'){audioSpeakerEvidence=event.evidence;scheduleCoach(0);}break;
    case 'speaker.status':
      if(mode==='speakerphone')$('speaker-note').textContent=event.status+'. Click a speaker label to correct it.';break;
    case 'observe.rep.started':
      openingPending = false; openingLocked = true; coachId = null; clearTimeout(coachTimer); bridge.cancelCoach().catch(() => {}); showHold('wait'); break;
    case 'observe.rep.completed':
      transcript.complete(event.item_id, 'seller', event.text); renderTranscript(); break;
    case 'voice.timing':
      $('call-note').textContent = `Buyer response: ${(event.timing.endToAudioMs / 1000).toFixed(1)}s after detected turn end.`;
      $('call-note').title = `App turn gate: ${event.timing.turnGateMs}ms. Generation/network including any private state update: ${event.timing.requestToAudioMs}ms.${event.timing.estimatedSpeechToAudioMs == null ? '' : ` Approximate last microphone speech to audio: ${event.timing.estimatedSpeechToAudioMs}ms (includes end detection; room noise can affect this estimate).`}`;
      break;
    case 'rep.turn.submitted':
      openingPending = false; coachId = null; lastRecommendation = null; clearTimeout(coachTimer); bridge.cancelCoach().catch(() => {}); showHold('wait'); break;
    case 'input_audio_buffer.speech_started':
      if (mode === 'simulation' && openingPending) { openingLocked = true; coachId = null; clearTimeout(coachTimer); bridge.cancelCoach().catch(() => {}); }
      if (mode === 'speakerphone') { coachId = null; clearTimeout(coachTimer); bridge.cancelCoach().catch(() => {}); holdDisplay('Listening'); }
      transcript.reserve(event.item_id, inputSpeaker);
      $('orb').classList.add('speaking');
      $('session-status').textContent = mode === 'simulation' ? 'You’re speaking' : 'Hearing the conversation';
      break;
    case 'input_audio_buffer.speech_stopped':
      $('orb').classList.remove('speaking'); $('session-status').textContent = muted ? 'Microphone muted' : 'Listening'; break;
    case 'input_audio_buffer.committed': transcript.reserve(event.item_id, inputSpeaker, event.previous_item_id); break;
    case 'conversation.item.added':
    case 'conversation.item.created':
      if (event.item?.type === 'message') transcript.reserve(event.item.id, event.item.role === 'assistant' ? 'buyer' : inputSpeaker, event.previous_item_id);
      break;
    case 'response.output_item.added':
      if (event.item?.type === 'message') transcript.reserve(event.item.id, 'buyer'); break;
    case 'conversation.item.input_audio_transcription.delta':
      transcript.delta(event.item_id, inputSpeaker, event.delta || ''); renderTranscript(); break;
    case 'conversation.item.input_audio_transcription.completed': {
      const wasFinal = transcript.rows.find(row => row.id === event.item_id)?.final;
      transcript.complete(event.item_id, inputSpeaker, event.transcript || ''); renderTranscript();
      if (mode === 'simulation' && event.transcript?.trim() && transcript.snapshot().at(-1)?.speaker === 'buyer') openingPending = false;
      if(!wasFinal&&mode==='speakerphone'&&event.transcript?.trim())session?.liveSpeakers?.turnCompleted();
      if (!wasFinal && (mode === 'speakerphone' || transcript.snapshot().at(-1)?.speaker === 'buyer')) scheduleCoach();
      break;
    }
    case 'conversation.item.input_audio_transcription.failed':
      showError(new Error('Some audio could not be transcribed. Check your microphone and speak clearly.')); break;
    case 'response.output_audio_transcript.delta':
      transcript.delta(event.item_id, 'buyer', event.delta || ''); renderTranscript(); break;
    case 'response.output_audio_transcript.done': {
      const row = transcript.complete(event.item_id, 'buyer', event.transcript || '');
      if (transcript.snapshot().some(turn => turn.speaker === 'seller')) openingPending = false;
      renderTranscript(); if (!row.interrupted) scheduleCoach(0); break;
    }
    case 'conversation.item.truncated': {
      transcript.interrupt(event.item_id); renderTranscript();
      coachId = null; clearTimeout(coachTimer); bridge.cancelCoach().catch(() => {}); break;
    }
    case 'output_audio_buffer.started':
      if (!openingPending) pendingRecommendation = null;
      buyerSpeaking = true; showHold('speaking');
      $('orb').classList.add('speaking'); $('session-status').textContent = `${(activeAccount?.person || getScenario(scenarioId).contact).split(' ')[0]} is speaking`; break;
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      buyerSpeaking = false;
      greetingFinished = true;
      if (!paused && phase === 'active') {
        if (openingPending && !openingLocked) showOpening();
        else if (pendingRecommendation) { lastRecommendation = pendingRecommendation; restoreRecommendation(); }
        else scheduleCoach(0);
      }
      $('orb').classList.remove('speaking'); $('session-status').textContent = muted ? 'Microphone muted' : 'Mic reopening…'; break;
    case 'response.done':
      if (event.response?.status === 'failed') showError(new Error(event.response.status_details?.error?.message || 'The buyer’s response failed. Try ending the session and starting again.'));
      if (event.response?.status === 'incomplete') showError(new Error('The buyer’s reply ended before it finished. You can ask her to finish her thought; the call is still connected.'));
      break;
  }
}
async function startSession() {
  if (startingNameSave) return;
  if (nameSavePromise || $('quick-rep-name').value.trim() !== (settings.repName || 'Omri')) {
    startingNameSave = true;
    try { await saveRepName(); }
    catch (error) { showError(error); $('quick-rep-name').focus(); return; }
    finally { startingNameSave = false; }
  }
  if (!settings.hasKey && settings.saved && bridge.retrySavedKey) {
    try { settings={...settings,...await bridge.retrySavedKey()}; setKeyStatus(); }
    catch (error) { openSettings(); $('settings-error').textContent=friendlyError(error); return; }
  }
  if (!settings.hasKey) { openSettings(); $('settings-error').textContent = settings.saved ? 'Your key is still saved. Unlock it using the button above; you do not need to paste it again.' : 'Add your OpenAI API key to start a call.'; return; }
  completedPractice = completedCall = null; reviewGeneration++;
  if(mode==='speakerphone')void selectLiveCompany();
  activeAccount = selectedAccount();
  callFocusKey = focusKey();
  buyerSpeaking = false; renderScenario();
  if (mode === 'simulation' && randomScenario && !settings.accountLibrary?.length) { const choices = availableScenarios(); scenarioId = choices[Math.floor(Math.random() * choices.length)].id; renderScenario(); }
  $('error-banner').hidden = true; phase = 'connecting'; muted = false; paused = false;
  transcript = new Transcript(); resetProgress(); resetInsights(); clearCoach(); renderTranscript(); updateControls();
  openingPending = mode === 'simulation' && trainingMode !== 'observe'; openingLocked = false; openingRequested = false; greetingFinished = false;
  if (openingPending) { showOpening(); requestCoach(true); }
  $('timer').textContent = '00:00';
  const SessionClass = mode === 'simulation' && trainingMode === 'observe' ? ObserveSession : VoiceSession;
  const conn = new SessionClass({ mode, trainingMode: mode === 'simulation' ? trainingMode : 'assisted', difficulty: mode === 'simulation' ? difficulty : undefined, liveAudioSource: mode === 'speakerphone' ? $('live-audio-source').value : 'room', getContext: practiceContext, accountContext:activeAccount, scenarioId: mode === 'simulation' ? scenarioId : undefined, bridge,
    onEnded: reason => { if (session === conn) { endSession(); $('session-status').textContent = reason; } },
    onPlayback: () => { if (session === conn) updateControls(); },
    onEvent: event => { if (session === conn) { handleEvent(event); if (paused) $('session-status').textContent = 'Conversation paused'; } },
    onStatus: status => { if (session === conn) $('session-status').textContent = paused ? 'Conversation paused' : status; },
    onLevel: level => { if (session === conn) document.querySelectorAll('.level-meter i').forEach((bar, index) => bar.classList.toggle('lit', level > (index + 1) / 10)); },
    onError: error => { if (session === conn) { endSession(); showError(error); } },
  });
  session = conn;
  try {
    await conn.start();
    if (session !== conn || conn.closed) return;
    phase = 'active'; startedAt = Date.now(); timer = setInterval(updateClock, 1000); updateControls();
    // The opening can arrive before start() resolves; coach the snapshot once ready.
    scheduleCoach(0);
  } catch (error) { if (session === conn) { endSession(); showError(error); } }
}
function endSession() {
  if (session && transcript.snapshot().some(t => t.speaker === 'seller')) completedCall = { ...practiceContext(), turns: transcript.rows.filter(t => t.final && t.text.trim()).map(t => ({...t})) };
  if (session && mode === 'simulation' && ['assisted','blind'].includes(trainingMode) && transcript.snapshot().some(t => t.speaker === 'seller')) completedPractice = { ...practiceContext(), turns: transcript.rows.filter(t => t.final && t.text.trim()).map(t => ({ ...t })) };
  session?.stop(); session = null;
  bridge.stop().catch(() => {}); clearTimeout(coachTimer); clearInterval(timer); coachId = null;
  phase = 'idle'; muted = false; paused = false; buyerSpeaking = false; updateControls();
  if(productFocusReady){prepareProductFocus();renderProductFocus();}
  $('orb').classList.remove('speaking'); $('session-status').textContent = 'Session ended';
  $('coach-status').textContent = 'Session ended';
  document.querySelectorAll('.level-meter i').forEach(bar => bar.classList.remove('lit'));
  renderTranscript();
}
function changeMode(next) {
  const nextMode = next === 'speakerphone' ? 'speakerphone' : 'simulation';
  const nextTraining = next === 'simulation' ? simulationMode : practiceMode;
  if (nextMode === mode && (nextMode === 'speakerphone' || nextTraining === trainingMode)) return;
  endSession(); mode = nextMode; trainingMode = nextTraining;
  $('training-mode').value = practiceMode;
  $('simulation-mode').value = simulationMode;
  completedPractice = completedCall = null; activeAccount = null; reviewGeneration++; transcript = new Transcript(); resetProgress(); resetInsights(); clearCoach(); renderRoleScenarios(); renderMode(); renderTranscript();
  setCopilotVisible(mode === 'speakerphone' || trainingMode !== 'blind');
  $('session-status').textContent = 'Ready when you are'; $('timer').textContent = '00:00'; $('error-banner').hidden = true;
}
function openSettings() {
  if (phase !== 'idle') return;
  if (nameSavePromise) { nameSavePromise.then(openSettings).catch(showError); return; }
  $('api-key').value = ''; $('api-key').placeholder = settings.saved ? 'Key saved on this Mac · leave blank to keep' : settings.hasKey ? 'Key already added · paste to replace' : 'sk-…';
  $('retry-saved-key').hidden = settings.keyStorageState !== 'locked';
  $('key-help').textContent = settings.keyStorageState === 'locked' ? 'Your encrypted key is saved, but macOS has not unlocked it. Retry access instead of re-entering the key.' : settings.hasKey ? (settings.saved ? 'Saved securely. This key is reused after restarts and app updates.' : 'Your key is available for this app session.') : 'Your key is used only to connect directly to OpenAI.';
  $('remember-key').checked = settings.saved || !settings.hasKey;
  $('rep-name').value = settings.repName || 'Omri';
  $('research-provider').value = settings.researchProvider || 'openai';
  const current = callContext(settingsSelection());
  settingsContextScope = current.scope;
  $('current-context').value = current.summary;
  $('context').value = settings.contextNotes?.[current.scope] || '';
  $('legacy-context').textContent = settings.legacyContext || settings.context || '';
  $('legacy-context-section').hidden = !$('legacy-context').textContent; $('settings-error').textContent = ''; $('forget-key').hidden = !settings.hasKey && !settings.saved;
  $('settings-dialog').showModal();
}
async function saveRepName() {
  if (nameSavePromise) return nameSavePromise;
  const value = $('quick-rep-name').value.trim();
  if (!value || value.length > 80) throw new Error('Enter your name using up to 80 characters.');
  if (value === (settings.repName || 'Omri')) return;
  $('quick-rep-name').disabled = true;
  nameSavePromise = bridge.saveRepName(value).then(name => {
    settings.repName = name;
    $('quick-rep-name').value = $('rep-name').value = name;
  }).finally(() => { nameSavePromise = null; $('quick-rep-name').disabled = false; });
  return nameSavePromise;
}
$('quick-rep-name').onchange = () => { if (phase === 'idle') saveRepName().catch(showError); };
$('quick-rep-name').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('quick-rep-name').blur(); saveRepName().catch(showError); } };
$('start').onclick = () => phase === 'idle' ? startSession() : endSession();
$('pause').onclick = () => {
  if (phase !== 'active') return;
  paused = !paused;
  if (paused) {
    if (openingPending && !openingLocked && !openingReady) openingRequested = false;
    pausedAt = Date.now(); clearInterval(timer); clearTimeout(coachTimer); coachId = null;
    bridge.cancelCoach().catch(() => {}); $('coach-status').textContent = 'Paused';
  } else {
    startedAt += Date.now() - pausedAt; timer = setInterval(updateClock, 1000);
  }
  session?.setPaused(paused); updateControls();
  if (!paused) scheduleCoach(0);
};
$('simulation-tab').onclick = () => changeMode('simulation');
$('practice-tab').onclick = () => changeMode('practice');
$('speakerphone-tab').onclick = () => changeMode('speakerphone');
$('live-audio-source').onchange = () => { if(phase === 'idle') { renderLiveAudio(); updateControls(); } };
$('mac-call-instructions').onclick = () => bridge.openSource('https://support.apple.com/en-us/102405').catch(showError);
$('mute').onclick = () => { muted = !muted; session?.setMuted(muted); updateControls(); };
$('interrupt').onclick = () => session?.interrupt();
$('view-brief').onclick = () => { if(selectedAccount())briefController.open();else $('scenario-dialog').showModal(); };
$('close-brief').onclick = () => $('scenario-dialog').close();
$('refresh').onclick = () => { if (openingPending && !openingLocked) { openingRequested = false; openingReady = false; } scheduleCoach(0); };
$('copilot-toggle').onclick = () => setCopilotVisible(!copilotVisible);
$('close-review').onclick = () => $('review-dialog').close();
$('dismiss-error').onclick = () => { $('error-banner').hidden = true; };
$('settings-button').onclick = openSettings;
$('close-settings').onclick = () => $('settings-dialog').close();
$('edit-company-settings').onclick = () => { $('settings-dialog').close(); briefController.open(); };
$('settings-form').onsubmit = async event => {
  event.preventDefault(); $('save-settings').disabled = true; $('settings-error').textContent = '';
  try {
    settings = await bridge.saveSettings({ key: $('api-key').value, remember: $('remember-key').checked, context: $('context').value, contextScope: settingsContextScope, repName: $('rep-name').value, researchProvider:$('research-provider').value });
    $('quick-rep-name').value = settings.repName || 'Omri';
    prepareProductFocus(true); renderProductFocus();
    $('api-key').value = ''; setKeyStatus(); $('settings-dialog').close();
  } catch (error) { $('settings-error').textContent = friendlyError(error); }
  finally { $('save-settings').disabled = false; }
};
$('retry-saved-key').onclick = async () => {
  $('retry-saved-key').disabled=true; $('settings-error').textContent='';
  try {
    settings={...settings,...await bridge.retrySavedKey()};setKeyStatus();
    $('retry-saved-key').hidden=settings.keyStorageState!=='locked';
    $('key-help').textContent=settings.hasKey?'Saved key unlocked. You do not need to enter it again.':'Your key is still saved. Allow Keychain access if prompted. If access was denied earlier, quit with Command-Q and reopen to retry.';
  }catch(error){$('settings-error').textContent=friendlyError(error);}
  finally{$('retry-saved-key').disabled=false;}
};
$('forget-key').onclick = async () => {
  try { await bridge.forgetKey(); settings.hasKey = settings.saved = false; settings.keyStorageState='missing'; $('retry-saved-key').hidden=true; setKeyStatus(); $('api-key').value = ''; $('api-key').placeholder = 'sk-…'; $('key-help').textContent = 'Key removed from this app.'; $('forget-key').hidden = true; }
  catch (error) { $('settings-error').textContent = friendlyError(error); }
};
$('pin').onclick = async () => { try { pinned = await bridge.pin(!pinned); $('pin').setAttribute('aria-pressed', String(pinned)); $('pin').textContent = pinned ? '↗ Kept on top' : '↗ Keep on top'; } catch (error) { showError(error); } };
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); openSettings(); } });
window.addEventListener('beforeunload', () => { session?.stop(); bridge.stop(); });
window.addEventListener('offline', () => { if (phase !== 'idle') { endSession(); showError(new Error('Your internet connection was lost. Reconnect and start again.')); } });
try { settings = await bridge.settings(); setKeyStatus(); } catch (error) { showError(error); }
$('quick-rep-name').value = settings.repName || 'Omri';

function availableScenarios() {
  const stages = { 'ae-discovery': 'discovery', 'ae-demo': 'demo', 'ae-executive': 'business_case', 'ae-evaluation': 'evaluation', 'ae-commercial': 'commercial', 'ae-stalled': 'follow_up', 'ae-close': 'closing' };
  return scenariosForRole(salesRole).filter(s => salesRole !== 'AE' || $('sales-stage').value === 'all' || stages[s.id] === $('sales-stage').value);
}
function renderRoleScenarios() {
  const library=normalizeLibrary(settings.accountLibrary);
  $('live-accounts').replaceChildren();
  for(const account of library){const option=document.createElement('option');option.value=account.company;$('live-accounts').append(option);}
  if(library.length) {
    if(!library.some(a=>accountKey(a)===librarySelection))librarySelection=accountKey(library.find(a=>accountKey(a)===accountKey(settings.accountBrief))||library[0]);
    $('scenario-select').replaceChildren();
    for(const account of library){const option=document.createElement('option');option.value='saved:'+accountKey(account);option.textContent=`${account.company} · ${account.person || 'Buyer not specified'}`;$('scenario-select').append(option);}
    $('scenario-select').value='saved:'+librarySelection; renderScenario();return;
  }
  const available = availableScenarios();
  if (!available.some(s => s.id === scenarioId)) {
    if (phase === 'idle' && !transcript.snapshot().length) scenarioId = available[0].id;
    else available.unshift(getScenario(scenarioId));
  }
  $('scenario-select').replaceChildren();
  for (const scenario of available) {
    const option = document.createElement('option'); option.value = scenario.id;
    option.textContent = `${scenario.company} · ${scenario.title}`; $('scenario-select').append(option);
  }
  const random = document.createElement('option'); random.value = '__random'; random.textContent = 'Random scenario'; $('scenario-select').append(random);
  $('scenario-select').value = randomScenario ? '__random' : scenarioId;
  renderScenario();
}
for (const role of ['BDR', 'AE']) $('role-' + role.toLowerCase()).onclick = () => {
  if (salesRole === role) return;
  salesRole = role;
  for (const value of ['BDR', 'AE']) $('role-' + value.toLowerCase()).setAttribute('aria-pressed', String(value === role));
  $('role-objective').textContent = role === 'BDR' ? 'Qualified pipeline. The right next step.' : 'Value, alignment, opportunity progress.';
  clearCoach(); renderRoleScenarios(); updateControls(); scheduleCoach(0);
};
renderRoleScenarios();
$('scenario-select').onchange = () => {
  if (phase !== 'idle') { $('scenario-select').value = scenarioId; return; }
  if($('scenario-select').value.startsWith('saved:')) {
    librarySelection=$('scenario-select').value.slice(6);useAccountBrief=false;randomScenario=false;
    const account=normalizeLibrary(settings.accountLibrary).find(a=>accountKey(a)===librarySelection);
    if(account&&briefController){briefController.draft=account;briefController.revision++;}
    completedPractice=null;reviewGeneration++;transcript=new Transcript();resetProgress();resetInsights();clearCoach();renderTranscript();renderScenario();updateControls();return;
  }
  librarySelection='';
  randomScenario = $('scenario-select').value === '__random';
  if (!randomScenario) scenarioId = $('scenario-select').value;
  useAccountBrief = false; // An explicit library selection supersedes a custom training brief.
  completedPractice = null; reviewGeneration++;
  transcript = new Transcript(); resetProgress(); resetInsights(); clearCoach(); renderTranscript(); renderScenario(); updateControls();
};
renderScenario(); renderInsights();

$('training-mode').onchange = () => {
  if (phase !== 'idle' || mode !== 'simulation' || !['assisted','blind'].includes(trainingMode)) return;
  practiceMode = trainingMode = $('training-mode').value === 'blind' ? 'blind' : 'assisted';
  setCopilotVisible(trainingMode !== 'blind');
  $('call-note').textContent = trainingMode === 'observe' ? 'Two AI voices. Listen, pause, and explore. Your microphone stays off.' : 'Speak naturally. Your own approach can work.';
  renderMode();
};
$('simulation-mode').onchange = () => {
  if (phase !== 'idle' || mode !== 'simulation' || !['demo','observe'].includes(trainingMode)) return;
  simulationMode = $('simulation-mode').value === 'demo' ? 'demo' : 'observe';
  changeMode('simulation');
};
$('difficulty').onchange = () => {
  if (phase !== 'idle') return;
  const level = Number($('difficulty').value);
  difficulty = Number.isInteger(level) && level >= 1 && level <= 5 ? level : 3;
  $('difficulty').value = String(difficulty);
  $('difficulty').title = `${$('difficulty').selectedOptions[0].textContent}: ${$('difficulty').selectedOptions[0].title}`;
};
$('sales-stage').onchange = () => { if (phase === 'idle') { transcript = new Transcript(); completedPractice = null; renderRoleScenarios(); resetInsights(); resetProgress(); clearCoach(); renderTranscript(); updateControls(); } };
$('review').onclick = async () => {
  if (!completedPractice || phase !== 'idle') return;
  const generation = ++reviewGeneration;
  $('review-dialog').showModal(); $('review-content').textContent = 'Reviewing the conversation…';
  try {
    const result = await bridge.review(completedPractice);
    if (generation !== reviewGeneration) return;
    const container = $('review-content'); container.replaceChildren();
    const summary = document.createElement('p'); summary.textContent = result.summary; container.append(summary);
    for (const moment of result.moments) {
      const section = document.createElement('section'); section.className = 'review-moment';
      for (const [tag, text] of [['h3', moment.title], ['blockquote', moment.quote], ['p', moment.observation], ['p', moment.alternative ? `Another possible move: ${moment.alternative}` : '']]) { const el = document.createElement(tag); el.textContent = text; section.append(el); }
      container.append(section);
    }
    const takeaway = document.createElement('p'); takeaway.textContent = result.takeaway; container.append(takeaway);
  } catch (error) { if (generation === reviewGeneration) $('review-content').textContent = friendlyError(error); }
};
updateControls();

function setAction(action) {
  document.querySelector('.coach-panel').dataset.action=action;
  $('suggestion-label').textContent=action==='say'?'SAY':'HOLD';
}
function updateSupportControls() {
  $('why-button').disabled=!supportInfo?.why;
  $('basis-button').disabled=!supportInfo?.products?.length;
}
function renderThreads() {
  const list=$('thread-list');list.replaceChildren();
  for(const thread of conversationMemory.threads || []) {
    const item=document.createElement('div');item.className='thread-item';
    const title=document.createElement('strong');title.textContent=`${thread.kind==='known'?'Buyer stated':thread.kind==='inferred'?'Hypothesis':'Unknown'} · ${thread.summary}`;
    const evidence=document.createElement('small');evidence.textContent=`${thread.speaker}: “${thread.quote}”${thread.status==='resolved'?' · Resolved':''}`;
    item.append(title,evidence);list.append(item);
  }
  if(!list.children.length) list.textContent='Important threads will be retained here as the conversation develops.';
}
$('notes-button').onclick=()=>{renderThreads();$('notes-dialog').showModal();};
$('close-notes').onclick=()=>$('notes-dialog').close();
$('close-support').onclick=()=>$('support-dialog').close();
$('product-focus').onclick=()=>{
  const item=currentProductFocus(), focus=item?.focus;
  $('support-title').textContent='Product focus';
  const content=$('support-content');content.replaceChildren();
  const add=text=>{const p=document.createElement('p');p.textContent=text;content.append(p);};
  add(focus?.product || 'No clear product fit yet');
  add(focus?.reason || (item?.status==='pending'?'Assessing the supplied account context…':'There is not yet an assessed leading product. Add account context or reassess.'));
  if(focus?.validate)add(`Worth validating: ${focus.validate}`);
  if(focus?.product)add('This is a working hypothesis, not confirmed buyer need, product ownership or solution fit.');
  if(focus?.url){const link=document.createElement('button');link.className='text-button';link.textContent='Product basis ↗';link.onclick=()=>bridge.openSource(focus.url).catch(showError);content.append(link);}
  if(phase==='idle'){
    const retry=document.createElement('button');retry.className='text-button';retry.textContent='Reassess account';retry.disabled=!settings.hasKey || item?.status==='pending';
    retry.onclick=()=>{prepareProductFocus(true);renderProductFocus();$('support-dialog').close();};content.append(retry);
  }
  $('support-dialog').showModal();
};
$('why-button').onclick=()=>{
  if(!supportInfo?.why)return;
  $('support-title').textContent='Why this move?';const content=$('support-content');content.replaceChildren();
  const reason=document.createElement('p');reason.textContent=supportInfo.why.reason;content.append(reason);
  for(const evidence of supportInfo.why.evidence){const quote=document.createElement('blockquote');quote.textContent=evidence.quote;content.append(quote);}
  $('support-dialog').showModal();
};
$('basis-button').onclick=()=>{
  $('support-title').textContent='Product basis';const content=$('support-content');content.replaceChildren();
  for(const product of supportInfo?.products||[]) {
    const section=document.createElement('section');const title=document.createElement('h3');title.textContent=product.name;
    const detail=document.createElement('p');detail.textContent=product.capability;
    const limit=document.createElement('small');limit.textContent=product.scope;
    const link=document.createElement('button');link.className='source-link text-button';link.textContent=`Official source · reference checked ${product.checkedAt}`;link.onclick=()=>bridge.openSource(product.url).catch(showError);
    section.append(title,detail,limit,document.createElement('br'),link);content.append(section);
  }
  $('support-dialog').showModal();
};
$('focus-toggle').onclick=()=>{focusMode=!focusMode;document.body.classList.toggle('focus-mode',focusMode);$('focus-toggle').setAttribute('aria-pressed',String(focusMode));$('focus-toggle').textContent=focusMode?'Exit focus':'Focus';};
$('close-handoff').onclick=()=>$('handoff-dialog').close();
$('handoff').onclick=async()=>{
  if(!completedCall||phase!=='idle')return;
  const generation=++reviewGeneration;$('handoff-dialog').showModal();$('handoff-content').textContent='Preparing an evidence-based AE brief…';$('copy-handoff').disabled=true;
  try {
    const result=await bridge.handoff(completedCall);if(generation!==reviewGeneration)return;
    const content=$('handoff-content');content.replaceChildren();const lines=[];
    const add=(label,text)=>{if(!text)return;const p=document.createElement('p');p.textContent=`${label}${label?': ':''}${text}`;content.append(p);lines.push(p.textContent);};
    add(result.eligible?'Why this meeting exists':'No AE handoff established',result.reason);
    if(result.eligible){add('Buyer',result.buyer);for(const item of result.known)add('Buyer stated',`${item.text} — “${item.quote}”`);for(const text of result.inferred)add('Hypothesis',text);for(const text of result.unknown)add('Unknown',text);add('Agreed',`${result.agreement.text} — “${result.agreement.quote}”`);add('AE objective',result.ae_objective);}
    handoffText=lines.join('\n\n');$('copy-handoff').disabled=!result.eligible;
  }catch(error){if(generation===reviewGeneration)$('handoff-content').textContent=friendlyError(error);}
};
$('copy-handoff').onclick=()=>navigator.clipboard.writeText(handoffText).then(()=>{$('copy-handoff').textContent='Copied';}).catch(showError);
briefController=new PreCallBrief({document,bridge,initial:settings.accountBrief,getProductFocus:draft=>accountKey(draft)===accountKey(selectedAccount())?currentProductFocus()?.focus:undefined,getActive:()=>phase==='idle'?null:{mode},onSaved:(account,toActive)=>{
  if(mode==='speakerphone'){liveAccount=account;liveCompanyApplied=account?.company||'';$('live-company').value=liveCompanyApplied;liveResearchId++;$('live-research-status').textContent='Using your saved brief.';$('live-review-research').hidden=true;}
  settings.accountBrief=account; settings.accountLibrary=saveToLibrary(settings.accountLibrary,account); useAccountBrief=true; librarySelection=accountKey(account);
  if(toActive&&phase==='active'){
    activeAccount=accountForCall(account,mode);
    liveProductFocus=undefined;
    callFocusKey=JSON.stringify({mode,salesRole,accountContext:activeAccount,scenarioId:mode==='simulation'?scenarioId:undefined});
    renderProductFocus();scheduleCoach(0);
  }
  $('account-button').title=account?.company||'Edit company, buyer, employee count and call details';
  if(phase==='idle')renderRoleScenarios();
}});
$('account-button').onclick=()=>{if(mode==='speakerphone'){briefController.draft=accountForCall(liveAccount,mode)||{company:'',entries:[],fieldSources:{}};briefController.revision++;}briefController.open();};
$('account-button').title=settings.accountBrief?.company||'Edit company, buyer, employee count and call details';
document.querySelector('.call-panel .panel-top').append($('timer'));
updateSupportControls();

productFocusReady = true;
renderMode();

async function selectLiveCompany(force=false){
  if(mode!=='speakerphone'||phase!=='idle')return;
  const company=$('live-company').value.trim();
  if(!force&&company===liveCompanyApplied)return;
  liveCompanyApplied=company;const generation=++liveResearchId;
  const saved=normalizeLibrary(settings.accountLibrary).filter(a=>a.company.toLowerCase()===company.toLowerCase());
  liveAccount=company?(saved.length===1?saved[0]:{company,entries:[],fieldSources:{}}):null;
  $('live-review-research').hidden=true;
  renderScenario();resetInsights();
  if(!company){$('live-research-status').textContent='No brief selected. The copilot will learn from the conversation.';return;}
  if(saved.length===1&&!force){$('live-research-status').textContent='Using the saved customer brief. Edit it or research again in Company & buyer.';return;}
  briefController.draft={...liveAccount,entries:[...(liveAccount.entries||[])],fieldSources:{...(liveAccount.fieldSources||{})}};briefController.revision++;
  $('live-research-status').textContent='Researching public sources… You can start listening with the name alone.';
  const result=await briefController.research();
  if(generation!==liveResearchId)return;
  $('live-research-status').textContent=result?'Research ready. Review and save it before using the findings.':$('account-status').textContent;
  $('live-review-research').hidden=!result;
}
$('live-company').oninput=()=>{liveCompanyApplied=null;liveResearchId++;liveAccount=$('live-company').value.trim()?{company:$('live-company').value.trim(),entries:[],fieldSources:{}}:null;briefController.revision++;};
$('live-company').onchange=()=>void selectLiveCompany();
$('live-company').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void selectLiveCompany();}};
$('live-clear').onclick=()=>{$('live-company').value='';void selectLiveCompany(true);};
$('live-brief').onclick=()=>{$('account-button').click();};
$('live-review-research').onclick=()=>{$('account-dialog').showModal();};

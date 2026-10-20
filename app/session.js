import { getScenario } from './scenarios.js';
import { LiveSpeakers } from './live-speakers.js';
import { MacCallAudio } from './mac-call-audio.js';

// Speech evidence, not an end-of-turn detector. Semantic VAD still decides
// whether the thought is complete; noise/filler alone cannot authorize a reply.
const hasSpeech = text => /[a-z]{2}/i.test(text) && !/^(?:u+h+|u+m+|h+m+|a+h+|e+r+)[.!?,\s]*$/i.test(text.trim());

export class VoiceSession {
  constructor({ mode, scenarioId, bridge, onEvent, onStatus, onLevel, onError, onPlayback = () => {}, onEnded = () => {}, trainingMode = 'assisted', difficulty = 3, accountContext = null, liveAudioSource = 'room' }) {
    Object.assign(this, { mode, scenarioId, bridge, onEvent, onStatus, onLevel, onError, onPlayback, onEnded, trainingMode, difficulty, accountContext, liveAudioSource });
    this.observe = trainingMode === 'observe' && mode === 'simulation';
    this.buyerInstructions = ''; this.completedResponses = new Set(); this.responseHadSpeech = false;
    this.idleChecks = 0; this.buyerState = {}; this.toolCalls = new Set(); this.rejectedResponses = new Set(); this.timings = [];
    this.closed = false;
    this.dialogue = new Map(); this.dialogueRevision = 0; this.lifecycle = {phase:'active'}; this.lifecycleVersion = -1;
    this.muted = false;
    this.paused = false; this.resumeBuyer = false;
    this.playbackBlocked = mode === 'simulation'; this.generating = false; this.playing = false; this.playbackFinished = false;
    this.responsePending = false;
    this.inputTurns = new Map(); this.submittedInputs = new Map(); this.seenInputIds = new Set();
    this.speakingItem = null; this.repTurns = 0; this.lastLocalSpeechAt = 0;
  }
  async start() {
    let stream, track;
    if (!this.observe) {
    this.onStatus('Requesting microphone…');
    // Open the native picker first while Start is still a user gesture. Direct
    // capture's getUserMedia requests mic consent after the audio selection.
    if (!(this.mode === 'speakerphone' && this.liveAudioSource === 'mac-call') && !await this.bridge.microphonePermission()) throw new Error('Allow Sales Copilot Fresh in System Settings → Privacy & Security → Microphone, then try again.');
    if (this.closed) return;
    stream = await this.openMicrophone();
    if (this.closed) { stream?.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    track = stream.getAudioTracks()[0];
    // Keep room sound and the local ring out of the call until the buyer answers.
    track.enabled = this.mode !== 'simulation';
    this.watchTrack(track);
    this.startMeter(stream);
    } else this.audioContext = new AudioContext();
    this.onStatus('Connecting to OpenAI…');
    const pc = this.pc = new RTCPeerConnection();
    this.audio = new Audio();
    this.audio.autoplay = true;
    // Speakerphone is strictly input-only, including at the playback layer.
    this.audio.muted = this.mode === 'speakerphone';
    pc.ontrack = event => {
      if (this.mode !== 'simulation' || this.closed) return;
      this.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      this.audio.play().catch(() => this.fail(new Error('Could not play the buyer’s voice. End the session and try Start again.')));
    };
    if (this.observe) pc.addTransceiver('audio', { direction: 'recvonly' });
    else this.sender = pc.addTrack(track, stream);
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      clearTimeout(this.disconnectTimer);
      if (pc.connectionState === 'failed') this.fail(new Error('The audio connection failed. Check your internet connection and start again.'));
      if (pc.connectionState === 'disconnected') {
        this.onStatus('Connection interrupted…');
        this.disconnectTimer = setTimeout(() => this.fail(new Error('The audio connection was lost. Start again to reconnect.')), 7000);
      }
      if (pc.connectionState === 'connected') this.onStatus(this.muted ? 'Microphone muted' : 'Listening');
    };
    const dc = this.channel = pc.createDataChannel('oai-events');
    dc.onmessage = message => {
      if (this.closed) return;
      try {
        const event = JSON.parse(message.data);
        // Generation may finish between the Interrupt click and the cancel reaching
        // OpenAI. Its "nothing to cancel" error does not invalidate the call.
        if (event.type === 'error' && event.error?.code === 'response_cancel_not_active') return;
        if (event.type === 'error') { this.fail(new Error(event.error?.message || 'OpenAI voice connection failed.')); return; }
        if (this.mode === 'simulation' && event.type === 'response.created' && !this.responsePending && event.response?.id && event.response.id !== this.activeResponseId) {
          this.rejectedResponses.add(event.response.id);
          this.send({ type: 'response.cancel', response_id: event.response.id }); return;
        }
        if (this.rejectedResponses.has(event.response?.id || event.response_id)) return;
        this.handlePlayback(event);
        if (!this.handleInput(event)) return;
        this.onEvent(event);
      } catch (error) { this.fail(error); }
    };
    dc.onclose = () => { if (!this.closed) this.fail(new Error('The call connection closed. Start again to reconnect.')); };
    dc.onerror = () => this.fail(new Error('The call connection encountered an error. Start again.'));
    this.openPromise = new Promise((resolve, reject) => {
      this.rejectOpen = reject;
      this.openTimer = setTimeout(() => reject(new Error('Audio connection timed out. Check your internet and try again.')), 30000);
      dc.onopen = () => { clearTimeout(this.openTimer); this.rejectOpen = null; resolve(); };
    });
    // Attach a handler immediately, even while the SDP request is pending.
    this.openPromise.catch(() => {});
    const offer = await pc.createOffer();
    if (this.closed) return;
    await pc.setLocalDescription(offer);
    if (this.closed) return;
    const answer = await this.bridge.connect({ mode: this.mode, trainingMode: this.trainingMode, difficulty: this.difficulty, accountContext: this.mode === 'simulation' ? this.accountContext : undefined, scenarioId: this.mode === 'simulation' ? this.scenarioId : undefined, sdp: offer.sdp });
    if (this.closed) return;
    if(this.mode==='simulation') {
      if(typeof answer?.buyerInstructions!=='string' || !answer.buyerInstructions.trim())throw new Error('Buyer instructions were missing. Please restart the app and try again.');
      this.buyerInstructions=answer.buyerInstructions;
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: typeof answer==='string'?answer:answer.sdp });
    await this.openPromise;
    if (this.closed) return;
    await this.watchDevices();
    if (this.closed) return;
    if (this.mode === 'simulation') {
      this.onStatus('Ringing…');
      await this.playRing();
      if (this.closed) return;
      const name = this.accountContext ? this.accountContext.person : getScenario(this.scenarioId).contact;
      this.requestBuyer({ instructions: `Answer the phone as your assigned buyer. Say only: "${name ? `Hi, ${name.split(' ')[0]} speaking.` : 'Hello.'}" Then wait for the caller.` }, true);
      this.onStatus('Buyer is answering…');
    }
    if (this.mode !== 'simulation') {
      this.onStatus('Listening');
      this.liveSpeakers=new LiveSpeakers({bridge:this.bridge,onEvidence:evidence=>this.onEvent({type:'speaker.evidence',evidence}),onStatus:status=>this.onEvent({type:'speaker.status',status})});
      void this.liveSpeakers.start(this.stream);
    }
  }
  async openMicrophone() {
    if (this.mode === 'speakerphone' && this.liveAudioSource === 'mac-call') {
      this.onStatus('Choose the call audio in the macOS picker…');
      this.directAudio = new MacCallAudio({onError:error=>this.fail(error),onLevel:levels=>this.onEvent({type:'audio.sources',...levels})});
      return this.directAudio.open();
    }
    // Follow macOS Sound > Input, including AirPods or a built-in microphone.
    // Let CoreAudio/Chromium negotiate Bluetooth sample rates; do not demand
    // a particular rate or stereo format from a headset microphone.
    // Speakerphone is input-only and must retain BOTH the nearby rep and the
    // quieter voice playing from a physical phone. Do not apply the browser's
    // close-talker noise/echo filters to that room signal. Keep AGC for level
    // differences; the server's far-field processing handles room noise once.
    const room = this.mode === 'speakerphone';
    const audio = { deviceId: { ideal: 'default' }, channelCount: { ideal: 1 }, echoCancellation: !room, noiseSuppression: !room, autoGainControl: true };
    let stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    if (this.mode !== 'speakerphone') return stream;
    // Speakerphone needs the room, not the salesperson's headset. Device labels
    // are available after capture permission; inspect before connecting to WebRTC.
    stream.getAudioTracks().forEach(t => { t.enabled = false; });
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices?.() || []).filter(d => d.kind === 'audioinput');
      const builtIn = inputs.find(d => d.deviceId !== 'default' && /(?:macbook|built[ -]?in|imac).*(?:microphone|mic)|(?:microphone|mic).*(?:macbook|built[ -]?in|imac)/i.test(d.label));
      const track = stream.getAudioTracks()[0];
      const current = inputs.find(d => d.deviceId === track.getSettings?.().deviceId) || inputs.find(d => d.deviceId === 'default');
      const isHeadset = /airpods|headset|headphone|bluetooth|beats/i.test(`${track.label || ''} ${current?.label || ''}`);
      const physical = inputs.find(d => !['default','communications'].includes(d.deviceId) && ((current?.groupId && d.groupId === current.groupId) || d.deviceId === track.getSettings?.().deviceId));
      const roomInput = builtIn || (!isHeadset && physical);
      if (roomInput) {
        // Pin the physical room device so a later macOS default change to
        // AirPods cannot silently steal the real-call microphone.
        const room = await navigator.mediaDevices.getUserMedia({audio:{...audio,deviceId:{exact:roomInput.deviceId}},video:false});
        stream.getTracks().forEach(t => t.stop()); stream=room;
        stream.getAudioTracks().forEach(t => { t.enabled = false; });
      } else if (isHeadset) throw new Error('Speakerphone needs a room microphone to hear both people. Select your Mac or an external room microphone in System Settings → Sound → Input, then start again. AirPods work in Simulation.');
      return stream;
    } catch(error) { stream.getTracks().forEach(t => t.stop()); throw error; }
  }
  watchTrack(track) {
    track.onended = () => this.mode === 'simulation' ? this.queueMicrophoneRefresh(true) : this.fail(new Error('Room microphone disconnected. Reconnect it and start Speakerphone again.'));
  }
  async defaultInputSignature() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices?.();
      const input = devices?.find(d => d.kind === 'audioinput' && d.deviceId === 'default');
      return input ? `${input.groupId}:${input.label}` : '';
    } catch { return ''; }
  }
  async watchDevices() {
    if (this.observe || this.closed || this.mode !== 'simulation') return;
    this.inputSignature = await this.defaultInputSignature();
    if (this.closed) return;
    this.deviceChangeHandler = () => this.queueMicrophoneRefresh(false);
    navigator.mediaDevices.addEventListener?.('devicechange', this.deviceChangeHandler);
    if (this.stream?.getAudioTracks()[0]?.readyState === 'ended') this.queueMicrophoneRefresh(true);
  }
  queueMicrophoneRefresh(force = false) {
    if (this.closed || this.observe || this.mode !== 'simulation') return;
    this.forceMicrophoneRefresh ||= force;
    clearTimeout(this.deviceTimer);
    // Let macOS finish changing Bluetooth profiles before requesting capture.
    this.deviceTimer = setTimeout(() => this.refreshMicrophone(), 300);
  }
  async refreshMicrophone() {
    if (this.closed || this.observe || this.mode !== 'simulation') return;
    if (this.switchingMicrophone) { this.queueMicrophoneRefresh(this.forceMicrophoneRefresh); return; }
    const force = this.forceMicrophoneRefresh; this.forceMicrophoneRefresh = false;
    this.switchingMicrophone = true;
    let replacement;
    try {
      const signature = await this.defaultInputSignature();
      if (this.closed) return;
      const currentTrack = this.stream?.getAudioTracks()[0];
      // Output-only changes should not unnecessarily reopen a healthy input.
      if (!force && currentTrack?.readyState !== 'ended' && signature && signature === this.inputSignature) return;
      if (!this.sender?.replaceTrack) { this.queueMicrophoneRefresh(true); return; }
      this.onStatus('Updating microphone…');
      replacement = await this.openMicrophone();
      const track = replacement.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('No active microphone');
      track.enabled = false; // Preserve privacy while replaceTrack is pending.
      if (this.closed) return;
      await this.sender.replaceTrack(track);
      if (this.closed) return;
      const old = this.stream;
      this.stream = replacement; replacement = null;
      this.watchTrack(track);
      track.enabled = !this.muted && !this.paused && !this.playbackBlocked;
      this.startMeter(this.stream);
      old?.getTracks().forEach(t => { t.onended = null; t.stop(); });
      this.inputSignature = signature;
      this.microphoneRetries = 0;
      this.onStatus(this.paused ? 'Conversation paused' : this.muted ? 'Microphone muted' : this.playbackBlocked ? 'Buyer is speaking · mic protected' : 'Listening');
    } catch {
      if (this.closed) return;
      if ((this.microphoneRetries = (this.microphoneRetries || 0) + 1) < 3) this.queueMicrophoneRefresh(true);
      else if (this.stream?.getAudioTracks()[0]?.readyState === 'live') {
        this.microphoneRetries = 0;
        this.onStatus('Using previous microphone. Check Mac Sound settings.');
      } else this.fail(new Error('No microphone is available. Select an input in System Settings → Sound, then start again.'));
    } finally {
      replacement?.getTracks().forEach(t => t.stop());
      this.switchingMicrophone = false;
      if (!this.closed) this.scheduleReply();
    }
  }
  recordDialogue(id, speaker, text) {
    if (this.mode !== 'simulation' || !id || !text?.trim()) return;
    if (this.dialogue.get(id)?.text === text) return;
    this.dialogue.set(id, {speaker, text}); this.dialogueRevision++;
    while (this.dialogue.size > 80) this.dialogue.delete(this.dialogue.keys().next().value);
    this.assessLifecycle();
  }
  assessLifecycle() {
    if (this.closed || this.mode !== 'simulation' || !this.bridge.lifecycle || this.lifecyclePending) return;
    const revision = this.dialogueRevision;
    const turns = [...this.dialogue.values()].filter(t=>t.text);
    if (!turns.some(t=>t.speaker==='seller')) return;
    this.lifecyclePending = Promise.resolve().then(()=>this.bridge.lifecycle({mode:'simulation',turns})).then(value=>{
      if (this.closed || revision !== this.dialogueRevision) return;
      if (!['active','closing','ended'].includes(value?.phase)) return;
      this.lifecycle={...value,buyer_attention:value.buyer_attention==='unknown' ? (this.lifecycle.buyer_attention || 'unknown') : value.buyer_attention}; this.lifecycleVersion=revision;
      this.onEvent({type:'conversation.lifecycle',lifecycle:value});
      this.finishLifecycle();
    }).catch(()=>{
      // A classifier outage never invents an ending or blocks ordinary audio.
      if (!this.closed) this.onEvent({type:'conversation.lifecycle.unavailable'});
    }).finally(()=>{
      this.lifecyclePending=null;
      if (this.closed) return;
      if (revision !== this.dialogueRevision) this.assessLifecycle();
      else if (!this.playbackBlocked) this.buyerReady();
    });
  }
  finishLifecycle() {
    if (this.lifecycle.phase !== 'ended' || this.lifecycleVersion !== this.dialogueRevision || this.closed || this.paused || this.playing || this.generating || this.responsePending || this.speakingItem || this.inputTurns.size || this.lifecycleEnded) return false;
    this.lifecycleEnded=true; clearTimeout(this.idleTimer); clearTimeout(this.replyTimer);
    this.onEnded('Buyer ended the call'); return true;
  }
  requestBuyer(response = {}, greeting = false, continuation = false) {
    if (this.closed || this.paused || this.mode !== 'simulation' || this.responsePending || this.generating || this.playing) return;
    if (this.lifecycleEnded || this.finishLifecycle()) return;
    // Only closing exchanges wait for the small semantic check; normal replies
    // retain the existing fast path. A fresh question can reopen the discussion.
    if (!greeting && this.lifecycle.phase !== 'active' && this.lifecyclePending) {
      if (!this.closingGate) {
        this.closingGate=true;
        this.lifecyclePending.finally(()=>{
          this.closingGate=false;
          if (!this.speakingItem && !this.closed) this.requestBuyer(response,greeting,continuation);
        });
      }
      return;
    }
    if (!greeting) {
      const state=this.lifecycle;
      const cue=state.phase==='closing' ? 'This exchange is winding down. Respond only to genuinely new meaning; an already-agreed commitment repeated in different words does not need another explanation. Acknowledge or say goodbye naturally and record ended true when done.' : '';
      const repetition=state.seller_repeated_commitment ? 'The caller has repeated an already-agreed action without adding new information. Do not re-list requirements or offer another substantive explanation; a brief acknowledgment or ending is enough unless something actually remains unresolved.' : '';
      const attention=state.buyer_attention==='rushed' ? 'You have said your time is limited. Let your actual attention, disclosure and patience reflect that unless you have chosen to stay longer.' : '';
      if(cue || repetition || attention)response={...response,instructions:[response.instructions,cue,repetition,attention].filter(Boolean).join('\n')};
    }
    // A normal reply requires an actual fresh caller turn. Silence, greeting,
    // pause and silent tool completion are explicit controlled exceptions.
    if(!greeting && (this.observe ? !this.observeRepPending : !this.inputTurns.size))return;
    if(response.instructions) {
      if(!this.buyerInstructions){this.fail(new Error('Buyer instructions are unavailable. Start a new call.'));return;}
      response={...response,instructions:`${this.buyerInstructions}\nCURRENT TURN CONTROL — this defines the purpose of this response and takes priority over general commercial behavior. Remain the assigned buyer, never the Salesforce representative. Your own previous question is not a caller answer.\n${response.instructions}`};
    }
    if(!greeting)this.observeRepPending=false;
    this.responseHadSpeech=false;
    clearTimeout(this.replyTimer); clearTimeout(this.idleTimer);
    this.responsePending = true;
    this.latestRequestAt = Date.now();
    if (!continuation) this.replyRequestedAt = this.latestRequestAt;
    // Input transcription is independent of native audio understanding and may
    // finish after the buyer starts. Retain those items for the transcript/coach.
    for (const [id, turn] of this.inputTurns) this.submittedInputs.set(id, turn);
    while (this.submittedInputs.size > 120) this.submittedInputs.delete(this.submittedInputs.keys().next().value);
    this.inputTurns.clear(); this.speakingItem = null;
    this.blockMicrophone();
    if (!greeting) { this.repTurns++; this.onEvent({ type: 'rep.turn.submitted' }); }
    this.send({ type: 'response.create', response });
    clearTimeout(this.turnTimeout);
    this.turnTimeout = setTimeout(() => this.fail(new Error('The buyer did not start responding. End the session and try again.')), 30000);
  }
  handleInput(event) {
    if (this.mode !== 'simulation') return true;
    if (this.observe && (event.type.startsWith('input_audio_buffer.') || event.type.startsWith('conversation.item.input_audio_transcription.'))) return false;
    const id = event.item_id;
    if (event.type === 'input_audio_buffer.speech_started') {
      if (this.seenInputIds.has(id)) return false;
      this.seenInputIds.add(id);
      if (this.playbackBlocked || this.muted || this.paused) return false;
      clearTimeout(this.replyTimer); clearTimeout(this.idleTimer);
      this.speakingItem = id;
      if (!this.dialogue.has(id)) this.dialogue.set(id,{speaker:'seller',text:''});
      this.inputTurns.set(id, { stopped: false, committed: false, final: false, text: '', audioStart: event.audio_start_ms });
      return true;
    }
    const inputEvent = ['input_audio_buffer.speech_stopped', 'input_audio_buffer.committed',
      'conversation.item.input_audio_transcription.delta', 'conversation.item.input_audio_transcription.completed',
      'conversation.item.input_audio_transcription.failed'].includes(event.type);
    if (!inputEvent) return true;
    const submitted = this.submittedInputs.has(id);
    const turn = this.inputTurns.get(id) || this.submittedInputs.get(id);
    // Late fragments, echo during playback, or duplicate finals cannot take a turn.
    if (!turn || (this.playbackBlocked && !submitted)) return false;
    if (submitted && !event.type.startsWith('conversation.item.input_audio_transcription.')) return false;
    if (event.type === 'input_audio_buffer.speech_stopped') {
      turn.stopped = true;
      turn.stoppedAt = Date.now(); this.repStoppedAt = turn.stoppedAt;
      this.repLocalEndedAt = this.lastLocalSpeechAt || null;
      turn.audioDuration = Number.isFinite(event.audio_end_ms) && Number.isFinite(turn.audioStart) ? event.audio_end_ms - turn.audioStart : 0;
      if (this.speakingItem === id) this.speakingItem = null;
    }
    if (event.type === 'input_audio_buffer.committed') turn.committed = true;
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      if (turn.final) return false;
      turn.text += event.delta || '';
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      if (turn.final) return false;
      turn.final = true; turn.text = (event.transcript || '').trim();
      // Ignore empty/filler-only fragments; short real answers such as "yes" count.
      turn.usable = hasSpeech(turn.text);
    }
    if (event.type === 'conversation.item.input_audio_transcription.failed') {
      turn.final = true; turn.usable = false;
    }
    if (!submitted && turn.final && !turn.usable) {
      this.inputTurns.delete(id);
      this.send({ type: 'conversation.item.delete', item_id: id });
      if (!this.inputTurns.size) this.armIdle();
    }
    if (turn.final && turn.usable) { this.idleChecks = 0; this.recordDialogue(id,'seller',turn.text); }
    if (!submitted) this.scheduleReply();
    return event.type !== 'conversation.item.input_audio_transcription.completed' || turn.usable;
  }
  scheduleReply() {
    clearTimeout(this.replyTimer);
    if (this.closed || this.paused || this.switchingMicrophone || this.playbackBlocked || this.muted || this.speakingItem || !this.inputTurns.size) return;
    const turns = [...this.inputTurns.values()];
    if (turns.some(turn => !turn.stopped || !turn.committed)) return;
    // Native audio is already committed. Do not serialize buyer generation
    // behind a separate final-transcript event if streaming ASR has established
    // real speech. Every fragment still needs evidence; duration alone is never
    // sufficient. Late final text stays available to the transcript and coach.
    if (turns.some(turn => !turn.final && !hasSpeech(turn.text)) ||
        !turns.some(turn => turn.final ? turn.usable : hasSpeech(turn.text))) return;
    const stoppedAt = Math.max(...turns.map(turn => turn.stoppedAt || Date.now()));
    const grace = this.repTurns === 0 ? 175 : 70;
    const delay = Math.max(0, stoppedAt + grace - Date.now(), this.lastLocalSpeechAt + 180 - Date.now());
    this.replyTimer = setTimeout(() => {
      if (this.closed || this.paused || this.switchingMicrophone || this.playbackBlocked || this.muted || this.speakingItem) return;
      // Local speech can precede the server's speech_started event in transit.
      if (Date.now() - this.lastLocalSpeechAt < 180) { this.scheduleReply(); return; }
      this.requestBuyer();
    }, delay);
  }
  blockMicrophone() {
    clearTimeout(this.echoTail); this.playbackBlocked = true;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
    this.onPlayback(true);
  }
  releaseMicrophone() {
    clearTimeout(this.echoTail);
    // Allow residual room echo to decay before sending microphone audio again.
    this.echoTail = setTimeout(() => {
      if (this.closed || this.paused || this.playing || this.generating || this.responsePending) return;
      this.send({ type: 'input_audio_buffer.clear' });
      if (this.toolContinuation) {
        this.continueToolReply();
        return;
      }
      if (this.finishLifecycle() || this.lifecycleEnded) return;
      if (this.buyerState.ended || this.endAfterIdle || this.endAfterBuyer) { this.onEnded('Call ended'); return; }
      this.playbackBlocked = false;
      this.stream?.getAudioTracks().forEach(track => { track.enabled = !this.muted && !this.paused; });
      this.onPlayback(false); this.onStatus(this.muted ? 'Microphone muted' : 'Your turn · take your time');
      this.buyerReady();
    }, 220);
  }
  continueToolReply() {
    if (!this.toolContinuation || this.closed || this.paused || this.playing || this.generating || this.responsePending) return;
    this.toolContinuation = false;
    // A silent bookkeeping response has no room echo to wait for. Keep the
    // microphone protected and immediately ask for the actual spoken reply.
    this.requestBuyer({ tool_choice: 'none', instructions: this.buyerState.ended ? 'Finish this call with your natural brief closing words. Do not invent a caller turn.' : 'Give your natural spoken reply to the caller using your own situation and the actual conversation. Do not narrate private state or greet again.' }, true, true);
  }
  handlePlayback(event) {
    if (this.mode !== 'simulation') return;
    const responseId = event.response?.id || event.response_id;
    if(event.type==='response.output_audio_transcript.done' && (!this.activeResponseId || !responseId || responseId===this.activeResponseId))this.recordDialogue(event.item_id || responseId,'buyer',event.transcript);
    if (event.type === 'response.created') {
      clearTimeout(this.turnTimeout); this.responsePending = false; this.activeResponseId = responseId;
      this.interruptPending = false; this.playbackFinished = false; this.generating = true; this.blockMicrophone();
      if (this.paused || this.resumeBuyer) this.interrupt();
    }
    else if (responseId && this.activeResponseId && responseId !== this.activeResponseId) return;
    if(['output_audio_buffer.started','response.output_audio.delta','response.output_audio_transcript.delta','response.output_audio_transcript.done'].includes(event.type))this.responseHadSpeech=true;
    if (event.type === 'output_audio_buffer.started') {
      if (this.repStoppedAt && this.replyRequestedAt) {
        const now = Date.now();
        const timing = { endToAudioMs: now - this.repStoppedAt, requestToAudioMs: now - this.replyRequestedAt,
          turnGateMs: this.replyRequestedAt - this.repStoppedAt,
          lastRequestToAudioMs: now - this.latestRequestAt,
          estimatedSpeechToAudioMs: this.repLocalEndedAt ? now - this.repLocalEndedAt : null };
        this.timings.push(timing); this.onEvent({ type: 'voice.timing', timing }); this.repStoppedAt = 0;
      }
      this.playing = true; this.playbackFinished = false; this.blockMicrophone(); }
    if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared') { this.playing = false; this.playbackFinished = true; this.releaseMicrophone(); }
    if (event.type === 'response.done') {
      if(responseId && this.completedResponses.has(responseId))return;
      if(responseId)this.completedResponses.add(responseId);
      if(this.completedResponses.size>200)this.completedResponses.delete(this.completedResponses.values().next().value);
      this.generating = false;
      const calls = event.response?.output?.filter(item => item.type === 'function_call' && item.name === 'update_buyer_state') || [];
      for (const call of calls) {
        if (this.toolCalls.has(call.call_id)) continue;
        this.toolCalls.add(call.call_id);
        try {
          const state = JSON.parse(call.arguments);
          for (const field of ['engagement', 'trust', 'relevance', 'disclosure', 'next_step_willingness', 'outcome']) if (typeof state[field] === 'string') this.buyerState[field] = state[field].slice(0, 700);
          if (typeof state.ended === 'boolean') this.buyerState.ended = state.ended;
        } catch {}
        this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: '{"recorded":true}' } });
      }
      const hasAudio = event.response?.output?.some(item => item.content?.some(part => ['audio', 'output_audio'].includes(part.type)));
      const hasMessage = event.response?.output?.some(item=>item.content?.some(part=>['text','output_text'].includes(part.type) && part.text?.trim()));
      this.toolContinuation = Boolean(calls.length && !hasAudio && !hasMessage && !this.responseHadSpeech && event.response?.status === 'completed');
      // Generation completion is NOT playback completion. Only failures or a response
      // with explicitly no audio can release without the audio-buffer event.
      if (this.toolContinuation && !this.playing && !this.paused) this.continueToolReply();
      else if (!this.playing && (this.playbackFinished || ['failed', 'cancelled'].includes(event.response?.status) || (Array.isArray(event.response?.output) && !hasAudio))) this.releaseMicrophone();
    }
    if (['response.done', 'output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) this.onPlayback(this.playbackBlocked);
    this.continueAfterPause();
  }
  setPaused(value) {
    this.liveSpeakers?.setEnabled(!value && !this.muted);
    this.directAudio?.setEnabled(!value && !this.muted);
    if (this.closed || this.paused === value) return;
    this.paused = value;
    clearTimeout(this.replyTimer); clearTimeout(this.idleTimer);
    if (value) {
      this.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
      if (this.audio) this.audio.muted = true;
      this.resumeBuyer = this.mode === 'simulation' && (this.playing || this.generating || this.responsePending);
      if (this.resumeBuyer) this.interrupt();
      this.onStatus('Conversation paused');
    } else if (this.resumeBuyer) {
      this.onStatus('Resuming conversation…');
      this.continueAfterPause();
    } else {
      if (this.audio) this.audio.muted = this.mode === 'speakerphone';
      if (this.playbackBlocked) this.releaseMicrophone();
      else this.stream?.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
      this.scheduleReply();
      this.onStatus(this.muted ? 'Microphone muted' : 'Listening');
      if (!this.playbackBlocked) this.buyerReady();
    }
    this.onPlayback(this.playbackBlocked);
  }
  continueAfterPause() {
    if (this.closed || this.paused || !this.resumeBuyer || this.playing || this.generating || this.responsePending) return;
    this.resumeBuyer = false;
    if (this.audio) this.audio.muted = false;
    // The server truncates unheard audio when we clear it. Resume the thought
    // from that conversation state, rather than playing an old queued answer.
    this.requestBuyer({ instructions: 'The call was paused by the user and has now resumed. Briefly finish your interrupted thought based on the conversation so far. Do not greet again, restart the call, or invent a new reply from the rep. If your thought was already complete, briefly invite the rep to continue.' }, true);
  }
  interrupt() {
    if (this.closed || this.mode !== 'simulation' || this.interruptPending || !(this.playing || this.generating)) return;
    this.endAfterIdle = false; this.idleChecks = 0;
    this.interruptPending = true;
    if (this.generating) this.send({ type: 'response.cancel' });
    this.send({ type: 'output_audio_buffer.clear' });
    this.onPlayback(true);
    this.onStatus('Stopping buyer audio…');
  }
  buyerReady() { if (!this.finishLifecycle() && !this.lifecycleEnded) this.armIdle(); }
  armIdle() {
    clearTimeout(this.idleTimer);
    if (this.lifecycleEnded || this.lifecyclePending || this.observe || this.closed || this.paused || this.muted || this.playbackBlocked || this.speakingItem || this.inputTurns.size) return;
    // Transport liveness, not sales strategy. Silence is never a fabricated rep turn.
    const delay = this.idleChecks === 0 ? 5000 : 3000;
    this.idleTimer = setTimeout(() => this.checkIdle(), delay);
  }
  checkIdle() {
    if (this.closed || this.paused || this.muted || this.playbackBlocked || this.speakingItem || this.inputTurns.size || Date.now() - this.lastLocalSpeechAt < 1200) { this.armIdle(); return; }
    this.idleChecks++;
    this.endAfterIdle = this.idleChecks >= 3;
    if(this.endAfterIdle){this.onEnded('No response from caller');return;}
    this.requestBuyer({ tool_choice: 'none', instructions: 'No new caller words have arrived. This response is only a minimal check that the caller is still on the line. Give a small, brief check in your own ordinary voice, then stop. Do not discuss the business, offer more time, ask for a pitch or a one-sentence proposal, list possible topics, explain what would earn your interest, threaten departure or answer your own previous question. Do not repeat or complete an unfinished caller sentence. Do not turn it into a patient support-agent explanation, give instructions to say a particular word, or explain how to prove the connection is open. The app manages the remaining silence and hang-up; you only check the connection.' }, true);
  }
  async playRing() {
    const context = this.audioContext;
    await context.resume();
    if (this.closed) return;
    const gain = context.createGain();
    const start = context.currentTime;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.055, start + 0.025);
    gain.gain.setValueAtTime(0.055, start + 1.4);
    gain.gain.linearRampToValueAtTime(0, start + 1.45);
    gain.connect(context.destination);
    const tones = [440, 480].map(frequency => {
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      return oscillator;
    });
    await new Promise(resolve => {
      const finish = () => {
        if (this.finishRing !== finish) return;
        this.finishRing = null;
        for (const tone of tones) { tone.onended = null; tone.stop(); tone.disconnect(); }
        gain.disconnect(); resolve();
      };
      this.finishRing = finish;
      tones.at(-1).onended = finish;
      // A brief quiet gap separates the local ring from the buyer's greeting.
      for (const tone of tones) { tone.start(start); tone.stop(start + 1.65); }
    });
  }
  send(event) { if (!this.closed && this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event)); }
  setMuted(value) {
    this.liveSpeakers?.setEnabled(!value && !this.paused);
    this.directAudio?.setEnabled(!value && !this.paused);
    this.muted = value;
    if (value) { clearTimeout(this.replyTimer); clearTimeout(this.idleTimer); }
    else if (this.mode === 'simulation') { this.scheduleReply(); this.armIdle(); }
    this.stream?.getAudioTracks().forEach(track => { track.enabled = !value && !this.playbackBlocked && !this.paused; });
    this.onStatus(value ? 'Microphone muted' : this.playbackBlocked ? 'Buyer is speaking · mic protected' : 'Listening');
  }
  startMeter(stream) {
    clearInterval(this.meter); this.source?.disconnect(); this.analyser?.disconnect?.();
    this.audioContext ||= new AudioContext();
    this.source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.analyser = this.audioContext.createAnalyser(); analyser.fftSize = 256;
    this.source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    this.meter = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / data.length);
      if (this.mode === 'simulation' && !this.paused && !this.muted && !this.playbackBlocked && rms > 0.02) this.lastLocalSpeechAt = Date.now();
      this.onLevel(this.muted || this.paused ? 0 : Math.min(1, rms * 6));
    }, 80);
  }
  fail(error) { if (this.closed) return; this.stop(); this.onError(error); }
  stop() {
    this.liveSpeakers?.stop();
    this.directAudio?.stop();
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.deviceTimer);
    if (this.deviceChangeHandler) navigator.mediaDevices.removeEventListener?.('devicechange', this.deviceChangeHandler);
    this.finishRing?.();
    clearTimeout(this.idleTimer); clearTimeout(this.openTimer); clearTimeout(this.disconnectTimer); clearTimeout(this.echoTail); clearTimeout(this.replyTimer); clearTimeout(this.turnTimeout); clearInterval(this.meter);
    this.rejectOpen?.(new Error('Session ended.')); this.rejectOpen = null;
    this.channel?.close(); this.pc?.close();
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.source?.disconnect(); this.analyser?.disconnect?.(); this.audioContext?.close().catch(() => {});
    this.onLevel(0);
  }
}

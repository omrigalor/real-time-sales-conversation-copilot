import { VoiceSession } from './session.js';

// Reuses the independent Realtime buyer. Only audible seller words cross this
// boundary; no coach objective, recommendation, review or private state does.
export class ObserveSession extends VoiceSession {
  constructor(options) {
    super({ ...options, trainingMode: 'observe' });
    this.getContext = options.getContext;
    this.repBusy = false; this.sellerTurns = 0; this.alreadyGaveSpace = false;
  }
  handlePlayback(event) {
    if (event.type === 'response.created') this.buyerTranscriptReady = false;
    super.handlePlayback(event);
  }
  handleInput(event) {
    const accepted = super.handleInput(event);
    if (accepted && event.type === 'response.output_audio_transcript.done') {
      this.buyerTranscriptReady = true;
      // Renderer commits the buyer text after this callback returns.
      queueMicrotask(() => { if (!this.playbackBlocked) this.buyerReady(); });
    }
    return accepted;
  }
  buyerReady() {
    if (this.lifecyclePending || this.lifecycleEnded || this.finishLifecycle() || this.closed || this.paused || !this.buyerTranscriptReady || this.repBusy || this.repAudio || this.pendingRep || this.pendingSilence || this.responsePending || this.generating || this.playing) return;
    clearTimeout(this.observeTimer);
    this.observeTimer = setTimeout(() => this.nextRep(), 100);
  }
  async nextRep() {
    if (this.lifecycleEnded || this.finishLifecycle() || this.closed || this.paused || this.repBusy || this.repAudio || this.generating || this.playing || this.responsePending) return;
    // Explicit cost/runaway guard, never classified as a simulated sales loss.
    if (this.sellerTurns >= 60) { this.onEnded('Observe reached its 60-turn session limit'); return; }
    this.repBusy = true; this.onStatus('AI rep is considering the conversation…');
    try {
      const result = await this.bridge.observe({ ...this.getContext(), mode: 'simulation', alreadyGaveSpace: this.alreadyGaveSpace });
      if (this.closed) return;
      this.pendingRep = result;
      if (!this.paused) this.playRep();
    } catch (error) { if (!this.closed) this.fail(error); }
    finally { this.repBusy = false; }
  }
  playRep() {
    if (this.closed || this.paused || !this.pendingRep) return;
    const result = this.pendingRep; this.pendingRep = null;
    if (result.action !== 'SAY') {
      this.alreadyGaveSpace = true; this.onStatus('AI rep is giving the buyer room…');
      this.pendingSilence = true;
      this.observeTimer = setTimeout(() => this.continueSilence(), 2400);
      return;
    }
    this.alreadyGaveSpace = false;
    this.repResult = result;
    this.repAudioURL = URL.createObjectURL(new Blob([result.audio], { type: 'audio/wav' }));
    const audio = this.repAudio = new Audio(this.repAudioURL);
    this.onStatus('AI Salesforce rep is speaking');
    this.onEvent({ type: 'observe.rep.started', text: result.say });
    audio.onended = () => this.finishRep();
    audio.onerror = () => this.fail(new Error('Could not play the AI rep’s voice. Start Observe again.'));
    audio.play().catch(error => this.fail(error));
  }
  finishRep() {
    if (this.closed || !this.repResult) return;
    // If a playback event races with Pause, retain the completed turn for Resume.
    if (this.paused) { this.repFinishedWhilePaused = true; return; }
    const result = this.repResult; this.repResult = null;
    this.releaseRepAudio(); this.sellerTurns++;
    const id = `observe_rep_${this.sellerTurns}`;
    this.send({ type: 'conversation.item.create', item: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text: result.say }] } });
    this.recordDialogue(id,'seller',result.say);
    this.onEvent({ type: 'observe.rep.completed', item_id: id, text: result.say });
    this.endAfterBuyer = result.endCall;
    this.observeRepPending = true;
    this.requestBuyer();
  }
  continueSilence() {
    if (this.closed || this.paused || !this.pendingSilence) return;
    this.pendingSilence = false;
    this.requestBuyer({ instructions: 'The caller is deliberately leaving a brief space after your last reply. React naturally only from your own situation: you may elaborate if you have something to add, or briefly check what the caller thinks. Do not invent caller speech, restart the greeting, supply a sales plan or fabricate new facts merely to fill silence.' }, true);
  }
  setPaused(value) {
    if (value) { clearTimeout(this.observeTimer); this.repAudio?.pause(); }
    super.setPaused(value);
    if (!value) {
      if (this.repFinishedWhilePaused) { this.repFinishedWhilePaused = false; this.finishRep(); }
      else if (this.repAudio) this.repAudio.play().catch(error => this.fail(error));
      else if (this.pendingRep) this.playRep();
      else if (this.pendingSilence) this.observeTimer = setTimeout(() => this.continueSilence(), 2400);
      else this.buyerReady();
    }
  }
  releaseRepAudio() {
    if (this.repAudio) { this.repAudio.onended = this.repAudio.onerror = null; this.repAudio.pause(); this.repAudio.src = ''; this.repAudio = null; }
    if (this.repAudioURL) { URL.revokeObjectURL(this.repAudioURL); this.repAudioURL = null; }
  }
  stop() { clearTimeout(this.observeTimer); this.releaseRepAudio(); this.pendingRep = null; super.stop(); }
}

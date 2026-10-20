// Optional direct call capture. Only the mixed AUDIO track leaves this module.
// The native picker is deliberate: never silently choose a desktop or fall back
// to mic-only capture and imply that the remote party is connected.
export class MacCallAudio {
  constructor({onError, onLevel = () => {}, media = navigator.mediaDevices, Context = AudioContext}) {
    Object.assign(this, {onError, onLevel, media, Context});
    this.closed = false; this.enabled = true; this.inputs = []; this.nodes = [];
  }
  async open() {
    try {
      if (!this.media.getDisplayMedia) throw new Error('Direct call capture is unavailable. Choose Room microphone instead.');
      const call = await this.media.getDisplayMedia({audio: true, video: {frameRate: 1}, systemAudio: 'include'});
      if (this.closed) { call.getTracks().forEach(t => t.stop()); return null; }
      this.inputs.push(call);
      // Display capture requires a video request, but we discard video immediately.
      call.getVideoTracks().forEach(t => t.stop());
      if (!call.getAudioTracks().some(t => t.readyState === 'live')) throw new Error('No call audio was shared. Enable audio in the macOS picker, or choose Room microphone.');
      const mic = await this.media.getUserMedia({audio: {deviceId: {ideal:'default'}, channelCount:{ideal:1}, echoCancellation:true, noiseSuppression:true, autoGainControl:true}, video:false});
      if (this.closed) { mic.getTracks().forEach(t => t.stop()); return null; }
      this.inputs.push(mic);
      if (!mic.getAudioTracks().some(t => t.readyState === 'live')) throw new Error('Your microphone is unavailable. Check Mac Sound settings.');
      if (!call.getAudioTracks().some(t => t.readyState === 'live')) throw new Error('Call audio sharing stopped before your microphone connected. Start listening again.');
      for (const stream of this.inputs) for (const track of stream.getAudioTracks()) {
        track.onended = () => { if (!this.closed) { this.stop(); this.onError(new Error('Call audio or microphone disconnected. Start listening again, or choose Room microphone.')); } };
      }
      const context = this.context = new this.Context();
      const output = this.output = context.createMediaStreamDestination();
      this.meters = this.inputs.map(stream => {
        const source = context.createMediaStreamSource(stream), gain = context.createGain(), meter = context.createAnalyser();
        // Headroom when people overlap. No local monitoring/feedback connection.
        gain.gain.value = 0.7; meter.fftSize = 256;
        source.connect(meter); source.connect(gain); gain.connect(output);
        this.nodes.push(source,gain,meter);
        return {meter, data:new Uint8Array(meter.fftSize)};
      });
      await context.resume();
      if (this.closed) return null;
      this.timer = setInterval(() => this.sample(), 150);
      return output.stream;
    } catch (error) {
      const cancelled = this.closed; this.stop();
      if (cancelled) return null;
      if (error?.name === 'NotAllowedError') throw new Error('Audio sharing was not allowed. Start again and allow macOS capture, or choose Room microphone.');
      throw error;
    }
  }
  sample() {
    if (this.closed) return;
    const [call,mic] = this.meters.map(({meter,data}) => {
      meter.getByteTimeDomainData(data);
      return this.enabled ? Math.min(1,Math.sqrt(data.reduce((s,v)=>s+((v-128)/128)**2,0)/data.length)*6) : 0;
    });
    this.onLevel({call,mic});
  }
  setEnabled(value) {
    this.enabled=value;
    for (const stream of [...this.inputs, this.output?.stream].filter(Boolean)) stream.getAudioTracks().forEach(t=>{t.enabled=value;});
    if (!value) this.onLevel({call:0,mic:0});
  }
  stop() {
    if (this.closed) return;
    this.closed=true; clearInterval(this.timer);
    for (const stream of [...this.inputs,this.output?.stream].filter(Boolean)) stream.getTracks().forEach(t=>{t.onended=null;t.stop();});
    this.nodes.forEach(n=>n.disconnect());
    this.context?.close().catch(()=>{});
    this.onLevel({call:0,mic:0});
  }
}

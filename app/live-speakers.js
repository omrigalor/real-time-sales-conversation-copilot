export function pcmWav(chunks,rate){
  const input=new Float32Array(chunks.reduce((sum,chunk)=>sum+chunk.length,0));
  let offset=0;for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
  const outputRate=16000,count=Math.floor(input.length*outputRate/rate),bytes=new Uint8Array(44+count*2),view=new DataView(bytes.buffer);
  const ascii=(offset,value)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
  ascii(0,'RIFF');view.setUint32(4,bytes.length-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,outputRate,true);view.setUint32(28,outputRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){const a=Math.floor(i*rate/outputRate),b=Math.max(a+1,Math.floor((i+1)*rate/outputRate));let sum=0;for(let j=a;j<b&&j<input.length;j++)sum+=input[j];view.setInt16(44+i*2,Math.max(-1,Math.min(1,sum/(b-a)))*32767,true);}
  return bytes;
}

export class LiveSpeakers {
  constructor({bridge,onEvidence,onStatus}){Object.assign(this,{bridge,onEvidence,onStatus});this.chunks=[];this.samples=0;this.sequence=0;this.closed=false;this.pending=false;this.busy=false;this.enabled=true;}
  async start(stream){
    if(!this.bridge.diarize || typeof AudioWorkletNode==='undefined')return;
    try{
      this.context=new AudioContext();await this.context.audioWorklet.addModule('copilot://app/speaker-capture-worklet.js');
      if(this.closed)return;
      this.node=new AudioWorkletNode(this.context,'speaker-capture');this.source=this.context.createMediaStreamSource(stream);this.sink=this.context.createGain();this.sink.gain.value=0;
      this.node.port.onmessage=({data})=>{if(this.closed||!this.enabled)return;this.chunks.push(data);this.samples+=data.length;while(this.samples>this.context.sampleRate*30&&this.chunks.length>1)this.samples-=this.chunks.shift().length;};
      this.source.connect(this.node);this.node.connect(this.sink);this.sink.connect(this.context.destination);await this.context.resume();
    }catch{this.onStatus('Voice check unavailable · using transcript context');this.stop();}
  }
  turnCompleted(){if(this.closed||!this.enabled||!this.node)return;this.pending=true;clearTimeout(this.timer);this.timer=setTimeout(()=>this.check(),250);}
  async check(){
    if(this.closed||!this.enabled||this.busy||!this.pending||this.samples<(this.context?.sampleRate||1))return;
    this.pending=false;this.busy=true;const sequence=++this.sequence;
    const audio=pcmWav(this.chunks,this.context.sampleRate);
    try{const evidence=await this.bridge.diarize({mode:'speakerphone',audio});if(!this.closed&&this.enabled&&sequence===this.sequence){this.onEvidence({...evidence,clipId:sequence});this.onStatus('Voice + conversation context · labels remain correctable');}}
    catch{if(!this.closed)this.onStatus('Voice check unavailable · using transcript context');}
    finally{audio.fill(0);this.busy=false;if(this.pending&&!this.closed)this.timer=setTimeout(()=>this.check(),500);}
  }
  setEnabled(value){this.enabled=value;if(!value){this.sequence++;this.chunks=[];this.samples=0;this.pending=false;clearTimeout(this.timer);}}
  stop(){this.closed=true;this.sequence++;clearTimeout(this.timer);this.chunks=[];this.samples=0;this.node?.disconnect();this.source?.disconnect();this.sink?.disconnect();this.context?.close().catch(()=>{});}
}

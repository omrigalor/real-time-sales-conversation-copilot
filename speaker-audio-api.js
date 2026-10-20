import { apiError } from './api.js';

// A bounded, in-memory second pass. Voice IDs are local to this clip, not identities.
export async function diarizeAudio({key,payload,signal,fetcher=fetch}) {
  if(!key)throw new Error('Add your OpenAI key first.');
  if(payload?.mode!=='speakerphone')throw new Error('Speaker verification is for live calls only.');
  const bytes=payload.audio;
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<44||bytes.byteLength>1100000)throw new Error('Invalid speaker audio clip.');
  if(Buffer.from(bytes.subarray(0,4)).toString()!=='RIFF'||Buffer.from(bytes.subarray(8,12)).toString()!=='WAVE')throw new Error('Expected WAV audio.');
  const form=new FormData();
  form.set('file',new Blob([bytes],{type:'audio/wav'}),'live-speakers.wav');
  form.set('model','gpt-4o-transcribe-diarize');form.set('response_format','diarized_json');form.set('chunking_strategy','auto');
  const response=await fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',signal,headers:{Authorization:`Bearer ${key}`},body:form});
  if(!response.ok)throw await apiError(response);
  const result=await response.json();
  return {segments:(Array.isArray(result.segments)?result.segments:[]).slice(0,100).filter(s=>typeof s.text==='string'&&typeof s.speaker==='string'&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&s.end<=35).map(s=>({voice:s.speaker.slice(0,50),text:s.text.slice(0,1500),start:s.start,end:s.end}))};
}

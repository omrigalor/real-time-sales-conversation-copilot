export const THREAD_MEMORY_PROTOCOL = `PERSISTENT THREAD MEMORY (inside memory JSON)
Also include "threads":[{"id":"stable-topic-slug","kind":"known|inferred|unknown","topic":"pain|workflow|stakeholder|objection|commitment|question|priority|thread","summary":"one compact statement","turn":transcript_turn_number,"quote":"exact short evidence excerpt","status":"open|resolved"}]. These are incremental updates, not the full history. Usually update only one or two meaningful threads; do not summarize every sentence. Older threads survive without being re-emitted. Use stable IDs to refine or resolve a thread, with new spoken evidence; never delete something just because it left the recent transcript window.
Known means an identified buyer actually said it, not that the seller asserted it. Inferred is a tentative interpretation of cited words; unknown is a useful unresolved issue raised by the conversation. Keep exact speaker attribution and evidence. Do not turn a hypothesis into fact without new buyer confirmation. Recognize direct questions by conversational intent, not punctuation or keywords. Remember unanswered questions and mark them resolved when actually answered. Current buyer corrections outrank older memory. Revisit an older thread only if useful now; no checklist.`;

export function updateThreads(updates, turns, roles = [], previous = []) {
  const threads=new Map(previous.map(t=>[t.id,t]));
  for(const item of (Array.isArray(updates)?updates:[]).slice(0,6)) {
    if(!item || !/^[a-z0-9-]{1,64}$/.test(item.id) || !['known','inferred','unknown'].includes(item.kind) || typeof item.summary!=='string' || !item.summary.trim() || !Number.isInteger(item.turn)) continue;
    const turn=turns[item.turn], quote=typeof item.quote==='string'?item.quote.trim():'';
    const speaker=['manual','native'].includes(turn?.speakerSource)?turn.speaker:roles.find(r=>r.id===turn?.id)?.speaker;
    if(!turn || quote.length<3 || !turn.text.toLowerCase().includes(quote.toLowerCase()) || !['buyer','seller'].includes(speaker) || (item.kind==='known'&&speaker!=='buyer')) continue;
    const prior=threads.get(item.id);
    if(prior && prior.kind!=='known' && item.kind==='known' && prior.turnId===turn.id) continue;
    threads.set(item.id,{id:item.id,kind:item.kind,topic:['pain','workflow','stakeholder','objection','commitment','question','priority','thread'].includes(item.topic)?item.topic:'thread',summary:item.summary.trim().slice(0,220),quote:quote.slice(0,240),speaker,turnId:turn.id,status:item.status==='resolved'?'resolved':'open'});
  }
  // Retain active threads first; storage is compact and session-local, not a score.
  return [...threads.values()].sort((a,b)=>(a.status==='resolved')-(b.status==='resolved')).slice(0,24);
}
export function memoryContext(memory = {}) {
  const threads=(Array.isArray(memory.threads)?memory.threads:[]).slice(0,24).filter(t=>t && ['known','inferred','unknown'].includes(t.kind) && ['buyer','seller'].includes(t.speaker)).map(t=>Object.fromEntries(['id','kind','topic','summary','quote','speaker','turnId','status'].map(k=>[k,typeof t[k]==='string'?t[k].slice(0,240):''])));
  const step=memory.next_step;
  const attempts=(Array.isArray(memory.objection_attempts)?memory.objection_attempts:[]).slice(-6).filter(a=>a && ['relevance','meeting'].includes(a.kind)).map(a=>Object.fromEntries(['id','kind','concern','quote','turnId'].map(k=>[k,String(a[k]||'').slice(0,240)])));
  return {threads,objection_attempts:attempts,next_step:step && ['agreed','declined','proposed'].includes(step.state)?{state:step.state,detail:String(step.detail||'').slice(0,160),quote:String(step.quote||'').slice(0,200),turnId:String(step.turnId||'').slice(0,100)}:null};
}

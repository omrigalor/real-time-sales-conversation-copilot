import { readFile, readdir } from 'node:fs/promises';
const root = new URL('../corpus/batch1/',import.meta.url);
const entries=(await readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory());
for (const entry of entries) {
  const base=new URL(entry.name+'/',root);
  const [meta,dialogue,analysis]=await Promise.all(['metadata.json','dialogue.json','analysis.json'].map(async name=>JSON.parse(await readFile(new URL(name,base),'utf8'))));
  for (const field of ['role','call_type','stage','direction','persona','seniority','company_segment','industry','duration_seconds','supplied_outcome','result','source','outcome_known','limitations']) if (!(field in meta)) throw new Error(`${entry.name}: missing metadata ${field}`);
  if (meta.source.kind!=='synthetic' || meta.source.provider!=='user') throw new Error('Batch 1 provenance changed.');
  const sellerTurns=dialogue.map((t,i)=>t.speaker==='seller'?i:null).filter(i=>i!==null);
  if (JSON.stringify(sellerTurns)!==JSON.stringify(analysis.turns.map(t=>t.turn))) throw new Error(`${entry.name}: seller-turn annotation missing or duplicated`);
  for (const turn of analysis.turns) for (const field of ['context','seller_objective','buyer_signal','possible_moves','chosen_move','buyer_reaction','lesson','confidence']) if (!turn[field]) throw new Error(`${entry.name}: missing ${field}`);
}
const library=JSON.parse(await readFile(new URL('../knowledge/bdr-batch1.json',import.meta.url),'utf8'));
const ids=new Set(entries.map(x=>x.name));
for (const principle of library.principles) {
  if (!principle.confidence || !principle.exceptions || principle.support.length<2) throw new Error('Distilled principle needs qualified confidence, alternatives and comparison evidence.');
  for (const id of [...principle.support,...principle.contrast]) if (!ids.has(id)) throw new Error(`Unknown evidence: ${id}`);
}
console.log(`Validated ${entries.length} synthetic conversations and ${library.principles.length} provisional comparative principles. No behavioral efficacy claim.`);

import path from 'node:path';
import { runSuite } from '../evaluation/runner.js';
const flags = new Set(process.argv.slice(2));
const directory=path.resolve('evaluation/runs',new Date().toISOString().replace(/[:.]/g,'-'));
const variants=flags.has('--openings')?['before-opening','current']:flags.has('--buyer-realism')?['level-1','level-3','level-5']:flags.has('--realism')?['current']:(flags.has('--cross-mode')||flags.has('--intelligence'))?['before-training','current']:flags.has('--ablation')?['current-without-batch1','current']:flags.has('--pre-batch')?['baseline','current']:['before-pacing','current'];
const report=await runSuite({key:flags.has('--preview')?'':process.env.OPENAI_API_KEY,directory,variants,extended:!flags.has('--original'),crossMode:flags.has('--cross-mode'),intelligence:flags.has('--intelligence'),realism:flags.has('--realism'),buyerRealism:flags.has('--buyer-realism'),openingReview:flags.has('--openings'),onProgress:p=>console.log(`Case ${p.case}/${p.total}: ${p.variant}`)});
console.log(`${report.status}\n${directory}/report.html`);
if (!process.env.OPENAI_API_KEY && !flags.has('--preview')) process.exitCode=2;

import { accountKey, normalizeLibrary, saveToLibrary } from './account-library.js';
import { upgradeTargetBrief } from './researched-target.js';
import { researchedPandora, upgradePandoraBrief } from './researched-pandora.js';

// One-time library addition. Never replace an edited saved account with a seed.
export function updateResearchLibrary({accountBrief,accountLibrary,researchedDefaultVersion=0}) {
  let brief=upgradePandoraBrief(upgradeTargetBrief(accountBrief));
  let library=normalizeLibrary(accountLibrary).map(upgradeTargetBrief).map(upgradePandoraBrief);
  if(researchedDefaultVersion<2){
    const seed=researchedPandora();
    const existing=library.find(a=>accountKey(a)===accountKey(seed));
    if(!existing)library=saveToLibrary(library,seed);
    if(!brief || brief.demo || accountKey(brief)==='target corporation|mark weinstein'){
      if(brief && !brief.demo)library=saveToLibrary(library,brief);
      brief=existing||seed;
    }
  }
  return {accountBrief:brief,accountLibrary:library,researchedDefaultVersion:Math.max(2,researchedDefaultVersion)};
}

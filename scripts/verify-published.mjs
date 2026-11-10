import fs from 'node:fs';
import crypto from 'node:crypto';
const base='https://460728888-alt.github.io/allen-prototype/';
const files=['index.html','personal-app.js','personal-domain.js','personal-store.js','study-compare.js','study-panel.js','study-audit.json','training-review.js','training-review.json','long-training-review.js','long-training-review.json','research-domain.js','research-ui.js','research-review.js','data-health.js','personal.css'];
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const root=new URL('..',import.meta.url);
let finalError;
for(let attempt=0;attempt<18;attempt++){
 try{
  for(const file of files){
   const response=await fetch(base+file+'?verify='+Date.now(),{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error(file+' HTTP '+response.status);
   const published=await response.text(),expected=fs.readFileSync(new URL(file,root),'utf8');
   if(hash(published)!==hash(expected))throw Error(file+' still differs from published source');
  }
  const load=async file=>{const r=await fetch(base+file+'?verify='+Date.now(),{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(file+' HTTP '+r.status);return r.json()};
  const status=await load('data/status.json'),market=await load('data/market.json'),calendar=await load('data/calendar.json');
  if(status.schema!==1||!['ok','partial','failed','unavailable'].includes(status.state)||market.schema!==1||!Array.isArray(market.stocks)||!Array.isArray(calendar.sessions))throw Error('Published data format unavailable');
  if(['ok','partial'].includes(status.state)&&status.generatedAt!==market.generatedAt)throw Error('Published market and status versions differ');
  const sample=market.stocks.find(s=>s.data?.state==='ok');
  if(sample){
   if(!/^data\/stocks\/\d{6}\.(SS|SZ)\.json$/.test(sample.detailPath))throw Error('Unsafe detail path');
   const detail=await load(sample.detailPath);
   if(detail.symbol!==sample.symbol||detail.dataThrough!==sample.dataThrough||detail.generatedAt!==sample.generatedAt)throw Error('Published detail and market snapshots differ');
  }
  const researchStatus=await load('data/research-status.json'),researchIndex=await load('data/research-index.json');
  if(researchStatus.schema!==1||researchIndex.schema!==1||!researchIndex.symbols)throw Error('Published research context unavailable');
  if(['ok','partial'].includes(researchStatus.state)&&!researchStatus.preservedPrevious&&researchStatus.generatedAt!==researchIndex.generatedAt)throw Error('Published research status and index versions differ');
  const researchEntry=Object.entries(researchIndex.symbols)[0];let researchSample=null;
  if(researchEntry){
   const [symbol,entry]=researchEntry;
   if(entry.path!=='data/research/'+symbol+'.json'||!/^\d{6}\.(SS|SZ)$/.test(symbol))throw Error('Unsafe research path');
   const detail=await load(entry.path);if(detail.symbol!==symbol||detail.bundleId!==entry.bundleId)throw Error('Published research bundle version differs');
   researchSample={symbol,bundleId:detail.bundleId,company:detail.company?.state,financial:detail.financial?.state,announcements:detail.announcements?.state};
  }
  console.log('PAGES_LIVE_STATUS='+JSON.stringify({page:base,checkedAt:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA||null,assets:files,status:status.state,dataThrough:market.dataThrough,coverage:status.coverage,sample:sample?.symbol||null,research:{state:researchStatus.state,counts:researchStatus.storedCounts,sample:researchSample}}));
  process.exit(0);
 }catch(error){finalError=error;console.log('Waiting for published files, attempt '+(attempt+1)+': '+error.message);if(attempt<17)await new Promise(resolve=>setTimeout(resolve,10000))}
}
throw finalError||Error('Published files not verified');

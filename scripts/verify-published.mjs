import fs from 'node:fs';
import crypto from 'node:crypto';
const base='https://460728888-alt.github.io/allen-prototype/';
const files=['index.html','personal-app.js','personal-domain.js','personal-store.js','personal.css'];
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
  const sample=market.stocks.find(s=>s.data?.state==='ok');
  if(sample){
   if(!/^data\/stocks\/\d{6}\.(SS|SZ)\.json$/.test(sample.detailPath))throw Error('Unsafe detail path');
   const detail=await load(sample.detailPath);
   if(detail.symbol!==sample.symbol||detail.dataThrough!==sample.dataThrough||detail.generatedAt!==sample.generatedAt)throw Error('Published detail and market snapshots differ');
  }
  console.log('PAGES_LIVE_STATUS='+JSON.stringify({page:base,checkedAt:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA||null,assets:files,status:status.state,dataThrough:market.dataThrough,coverage:status.coverage,sample:sample?.symbol||null}));
  process.exit(0);
 }catch(error){finalError=error;console.log('Waiting for published files, attempt '+(attempt+1)+': '+error.message);if(attempt<17)await new Promise(resolve=>setTimeout(resolve,10000))}
}
throw finalError||Error('Published files not verified');

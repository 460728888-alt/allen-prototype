import fs from 'node:fs';
import path from 'node:path';
import {assertProtocol,parseProvider,buildDataset,hash} from './dataset.mjs';

if (process.env.DATABASE_URL || process.env.AI_API_KEY) throw Error('Production credentials are forbidden');
const protocolPath = new URL('./protocol.json',import.meta.url), calendarPath = new URL('./calendar.json',import.meta.url);
const protocolText = fs.readFileSync(protocolPath,'utf8'), calendarText = fs.readFileSync(calendarPath,'utf8');
const protocol = assertProtocol(JSON.parse(protocolText)), calendar = JSON.parse(calendarText);
const out = path.resolve(process.argv[2] || 'experiment-out');
if (fs.existsSync(out)) throw Error('Refusing to replace an existing experiment directory');
fs.mkdirSync(path.join(out,'raw'),{recursive:true});
const frozenAt = new Date().toISOString();
fs.writeFileSync(path.join(out,'protocol.json'),protocolText,{flag:'wx'});
fs.writeFileSync(path.join(out,'calendar.json'),calendarText,{flag:'wx'});
fs.writeFileSync(path.join(out,'frozen-before-download.json'),JSON.stringify({
  frozenAt,protocolByteSha256:hash(protocolText),calendarByteSha256:hash(calendarText),
  sourceCommit:process.env.GITHUB_SHA || null,finalTestRequested:false
},null,2),{flag:'wx'});
const symbols = [...protocol.universe.map(x=>x.symbol),protocol.benchmark];
const period1 = Math.floor(Date.parse(protocol.requestFrom+'T00:00:00+08:00')/1000);
const period2 = Math.floor((Date.parse(protocol.requestThrough+'T00:00:00+08:00')+86400000)/1000);
const series=[], downloads=[], rawHashes={}; let next=0; const deadline=Date.now()+6*60*1000;
async function worker() {
  while (next<symbols.length) {
    const symbol=symbols[next++], attempts=[]; let ok=false;
    if(Date.now()>=deadline){downloads.push({symbol,state:'failed',attempts:[],reason:'time_budget_not_requested'});continue;}
    for (const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']) {
      const url='https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol)+'?period1='+period1+'&period2='+period2+'&interval=1d&events=div%2Csplits';
      try {
        const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 AllenIsolatedResearch/1','Accept':'application/json'},signal:AbortSignal.timeout(20000)});
        const raw=await response.text(), file=symbol+'.'+host+'.json';
        fs.writeFileSync(path.join(out,'raw',file),raw,{flag:'wx'});
        rawHashes[file]=hash(raw);
        if (!response.ok) throw Error('HTTP '+response.status);
        const body=JSON.parse(raw), result=body.chart?.result?.[0];
        if (!result) throw Error(body.chart?.error?.description || 'empty_chart');
        const parsed=parseProvider(result,symbol,protocol);
        series.push(parsed);
        attempts.push({host,state:'received',sha256:hash(raw)});
        downloads.push({symbol,state:'received',attempts,rows:parsed.rows.length,dataFrom:parsed.rows[0].date,
          dataThrough:parsed.rows.at(-1).date,downloadedAt:new Date().toISOString()});
        console.log('HISTORY '+symbol+' received '+parsed.rows.length+' rows'); ok=true; break;
      } catch(error) {
        attempts.push({host,state:'failed',reason:String(error.message).slice(0,300)});
      }
    }
    if (!ok) {
      downloads.push({symbol,state:'failed',attempts});
      console.log('HISTORY '+symbol+' FAILED '+attempts.map(x=>x.reason).join('; '));
    }
  }
}
console.log('FROZEN_EXPERIMENT '+protocol.id+'; 2026 NOT REQUESTED');
try {
  await Promise.all([worker(),worker()]);
  series.sort((a,b)=>a.symbol.localeCompare(b.symbol)); downloads.sort((a,b)=>a.symbol.localeCompare(b.symbol));
  fs.writeFileSync(path.join(out,'series.json'),JSON.stringify(series),{flag:'wx'});
  fs.writeFileSync(path.join(out,'downloads.json'),JSON.stringify(downloads,null,2),{flag:'wx'});
  const dataset=buildDataset({protocol,calendar,series,downloads,rawHashes,sourceCommit:process.env.GITHUB_SHA || null});
  fs.writeFileSync(path.join(out,'dataset.json'),JSON.stringify(dataset),{flag:'wx'});
  console.log('DATASET_COVERAGE '+JSON.stringify(dataset.coverage));
  console.log('DATASET_EXCLUSIONS '+JSON.stringify(dataset.exclusionReasons));
} catch(error) {
  fs.writeFileSync(path.join(out,'data-failure.json'),JSON.stringify({status:'unable_to_judge',reason:String(error.message),
    downloads,approved:false,probabilitiesEnabled:false},null,2),{flag:'wx'});
  throw error;
}

import fs from 'node:fs';
import {calendarExpectation} from '../lib/data-contract.js';
const calendar=JSON.parse(fs.readFileSync(new URL('../data/calendar.json',import.meta.url),'utf8')),now=new Date();
const expected=calendarExpectation(calendar,now).expected;if(!expected)throw Error('Reviewed current calendar missing');
const end=Date.parse(expected+'T00:00:00+08:00')+86400000,start=end-241*86400000;
fs.mkdirSync('test-results/price-diagnostic',{recursive:true});
const outputs=[];
for(const symbol of ['000001.SZ','600036.SS'])for(const mode of ['default','explicit']){
 const query=new URLSearchParams({period1:String(Math.floor(start/1000)),period2:String(Math.floor(end/1000)),interval:'1d',events:'div,splits'});
 if(mode==='explicit')query.set('includeAdjustedClose','true');
 try{
  const response=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+symbol+'?'+query,{headers:{'User-Agent':'Mozilla/5.0 AllenPersonalResearch/1','Accept':'application/json'},signal:AbortSignal.timeout(15000)});
  const raw=await response.text();fs.writeFileSync('test-results/price-diagnostic/'+symbol+'-'+mode+'.json',raw);
  if(!response.ok)throw Error('HTTP '+response.status);
  const r=JSON.parse(raw).chart?.result?.[0];if(!r)throw Error('empty_chart');
  const q=r.indicators?.quote?.[0],adj=r.indicators?.adjclose?.[0]?.adjclose,ts=r.timestamp||[];
  outputs.push({symbol,mode,expected,bars:ts.length,adjustedLength:adj?.length??null,
   last:ts.slice(-3).map((t,j)=>{const i=ts.length-3+j;return {date:new Date(t*1000+8*3600000).toISOString().slice(0,10),close:q?.close?.[i]??null,adjusted:adj?.[i]??null}})});
 }catch(e){outputs.push({symbol,mode,state:'failed',reason:String(e.message)})}
}
fs.writeFileSync('test-results/price-diagnostic/summary.json',JSON.stringify(outputs,null,2));
console.log('LIVE_PRICE_DIAGNOSTIC '+JSON.stringify(outputs));

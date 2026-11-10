import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertProtocol,buildSessions,parseProvider,featuresAt,buildDataset} from './dataset.mjs';
const p=JSON.parse(fs.readFileSync(new URL('./protocol.json',import.meta.url),'utf8'));
const calendar=JSON.parse(fs.readFileSync(new URL('./calendar.json',import.meta.url),'utf8'));
const sessions=buildSessions(calendar,p);
function series(symbol=p.universe[0].symbol) {
 return {symbol,actions:[],rows:sessions.map((date,i)=>({date,open:10+i*.02,close:10.01+i*.02,
  high:10.1+i*.02,low:9.9+i*.02,volume:1000+i,adjustmentFactor:1}))};
}
test('reviewed holidays, makeup weekends and sealed request window',()=>{
 assert(!sessions.includes('2024-02-09')); assert(!sessions.includes('2025-01-29'));
 assert(!sessions.includes('2024-02-18')); assert(sessions.includes('2024-02-19'));
 assert(sessions.every(x=>x<'2026-01-01')); assert(sessions.length>450);
 assert.throws(()=>assertProtocol({...p,requestThrough:'2026-12-31'}),/sealed/);
});
test('ret60 requires 61 complete sessions and has exact lookback',()=>{
 const s=series();assert.throws(()=>featuresAt(s,sessions[59],sessions),/too_short/);
 const f=featuresAt(s,sessions[60],sessions);
 assert.equal(f.features[2],s.rows[60].close/s.rows[0].close-1); assert.equal(f.features.length,10);
});
test('missing volume, invalid price, absent factor and missing session never become zero features',()=>{
 for(const key of ['volume','close','adjustmentFactor']) {
  const s=series();s.rows[50][key]=null;assert.throws(()=>featuresAt(s,sessions[70],sessions));
 }
 const s=series();s.rows.splice(50,1);assert.throws(()=>featuresAt(s,sessions[70],sessions),/missing/);
});
test('feature data are anchored to decision day; common future factor scaling cancels',()=>{
 const s=series(),a=featuresAt(s,sessions[70],sessions);
 const changed=structuredClone(s);changed.rows.forEach(x=>x.adjustmentFactor*=2);
 const b=featuresAt(changed,sessions[70],sessions);
 a.features.forEach((x,i)=>assert(Math.abs(x-b.features[i])<1e-12));
});
test('future bars and future actions cannot alter earlier features or feature hash',()=>{
 const s=series(),a=featuresAt(s,sessions[70],sessions);
 s.rows[71].close=999;s.rows[71].high=1000;s.actions.push({type:'splits',date:sessions[80]});
 assert.deepEqual(featuresAt(s,sessions[70],sessions),a);
});
test('row order has no effect on prior features or hash',()=>{
 const s=series(),a=featuresAt(s,sessions[70],sessions);s.rows.reverse();
 assert.deepEqual(featuresAt(s,sessions[70],sessions),a);
});
test('split in observation window is excluded and future dividend excludes label',()=>{
 const s=series();s.actions.push({type:'splits',date:sessions[55]});
 assert.throws(()=>featuresAt(s,sessions[70],sessions),/split/);
 const t=series();t.actions.push({type:'dividends',date:sessions[71]});
 const data=buildDataset({protocol:p,calendar,series:[t]});
 assert(data.exclusions.some(x=>x.date===sessions[70]&&x.reason==='label_window_corporate_action'));
});
test('all requests failing is unable to judge; partial failure and benchmark missing remain explicit',()=>{
 assert.throws(()=>buildDataset({protocol:p,calendar,series:[]}),/all_stock_requests_failed/);
 const d=buildDataset({protocol:p,calendar,series:[series()]});
 assert.equal(d.coverage.receivedStocks,1);assert.equal(d.coverage.failedStocks,239);
 assert(d.rows.length>0);assert(d.rows.every(x=>x.benchmarkReturn===null));assert(!d.probabilitiesEnabled);
});
test('entry is next open; fifth close label is not same-day or probability',()=>{
 const s=series(),d=buildDataset({protocol:p,calendar,series:[s]}),r=d.rows.find(x=>x.date===sessions[70]);
 assert.equal(r.rawReturn,s.rows[75].close/s.rows[71].open-1);
 assert.equal(r.labelThrough,sessions[75]);assert.equal(r.actualTradingReturn,null);
});
test('provider missing fields retained null and unexpected 2026 or wrong symbol is rejected',()=>{
 const symbol=p.universe[0].symbol;
 const body={meta:{symbol},timestamp:[Date.parse('2024-01-02T07:00:00Z')/1000],
  indicators:{quote:[{open:[10],high:[11],low:[9],close:[10],volume:[]}],adjclose:[{adjclose:[10]}]}};
 assert.equal(parseProvider(body,symbol,p).rows[0].volume,null);
 assert.throws(()=>parseProvider(body,p.universe[1].symbol,p),/symbol/);
 body.timestamp=[Date.parse('2026-01-05T07:00:00Z')/1000];
 assert.throws(()=>parseProvider(body,symbol,p),/sealed/);
});

test('2020 emergency extension and all six official session counts',()=>{
 assert(!sessions.includes('2020-01-31'));assert(sessions.includes('2020-02-03'));
 assert.equal(sessions.length,1455);
 assert.deepEqual([2020,2021,2022,2023,2024,2025].map(y=>sessions.filter(x=>x.startsWith(String(y))).length),[243,243,242,242,242,243]);
 assert.equal(sessions.filter(x=>x.startsWith('2024'))[60],p.shortWarmupFrom);
});
test('cached long history index is byte-equivalent to direct as-of features',()=>{
 const s=series(),date=sessions[80],prepared={rowIndex:new Map(s.rows.map(x=>[x.date,x])),sessionIndex:new Map(sessions.map((d,i)=>[d,i]))};
 assert.deepEqual(featuresAt(s,date,sessions,prepared),featuresAt(s,date,sessions));
});
test('future low is a path price excursion, never portfolio drawdown',()=>{
 const s=series(),d=buildDataset({protocol:p,calendar,series:[s]}),r=d.rows.find(x=>x.date===sessions[70]);
 assert.equal(r.adversePriceExcursion,Math.min(...s.rows.slice(71,76).map(x=>x.low))/s.rows[71].open-1);
 assert.equal(r.actualTradingReturn,null);
});

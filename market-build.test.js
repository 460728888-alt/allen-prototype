import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMarketCalendar} from './lib/market-calendar.js';
import {buildMarket,normalizeStock,fetchPool,FALLBACK} from './market-build.js';
const calendar=loadMarketCalendar(),now=new Date('2026-10-29T08:30:00Z'),sessions=calendar.sessions.filter(d=>d<='2026-10-29');
function chart(symbol='600036.SS',length=125){const days=sessions.slice(-length),close=days.map((_,i)=>100+i*.04+(i%5)*.05);return {meta:{symbol,currency:'CNY',exchangeName:'SHH'},timestamp:days.map(d=>Date.parse(d+'T09:30:00+08:00')/1000),indicators:{quote:[{open:close.map(v=>v-.1),high:close.map(v=>v+1),low:close.map(v=>v-1),close,volume:close.map(()=>100000)}],adjclose:[{adjclose:[...close]}]}}}
const pool={rows:[{symbol:'600036.SS',name:'合成样本甲'},{symbol:'000001.SZ',name:'合成样本乙'}],source:'synthetic_test_only',fallback:false,sourceFailures:[]};
const response=body=>({ok:true,status:200,json:async()=>body}),fakeFetch=async url=>response({chart:{result:[chart(decodeURIComponent(new URL(url).pathname.split('/').at(-1)))]}});
const run=changes=>buildMarket({calendar,now,clock:()=>now.getTime(),fetchImpl:fakeFetch,pool,...changes});
test('shared canonical prices and unapproved strategy remain distinct from probability',()=>{
 const {stock,detail}=normalizeStock(pool.rows[0],chart(),{calendar,now});
 assert.equal(stock.data.state,'ok');assert.equal(detail.history.length,120);assert.equal(stock.strategy.state,'incompatible');assert.equal(stock.qualified,null);assert.equal(stock.probability,null);assert.equal(stock.strategy.t2Enabled,false);assert.deepEqual(stock.levels,stock.structure.levels);assert.deepEqual(stock.levels,stock.profile.levels);
});
test('120 bars is a display target, 60 remains minimum',()=>{
 assert.equal(normalizeStock(pool.rows[0],chart('600036.SS',75),{calendar,now}).stock.data.state,'ok');
 assert.equal(normalizeStock(pool.rows[0],chart('600036.SS',59),{calendar,now}).stock.data.state,'insufficient');
});
test('missing volume remains unknown and cannot become shrinking volume',()=>{
 const raw=chart();raw.indicators.quote[0].volume[124]=null;const {stock,detail}=normalizeStock(pool.rows[0],raw,{calendar,now});
 assert.equal(stock.data.state,'insufficient');assert.equal(stock.observation,false);assert.equal(stock.profile,null);assert.equal(detail.history.at(-1).volume,null);
});
test('mismatched provider symbol is rejected',()=>assert.throws(()=>normalizeStock(pool.rows[0],chart('000001.SZ'),{calendar,now}),/代码与请求不一致/));
test('all failures explicitly prevent judgment',async()=>{
 const r=await run({fetchImpl:async()=>({ok:false,status:503})});assert.equal(r.status.state,'failed');assert.equal(r.status.coverage.requested,2);assert.equal(r.status.coverage.returned,0);assert.equal(r.status.coverage.failed,2);assert.equal(r.status.coverage.usable,0);assert.match(r.status.message,/无法完成判断/);assert.equal(r.status.failures.length,2);
});
test('partial counts distinguish usable response and request failure',async()=>{
 const r=await run({fetchImpl:async url=>url.includes('000001.SZ')?{ok:false,status:429}:fakeFetch(url)});
 assert.equal(r.status.state,'partial');assert.equal(r.status.coverage.requested,2);assert.equal(r.status.coverage.returned,1);assert.equal(r.status.coverage.usable,1);assert.equal(r.status.coverage.failed,1);assert.equal(r.status.coverage.insufficient,0);
});
test('stale data is not a successful judgment or a network failure',async()=>{
 const r=await run({fetchImpl:async url=>{const raw=chart(decodeURIComponent(new URL(url).pathname.split('/').at(-1)));raw.timestamp.pop();for(const v of Object.values(raw.indicators.quote[0]))v.pop();raw.indicators.adjclose[0].adjclose.pop();return response({chart:{result:[raw]}})}});
 assert.equal(r.status.coverage.returned,2);assert.equal(r.status.coverage.stale,2);assert.equal(r.status.coverage.failed,0);assert.equal(r.status.coverage.usable,0);assert.equal(r.status.state,'failed');
});
test('calendar expiry refuses requests rather than guessing weekdays',async()=>{
 let calls=0;const r=await run({now:new Date('2027-01-05T08:00:00Z'),fetchImpl:async()=>{calls++;throw Error('must not request')}});
 assert.equal(calls,0);assert.equal(r.status.state,'unavailable');assert.equal(r.market,null);
});
test('unrequested symbols are not invented failures',async()=>{
 let tick=0;const r=await run({clock:()=>++tick*1000,maxDurationMs:1});assert.equal(r.status.coverage.requested,0);assert.equal(r.status.coverage.failed,0);assert.equal(r.status.coverage.notRequested,2);
});
test('pool outage falls back to original 32 and discloses limited coverage',async()=>{
 const r=await fetchPool({fetchImpl:async()=>({ok:false,status:503}),clock:()=>now.getTime(),deadline:now.getTime()+30000});
 assert.equal(FALLBACK.length,32);assert.equal(r.rows.length,32);assert.equal(r.fallback,true);assert.ok(r.sourceFailures.length>0);
});

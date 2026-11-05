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
 const r=await run({fetchImpl:async()=>({ok:false,status:503})});assert.equal(r.status.state,'failed');assert.equal(r.status.coverage.requested,2);assert.equal(r.status.coverage.returned,0);assert.equal(r.status.coverage.failed,2);assert.equal(r.status.coverage.usable,0);assert.match(r.status.message,/无法完成判断/);assert.equal(r.status.failures.length,2);assert.ok(r.status.failures.every(f=>f.attempts.length===2));
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

const singlePool={...pool,rows:[pool.rows[0]]};
const envelope=raw=>response({chart:{result:[raw]}});
function badOHLC(){const raw=chart();raw.indicators.quote[0].open[124]=raw.indicators.quote[0].high[124]+2;return raw}
function previousDay(){const raw=chart();raw.timestamp.pop();for(const values of Object.values(raw.indicators.quote[0]))values.pop();raw.indicators.adjclose[0].adjclose.pop();return raw}
test('quality failure retries the secondary host without changing canonical prices',async()=>{
 const calls=[];const good=chart();
 const r=await run({pool:singlePool,fetchImpl:async url=>{calls.push(new URL(url).hostname);return envelope(calls.length===1?badOHLC():good)}});
 assert.deepEqual(calls,['query1.finance.yahoo.com','query2.finance.yahoo.com']);
 assert.equal(r.status.coverage.returned,1);assert.equal(r.status.coverage.usable,1);
 assert.equal(r.status.acquisition.httpRequests,2);assert.equal(r.status.acquisition.secondaryRequests,1);assert.equal(r.status.acquisition.recovered,1);
 const s=r.market.stocks[0];assert.equal(s.source.usedSecondary,true);assert.equal(s.source.independentConfirmation,false);
 assert.match(s.source.attempts[0].reasons.join('；'),/日线价格关系异常/);assert.equal(s.source.attempts[1].state,'ok');
 assert.deepEqual(s.levels,normalizeStock(pool.rows[0],good,{calendar,now}).stock.levels);
 assert.equal(s.qualified,null);assert.equal(s.probability,null);
});
test('two contradictory responses remain insufficient and never become an opportunity',async()=>{
 const r=await run({pool:singlePool,fetchImpl:async()=>envelope(badOHLC())});
 assert.equal(r.status.coverage.returned,1);assert.equal(r.status.coverage.insufficient,1);assert.equal(r.status.coverage.usable,0);assert.equal(r.status.coverage.failed,0);
 const s=r.market.stocks[0];assert.equal(s.source.selectedHost,'query1.finance.yahoo.com');assert.equal(s.source.attempts.length,2);assert.deepEqual(r.status.failures[0].attempts,s.source.attempts);assert.equal(s.observation,false);assert.equal(s.probability,null);
 assert.ok(r.details[s.symbol].history.at(-1).open>r.details[s.symbol].history.at(-1).high,'do not clamp invalid prices');
});
test('older secondary data cannot hide a current invalid response',async()=>{
 let calls=0;const r=await run({pool:singlePool,fetchImpl:async()=>envelope(++calls===1?badOHLC():previousDay())});
 const s=r.market.stocks[0];assert.equal(s.dataThrough,'2026-10-29');assert.equal(s.data.state,'insufficient');assert.equal(s.source.selectedHost,'query1.finance.yahoo.com');assert.equal(s.source.attempts[1].state,'stale');assert.equal(r.status.coverage.stale,0);
});
test('a missing-volume response remains returned when secondary HTTP fails',async()=>{
 const raw=chart();raw.indicators.quote[0].volume[124]=null;let calls=0;
 const r=await run({pool:singlePool,fetchImpl:async()=>++calls===1?envelope(raw):{ok:false,status:503}});
 const s=r.market.stocks[0];assert.equal(r.status.coverage.returned,1);assert.equal(r.status.coverage.failed,0);assert.equal(r.status.coverage.insufficient,1);assert.equal(s.observation,false);assert.equal(s.source.attempts[1].code,'http_503');assert.equal(s.source.attempts[1].requested,true);
 assert.equal(r.details[s.symbol].history.at(-1).volume,null);
});
test('HTTP recovery is disclosed separately from stock coverage',async()=>{
 let calls=0;const r=await run({pool:singlePool,fetchImpl:async()=>++calls===1?{ok:false,status:503}:envelope(chart())});
 assert.equal(r.status.coverage.requested,1);assert.equal(r.status.coverage.returned,1);assert.equal(r.status.coverage.usable,1);assert.equal(r.status.coverage.failed,0);
 assert.equal(r.status.acquisition.httpRequests,2);assert.equal(r.status.acquisition.requestErrors,1);assert.equal(r.market.stocks[0].source.attempts[0].code,'http_503');
});
test('a valid primary response avoids a second request',async()=>{
 let calls=0;const r=await run({pool:singlePool,fetchImpl:async()=>{calls++;return envelope(chart())}});
 assert.equal(calls,1);assert.equal(r.status.acquisition.secondaryRequests,0);assert.equal(r.status.acquisition.recovered,0);assert.equal(r.market.stocks[0].source.attempts.length,1);
});
test('time budget prevents an unmade secondary request without discarding an invalid response',async()=>{
 let clockValue=now.getTime(),calls=0;const r=await run({pool:singlePool,clock:()=>clockValue,maxDurationMs:1000,fetchImpl:async()=>{calls++;clockValue+=2000;return envelope(badOHLC())}});
 assert.equal(calls,1);assert.equal(r.status.coverage.returned,1);assert.equal(r.status.coverage.failed,0);assert.equal(r.status.acquisition.httpRequests,1);assert.equal(r.status.acquisition.secondaryRequests,0);assert.equal(r.status.acquisition.skippedRetries,1);
 assert.equal(r.market.stocks[0].source.retrySkipped,'time_budget');assert.equal(r.market.stocks[0].source.attempts.length,1);
});

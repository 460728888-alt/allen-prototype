import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewQueue} from './research-review.js';
const a={canJudge:true,state:'ok',expectedThrough:'2026-11-04'};
const original=(symbol,stop=10,breakout=12)=>({symbol,dataThrough:'2026-11-02',levels:{stop,invalidation:stop,breakout}});
const record=(id,symbol='600036.SS',patch={})=>({id,symbol,name:symbol,status:'observing',createdAt:'2026-11-02T08:00:00Z',dataThrough:'2026-11-02',original:original(symbol),events:[],...patch});
const stock=(symbol='600036.SS',price=11,patch={})=>({symbol,price,dataThrough:'2026-11-04',...patch,data:{state:'ok',complete:true,historyStart:'2026-11-01',corporateActions:[],...patch.data}});
const one=(r,s,assessment=a)=>buildReviewQueue([r],s?[s]:[],assessment).items[0];
test('review prioritizes invalidation, paused data, price-only condition, then waiting',()=>{
 const records=[record('wait','600519.SS'),record('price','600036.SS'),record('pause','600000.SS'),record('invalid','000001.SZ'),record('closed','600028.SS',{status:'closed'})],stocks=[stock('600519.SS',11),stock('600036.SS',12),stock('000001.SZ',10)];
 const q=buildReviewQueue(records,stocks,a);
 assert.deepEqual(q.items.map(x=>x.id),['invalid','pause','price','wait']);assert.deepEqual(q.counts,{invalidated:1,paused:1,price_condition:1,waiting:1});assert.equal(q.total,4);
 assert.deepEqual(buildReviewQueue([...records].reverse(),[...stocks].reverse(),a),q);
});
test('missing, failed, stale or incomplete data cannot create an invalidation or distance',()=>{
 const r=record('r');
 for(const s of [null,stock(undefined,9,{data:{state:'insufficient',reasons:['成交量缺失']}}),stock(undefined,9,{data:{state:'failed'}}),stock(undefined,9,{dataThrough:'2026-11-03'}),stock(undefined,9,{data:{complete:false}})]){
  const v=one(r,s);assert.equal(v.group,'paused');assert.equal(v.distancePct,null);assert.equal(v.currentPrice,null);
 }
 const v=one(r,stock(undefined,9),{...a,canJudge:false,state:'failed',message:'无法完成判断'});assert.equal(v.group,'paused');assert.equal(v.distancePct,null);
});
test('corporate actions and missing historical coverage pause original-scale comparison',()=>{
 for(const data of [{corporateActions:[{type:'splits',date:'2026-11-03'}]},{corporateActions:[{type:'dividends',date:'2026-11-03'}]},{corporateActions:null},{historyStart:'2026-11-03'}]){
  const v=one(record('r'),stock(undefined,9,{data}));assert.equal(v.group,'paused');assert.equal(v.distancePct,null);
 }
});
test('current window breakdown cannot replace the saved original invalidation price',()=>{
 const v=one(record('r'),stock(undefined,11,{structure:{stage:'结构失效',levels:{stop:12}}}));assert.equal(v.group,'waiting');assert.ok(Math.abs(v.distancePct-10)<1e-9);
 const atStop=one(record('r'),stock(undefined,10,{structure:{volume:null}}));assert.equal(atStop.group,'invalidated');assert.equal(atStop.distancePct,0);
});
test('saved invalidation remains a historical fact when current data is unavailable',()=>{
 const v=one(record('r',undefined,{status:'invalidated'}),null);assert.equal(v.group,'invalidated');assert.equal(v.currentPrice,null);assert.equal(v.distancePct,null);
});
test('same symbol opportunities keep separate original levels and stable identifiers',()=>{
 const symbol='600036.SS',records=[record('a',symbol),record('b',symbol,{original:original(symbol,14,16)})],q=buildReviewQueue(records,[stock(symbol,13)],a);
 assert.equal(q.total,2);assert.equal(q.items.find(v=>v.id==='a').group,'price_condition');assert.equal(q.items.find(v=>v.id==='b').group,'invalidated');
 assert.equal(q.items.find(v=>v.id==='a').originalStop,10);assert.equal(q.items.find(v=>v.id==='b').originalStop,14);
});
test('review is read-only and does not emit predictions, scores or personal sizing',()=>{
 const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v},records=freeze([record('r')]),stocks=freeze([stock()]),assessment=freeze({...a}),before=JSON.stringify({records,stocks,assessment}),q=buildReviewQueue(records,stocks,assessment);
 assert.equal(JSON.stringify({records,stocks,assessment}),before);for(const k of ['probability','score','positionSize','riskBudget'])assert.equal(Object.hasOwn(q.items[0],k),false);
});
test('missing references and duplicated market snapshots fail closed',()=>{
 const r=record('r');r.original.levels.stop=null;r.original.levels.invalidation=null;assert.equal(one(r,stock()).group,'paused');assert.equal(one(r,stock()).distancePct,null);
 const v=buildReviewQueue([record('r')],[stock(),stock(undefined,9)],a).items[0];assert.equal(v.group,'paused');assert.equal(v.distancePct,null);
 assert.deepEqual(buildReviewQueue(null,null,a),{items:[],counts:{invalidated:0,paused:0,price_condition:0,waiting:0},total:0});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderLongReview,validateLongReview} from './long-training-review.js';
const a=JSON.parse(fs.readFileSync(new URL('./long-training-review.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(a);
test('all nine core fits and three expanded results stay separate with risk and error evidence',()=>{
 assert.equal(validateLongReview(a),true);const h=renderLongReview(a);
 assert.equal((h.match(/data-long-core=/g)||[]).length,9);assert.equal((h.match(/data-long-expanded=/g)||[]).length,3);
 assert.match(h,/-21.59%/);assert.match(h,/9／9/);assert.match(h,/概率误差点值更大/);assert.match(h,/第三季度均无信号/);
 assert.match(h,/暂不启用预测/);assert.match(h,/描述性配置比较/);assert.match(h,/核心32/);
});
test('missing evidence and unsafe links never become zero returns or no opportunities',()=>{
 for(const v of [null,{...a,summary:null},{...a,approved:true},{...a,sourceRunUrl:'javascript:bad()'},{...a,replayRunUrl:'javascript:bad()'},{...a,replay:null}]){
  const h=renderLongReview(v);assert.match(h,/data-state="unavailable"/);assert.match(h,/不能显示成零收益或没有机会/);
  assert.equal((h.match(/data-long-core=/g)||[]).length,0);
 }
});
test('cohort counts, duplicated replays and omitted quarters close performance display',()=>{
 const cases=[];
 let b=copy();b.summary.regimes.long_core.models.logistic.scopes.core_common.stockDays--;cases.push(b);
 b=copy();b.replay.replays[0]=b.replay.replays[1];cases.push(b);
 b=copy();b.replay.quarters.long_core.logistic.core_common.quarters.pop();cases.push(b);
 b=copy();b.summary.regimes.long_expanded.models.catboost.scopes.expanded_readable.brier=2;cases.push(b);
 for(const v of cases)assert.equal(validateLongReview(v),false);
});
test('zero signals retain unknown outcomes and sparse intervals cannot masquerade as confidence',()=>{
 const s=a.summary.regimes.short_core.models.logistic.scopes.core_common;
 assert.equal(s.signalStockDays,0);assert.equal(s.assumed30bps,null);
 let b=copy();b.summary.regimes.short_core.models.logistic.scopes.core_common.assumed30bps=0;
 assert.equal(validateLongReview(b),false);
 b=copy();b.summary.regimes.long_core.models.catboost.scopes.core_common.uncertainty30bps.assumedPriceReturn.low=0;
 assert.equal(validateLongReview(b),false);
});
test('record keeps reproducibility evidence, temporary expiry and no live target approvals',()=>{
 assert.equal(a.replay.replays.length,9);assert.equal(a.replay.manifestFilesVerified,279);
 assert(a.replay.replays.every(x=>x.maxRawDifference===0&&x.maxCalibratedDifference===0));
 assert.equal(a.artifact.temporary,true);assert.match(a.artifact.expiresAt,/2027-02-08/);
 const h=renderLongReview({...a,sourceCommit:'<img src=x onerror=bad()>'});
 assert.ok(!h.includes('<img'));assert.match(h,/&lt;img/);
 assert.match(h,/组合最大回撤、先止盈后止损：未研究/);
});

test('malformed collection shapes close the report instead of crashing the page',()=>{
 const cases=[];
 let b=copy();b.replay.replays='123456789';cases.push(b);
 b=copy();b.summary.pairedCoreBrierDifferences='123456789';cases.push(b);
 b=copy();b.replay.quarters.long_core.logistic.core_common.quarters='1234';cases.push(b);
 b=copy();b.summary.pairedCoreBrierDifferences[0]=null;cases.push(b);
 b=copy();b.replay.replays[0]=null;cases.push(b);
 for(const v of cases){assert.doesNotThrow(()=>renderLongReview(v));assert.equal(validateLongReview(v),false);}
});
test('duplicate or changed planned Brier pairs cannot fabricate a nine-comparison result',()=>{
 let b=copy();b.summary.pairedCoreBrierDifferences[0]=b.summary.pairedCoreBrierDifferences[1];
 assert.equal(validateLongReview(b),false);
 b=copy();b.summary.pairedCoreBrierDifferences[0].a='newly_picked/best';
 assert.equal(validateLongReview(b),false);
});

test('replay cohort and temporary artifact metadata must match the frozen evidence',()=>{
 let b=copy();b.replay.coreCohortHash='0'.repeat(64);assert.equal(validateLongReview(b),false);
 b=copy();b.artifact.expiresAt=null;assert.equal(validateLongReview(b),false);
 b=copy();b.artifact.digest='unknown';assert.equal(validateLongReview(b),false);
 b=copy();b.summary.regimes.extra=null;b.summary.regimes.long_core.models.extra=null;
 assert.doesNotThrow(()=>renderLongReview(b));assert.equal((renderLongReview(b).match(/data-long-core=/g)||[]).length,9);
});

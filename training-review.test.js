import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderTrainingReview} from './training-review.js';
const audit=JSON.parse(fs.readFileSync(new URL('./training-review.json',import.meta.url),'utf8'));
test('training card exposes all three candidates, zero signals and unapproved development status',()=>{
 const html=renderTrainingReview(audit);assert.equal((html.match(/data-training-model=/g)||[]).length,3);
 assert.match(html,/首轮训练完成，暂不启用/);assert.match(html,/开发验证/);assert.match(html,/不能解读为今天没有机会/);
 assert.match(html,/没有降低阈值/);assert.match(html,/0.2487/);assert.match(html,/2027-02-08/);
 assert.equal(audit.winner,null);assert.equal(audit.actualTradingReturn,null);assert.equal(audit.portfolioMaxDrawdown,null);
});
test('missing, approved, unsupported target and missing metrics never become zero opportunities',()=>{
 for(const a of [null,{...audit,approved:true},{...audit,target:'target_before_stop'},
  {...audit,models:{...audit.models,logistic:{...audit.models.logistic,auc:null}}}]){
  const h=renderTrainingReview(a);assert.match(h,/data-state="unavailable"/);
  assert.match(h,/不能显示为没有机会或零收益/);assert.equal((h.match(/data-training-model=/g)||[]).length,0);
 }
});
test('unsafe report links are refused and source metadata is escaped',()=>{
 assert.match(renderTrainingReview({...audit,sourceRunUrl:'javascript:bad()'}),/data-state="unavailable"/);
 const h=renderTrainingReview({...audit,sourceCommit:'<img src=x onerror=bad()>'});
 assert.ok(!h.includes('<img'));assert.match(h,/&lt;img/);
});
test('experiment record is a fresh-data development run with explicit temporary archive and gross target',()=>{
 assert.equal(audit.target,'next_open_to_fifth_close_gross_up');assert.equal(audit.selectionThreshold,.6);
 assert.equal(audit.counts.development,6944);assert.equal(audit.coverage.receivedStocks,32);
 assert.equal(audit.probabilitiesEnabled,false);assert.equal(audit.finalTestOpened,false);
 assert.equal(audit.artifact.temporary,true);assert.ok(audit.errata[0].includes('元数据'));
});

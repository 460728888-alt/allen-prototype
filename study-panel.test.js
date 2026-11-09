import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderStudyPanel,renderBenchmarkCard} from './study-panel.js';
const report=JSON.parse(fs.readFileSync(new URL('./data/history-study.json',import.meta.url),'utf8')),audit=JSON.parse(fs.readFileSync(new URL('./study-audit.json',import.meta.url),'utf8'));
test('panel distinguishes price studies from live returns and keeps all groups in fixed order',()=>{
 const html=renderStudyPanel(report,{audit});assert.match(html,/事后重建/);assert.match(html,/未扣费/);assert.match(html,/假设/);assert.match(html,/组合最大回撤：未研究/);assert.match(html,/先止盈后止损结果：未研究/);assert.ok(!html.includes('当前上涨概率为'));assert.equal((html.match(/data-study-row=/g)||[]).length,5);
});
test('cost rendering reads exact source value and missing cost does not render zero',()=>{
 const g=report.groups.find(g=>g.id==='legacy_observation'),html=renderStudyPanel(report,{costBps:60,audit});assert.ok(html.includes('data-value="'+g.hypotheticalCostScenarios.find(s=>s.roundTripBps===60).dailyEqualWeightMeanAssumedReturn+'"'));
 const changed=JSON.parse(JSON.stringify(report));changed.groups.find(g=>g.id==='legacy_observation').hypotheticalCostScenarios=[];const missing=renderStudyPanel(changed,{audit});assert.match(missing,/class="study-assumed" data-value="unknown">未提供/);
});
test('source metadata is escaped and missing raw samples are disclosed separately',()=>{
 const changed=JSON.parse(JSON.stringify(report));changed.version='<img src=x onerror=bad()>';const html=renderStudyPanel(changed,{audit});assert.ok(!html.includes('<img '));assert.match(html,/&lt;img/);assert.match(html,/原逐日样本/);assert.match(html,/尚未确认/);assert.match(html,/不能宣称已完整复现/);
});
test('benchmark text makes no accuracy or direct outperformance claim',()=>{
 const html=renderBenchmarkCard();assert.match(html,/Zacks Rank/);assert.match(html,/假设组合/);assert.match(html,/财报同比不能冒充预期上调/);assert.match(html,/尚未证明/);assert.match(html,/rank-disclosure/);
});

import {buildStudyView} from './study-compare.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const scaled=v=>Math.abs(v*100)>0&&Math.abs(v*100)<.0005?(v*100).toExponential(2):(v*100).toFixed(3);
const pct=v=>finite(v)?scaled(v)+'%':'未提供';
const pp=v=>finite(v)?scaled(v)+' 个百分点':'未提供';
const n=v=>Number.isInteger(v)&&v>=0?String(v):'未提供';
const names={all_readable:'固定样本全部可读',simple_trend:'简单均线趋势',legacy_observation:'原量价观察',legacy_with_prior_trend:'原观察＋前置趋势',price_trigger_only:'原放量突破（含量能）'};
export function renderBenchmarkCard(){
 return '<section class="card benchmark-card"><div class="eyebrow">REFERENCE / ZACKS RANK</div><h2>学习成熟方法，用自己的证据检验</h2><p>对标 Zacks Rank 的排名组合与成绩披露方式。其公开成绩为假设组合，市场、周期和成本与本项目不同，不能直接比较谁更准。</p><ul><li>学习：保存当时判断，公开成本、基准与失败时期。</li><li>暂缺：当时的分析师盈利预期和修正数据。财报同比不能冒充预期上调。</li><li>当前结论：尚未证明本项目的一周预测超过它，不把排名当上涨概率。</li></ul><a href="https://go.zackspro.com/rank-disclosure" target="_blank" rel="noopener noreferrer">核对 Zacks 官方披露 ↗</a><small>只借鉴公开研究原则，不复制其闭源权重或会员数据；不使用口径未核实的对方收益数字。</small></section>';
}
function quarterChart(quarters){
 const values=quarters.flatMap(q=>[q.grossReturn,q.sampleExcess]).filter(finite),scale=values.length?Math.max(...values.map(Math.abs),.00001):null;
 return '<div class="study-quarter-grid">'+quarters.map(q=>{
  const rows=[['价格变化',q.grossReturn,'price'],['同日样本差',q.sampleExcess,'excess']];
  return '<article class="study-quarter"><h4>2025 · Q'+q.quarter+'</h4><p>'+n(q.dates)+' 个有效信号日</p>'+rows.map(([label,value,kind])=>{
   if(!finite(value)||scale===null)return '<p class="muted">'+label+'：未提供，不能画成0。</p>';
   const width=Math.abs(value)/scale*82,x=value>=0?100:100-width;
   return '<div class="quarter-value"><span>'+label+'</span><b>'+esc(kind==='price'?pct(value):pp(value))+'</b></div><svg class="study-bar '+kind+'" viewBox="0 0 200 18" role="img" aria-label="'+esc(label+' '+(kind==='price'?pct(value):pp(value)))+'"><title>'+esc(label+'，未扣费；'+n(q.dates)+'个有效信号日')+'</title><line x1="100" x2="100" y1="0" y2="18"/><rect x="'+x.toFixed(2)+'" y="4" width="'+(width>0?Math.max(.6,width):0).toFixed(2)+'" height="10"/></svg>';
  }).join('')+'</article>';
 }).join('')+'</div>';
}
function auditPanel(report,audit){
 const verified=audit?.schema===1;
 return '<section class="card study-audit"><h3>核查材料与复现状态</h3><p class="warning">'+(verified?esc(audit.study?.note||'原逐日样本备份尚未确认。'):'材料核查状态暂不可读取，不能宣称完整复现。')+'</p><p class="muted">材料检查 '+esc(verified?audit.reviewedAt:'未核验')+'；当前界面只读取冻结摘要，没有重新训练或回测。2026最终时间外测试未评估。</p><div class="row"><button data-download-study>下载冻结摘要 JSON（不含原逐日样本）</button><a href="https://github.com/460728888-alt/allen-prototype/blob/4cb1a28e6ac1959235a6553d577a1405e240cff9/data/history-study.json" target="_blank" rel="noopener noreferrer">本页摘要来源 ↗</a><a href="https://github.com/460728888-alt/AllenPt1/blob/16f24479b6198cb7397646ed99980f6087f3f904/research/five-session-protocol.json" target="_blank" rel="noopener noreferrer">原冻结协议 ↗</a><a href="https://github.com/460728888-alt/AllenPt1/blob/16f24479b6198cb7397646ed99980f6087f3f904/research/results/FIVE-SESSION-2025.md" target="_blank" rel="noopener noreferrer">冻结研究报告 ↗</a></div><details><summary>版本、覆盖和已知限制</summary><p class="muted">摘要版本 '+esc(report.version)+' · 重建 '+esc(report.reconstructedAt)+'<br>记录的计算版本 '+esc(report.sourceCommit)+'<br>数据摘要 '+esc(report.datasetSha256)+'</p><ul>'+(Array.isArray(report.limitations)?report.limitations:[]).map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul></details></section>';
}
export function renderStudyPanel(report,{costBps=30,groupId='legacy_observation',audit=null}={}){
 const view=buildStudyView(report,{costBps,groupId}),selected=view.selected;
 if(view.state==='invalid'||!selected)return '<section class="empty" id="studyComparison"><h2>研究摘要暂不可比较</h2><p>'+esc(view.reason||'未取得可靠摘要，不显示虚构表现。')+'</p></section>';
 const c=view.coverage||{},interval=selected.interval,intervalText=finite(interval.low)&&finite(interval.high)?pp(interval.low)+' 至 '+pp(interval.high):'未提供';
 const prior=view.groups.find(g=>g.id==='legacy_with_prior_trend'),counter=prior&&finite(prior.positiveFraction)&&prior.positiveFraction>.5&&finite(prior.assumedReturn)&&prior.assumedReturn<0;
 let html='<section class="card" id="studyComparison"><div class="eyebrow">EXISTING FIVE-SESSION STUDY / FAIR COMPARISON</div><h2>五日研究：把成本与同日对照一起看</h2><p class="notice">基于已有2025事后重建，固定32只当前名单，含幸存者偏差，历史报价尺度未独立核验；不是当时预测、当前概率或可执行回测。观察、趋势和突破组保持原定义，没有选出正式赢家。</p><p class="muted">标签定义：'+esc(report.definitions?.target||'定义未取得，暂停外推。')+'。固定五日价格研究不执行结构止损；三类目标（上涨、跑赢基准、先止盈后止损）的概率均未提供。</p><div class="fields"><label for="studyGroup">查看研究组<select id="studyGroup">'+view.groups.map(g=>'<option value="'+g.id+'" '+(g.id===selected.id?'selected':'')+'>'+names[g.id]+'</option>').join('')+'</select></label><label for="studyCost">研究假设：往返比例成本<select id="studyCost">'+[[0,'0（未计成本）'],[30,'30bps／0.30%'],[60,'60bps／0.60%']].map(([v,label])=>'<option value="'+v+'" '+(v===costBps?'selected':'')+'>'+label+'</option>').join('')+'</select></label></div><p class="muted">成本是原研究假设，不是你的实际费率，也未证明能成交。不含最低佣金、真实滑点、停牌或涨跌停影响；不设置个人风险预算。</p>';
 html+='<div class="study-facts"><article><small>所选成本情景均值（非实盘）</small><b class="study-assumed" data-value="'+esc(finite(selected.assumedReturn)?selected.assumedReturn:'unknown')+'">'+pct(selected.assumedReturn)+'</b></article><article><small>同日固定样本差 · 未扣费</small><b class="study-sample" data-value="'+esc(finite(selected.sampleExcess)?selected.sampleExcess:'unknown')+'">'+pp(selected.sampleExcess)+'</b></article><article><small>同日样本差的探索区间 · 未扣费</small><b class="study-interval">'+esc(intervalText)+'</b><span>'+esc(interval.crossesZero===true?'区间跨零，尚不能确认优势。':interval.crossesZero===false?'此区间未跨零，仍需独立验证。':'区间未核验，不生成结论。')+'</span></article></div>';
 html+='<p class="muted">'+names[selected.id]+'：'+n(selected.labelledStockDays)+' 个有效股票日、'+n(selected.distinctDates)+' 个不同信号日、'+n(selected.distinctSymbols)+' 只股票。股票日重叠相关，不等于独立交易次数。</p>';
 if(counter)html+='<p class="warning study-counterexample">不要只看正比例：原观察＋前置趋势的未扣费股票日正变化比例为 '+pct(prior.positiveFraction)+'，按日期等权的当前成本情景均值为 '+pct(prior.assumedReturn)+'。统计权重、涨跌幅度和成本都重要；高正比例不等于可赚钱，更不等于当前上涨概率。</p>';
 html+='<div class="table-wrap" role="region" tabindex="0" aria-label="固定研究组比较，可横向滚动"><table class="table study-table"><thead><tr><th>固定研究组</th><th>股票日／信号日</th><th>未扣费正变化比例</th><th>毛价格变化均值</th><th>所选成本情景均值</th><th>同日样本差 · 毛</th><th>上证价格差 · 毛</th></tr></thead><tbody>'+view.groups.map(g=>'<tr data-study-row="'+g.id+'"><td>'+names[g.id]+'</td><td>'+n(g.labelledStockDays)+'／'+n(g.distinctDates)+'</td><td>'+pct(g.positiveFraction)+'</td><td>'+pct(g.grossReturn)+'</td><td>'+pct(g.assumedReturn)+'</td><td>'+pp(g.sampleExcess)+'</td><td>'+pp(g.indexExcess)+'</td></tr>').join('')+'</tbody></table></div><p class="muted">正比例按股票日数计算，不是计成本后的胜率；均值先按日期内股票等权，再对日期等权。同日样本差使用原摘要的匹配日期结果，不能拿不同日期组的均值直接相减。成本切换只改变已有情景列；毛超额、区间和季度仍未扣费。</p><h3>分季度看稳定性 · 未扣费价格变化</h3>'+quarterChart(selected.quarters)+'<p class="muted">柱形以0为中心，不是资金净值曲线。每季度仅展示已有聚合结果；没有季度区间时不编造。</p>';
 html+='<div class="study-gaps"><p><b>实际交易收益：未研究</b></p><p><b>组合最大回撤：未研究</b></p><p><b>先止盈后止损结果：未研究</b></p></div><p class="muted">覆盖 '+n(c.validPriceLabels)+'／'+n(c.eligibleStockDays)+' 个可标记股票日；标签覆盖率 '+pct(c.priceLabelCoverage)+'；边界剔除 '+n(c.purgedBoundary)+'；指数标签缺失 '+n(c.missingBenchmarkLabels)+'。缺失保持未知，不补0。</p><details><summary>标签缺失与排除原因</summary>'+Object.entries(c.exclusionReasons||{}).map(([reason,count])=>'<p>'+esc(reason)+' · '+n(count)+'</p>').join('')+'</details><p class="warning">目前未证明可靠优势，不按最高正比例选模型。T1＋1.5仍为配置不兼容、合格候选未判定、T2未启用；没有更改正式策略或显示预测概率。</p></section>';
 return html+auditPanel(report,audit);
}

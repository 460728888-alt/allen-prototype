const finite=x=>typeof x==='number'&&Number.isFinite(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=x=>finite(x)?(x*100).toFixed(2)+'%':'未评估';
const pp=x=>finite(x)?(x*100).toFixed(2)+' 个百分点':'未评估';
const score=x=>finite(x)?x.toFixed(4):'未评估';
const configs={short_core:'原历史配置 · 核心32',long_core:'长历史配置 · 核心32',long_expanded:'长历史配置 · 扩展训练'};
const models={logistic:'逻辑回归',lightgbm:'LightGBM',catboost:'CatBoost'};
const interval=(c,dates)=>dates<20?'不足20个信号日，区间未知':finite(c?.low)&&finite(c?.high)?pct(c.low)+' 至 '+pct(c.high):'区间未核验';
function validScope(s,n){
 if(!s||s.stockDays!==n||!finite(s.brier)||s.brier<0||s.brier>1||!finite(s.rocAuc)||s.rocAuc<0||s.rocAuc>1||!count(s.signalStockDays)||s.signalStockDays>n||!count(s.signalDates)||s.signalDates>s.signalStockDays)return false;
 const low=s.singleStockLowExcursion;
 if(!low||low.stockDays!==s.signalStockDays||low.portfolioMaxDrawdown!==null||low.actualTradingReturn!==null)return false;
 if(!s.signalStockDays)return s.signalDates===0&&s.assumed30bps===null&&s.sameDateSampleExcess30bps===null&&low.worstObserved===null;
 if(!s.signalDates||!finite(s.assumed30bps)||!finite(s.sameDateSampleExcess30bps)||!finite(low.worstObserved)||low.worstObserved<=-1||low.worstObserved>0)return false;
 return ['assumedPriceReturn','sameDateSampleExcess'].every(key=>{
  const c=s.uncertainty30bps?.[key];
  return c?.signalDates===s.signalDates&&(s.signalDates<20?c.low===null&&c.high===null&&c.replicates===0:finite(c.low)&&finite(c.high)&&c.low<=c.high&&c.replicates===400);
 });
}
function validQuarters(a,r,m,scope){
 const q=a.replay?.quarters?.[r]?.[m]?.[scope]?.quarters,s=a.summary?.regimes?.[r]?.models?.[m]?.scopes?.[scope];
 if(!s||q?.length!==4||!q.every((v,i)=>v.quarter===i+1&&count(v.signals)&&count(v.dates)&&v.dates<=v.signals&&(v.signals?finite(v.assumed30bps)&&finite(v.sampleExcess30bps):v.assumed30bps===null&&v.sampleExcess30bps===null)))return false;
 if(q.reduce((n,v)=>n+v.signals,0)!==s.signalStockDays||q.reduce((n,v)=>n+v.dates,0)!==s.signalDates)return false;
 if(!s.signalDates)return true;
 return Math.abs(q.reduce((n,v)=>n+(v.assumed30bps??0)*v.dates,0)/s.signalDates-s.assumed30bps)<1e-10
  &&Math.abs(q.reduce((n,v)=>n+(v.sampleExcess30bps??0)*v.dates,0)/s.signalDates-s.sameDateSampleExcess30bps)<1e-10;
}
export function validateLongReview(a){
 const s=a?.summary,c=s?.coverage;
 return a?.schema===1&&a.approved===false&&a.probabilitiesEnabled===false&&a.winner===null&&a.finalTestOpened===false
  &&a.protocolId==='allen-long-history-development-20261110-v2'
  &&s?.status==='exploratory_development_only'&&s.successfulCandidates===9
  &&c?.requestedStocks===240&&count(c.receivedStocks)&&count(c.failedStocks)&&c.receivedStocks+c.failedStocks===240
  &&count(c.readableLabels)&&c.readableLabels>0&&count(c.eligibleStockDays)&&c.readableLabels<=c.eligibleStockDays
  &&count(s.coreDevelopmentStockDays)&&s.coreDevelopmentStockDays>0&&count(s.expandedDevelopmentStockDays)&&s.expandedDevelopmentStockDays>=s.coreDevelopmentStockDays
  &&/^[0-9a-f]{64}$/.test(s.coreCohortHash||'')
  &&/^https:\/\/github\.com\/460728888-alt\/allen-prototype\/actions\/runs\/\d+$/.test(a.sourceRunUrl||'')
  &&a.replay?.status==='saved_predictions_reproduced'&&a.replay.sourceRun===42733142406
  &&count(a.replay.manifestFilesVerified)&&a.replay.manifestFilesVerified>0
  &&a.replay.replays?.length===9&&a.replay.replays.every(x=>finite(x.maxRawDifference)&&finite(x.maxCalibratedDifference)&&x.maxRawDifference>=0&&x.maxCalibratedDifference>=0&&x.maxRawDifference<=1e-10&&x.maxCalibratedDifference<=1e-10)
  &&new Set(a.replay.replays.map(x=>x.regime+'/'+x.model)).size===9
  &&a.replay.replays.every(x=>Object.hasOwn(configs,x.regime)&&Object.hasOwn(models,x.model)&&x.rows===(x.regime==='long_expanded'?s.expandedDevelopmentStockDays:s.coreDevelopmentStockDays))
  &&Object.keys(configs).every(r=>Object.keys(models).every(m=>s.regimes?.[r]?.models?.[m]?.status==='research_only'
    &&validScope(s.regimes[r].models[m].scopes?.core_common,s.coreDevelopmentStockDays)&&validQuarters(a,r,m,'core_common')))
  &&Object.keys(models).every(m=>validScope(s.regimes.long_expanded.models[m].scopes?.expanded_readable,s.expandedDevelopmentStockDays)&&validQuarters(a,'long_expanded',m,'expanded_readable'))
  &&s.pairedCoreBrierDifferences?.length===9&&s.pairedCoreBrierDifferences.every(d=>finite(d.difference)&&finite(d.uncertainty?.low)&&finite(d.uncertainty?.high)&&d.uncertainty.low<=d.uncertainty.high);
}
function row(s,label,attrs){
 return '<tr '+attrs+'><td>'+esc(label)+'</td><td>'+score(s.rocAuc)+'</td><td>'+score(s.brier)+'</td><td>'+s.signalStockDays+'／'+s.signalDates+'</td><td>'+pct(s.assumed30bps)+'<small>区间：'+esc(interval(s.uncertainty30bps?.assumedPriceReturn,s.signalDates))+'</small></td><td>'+pp(s.sameDateSampleExcess30bps)+'</td><td>'+pct(s.singleStockLowExcursion?.worstObserved)+'</td></tr>';
}
const head='<thead><tr><th>配置／模型</th><th>AUC区分能力</th><th>Brier概率误差</th><th>信号股票日／日期</th><th>30bps费用假设均值</th><th>同日样本差</th><th>最深价格下探</th></tr></thead>';
function quarterDetails(a){
 let html='<details id="longQuarters"><summary>查看所有配置的季度分布</summary><p>每项都是条件价格研究。空季度保持未知，不能填成0；金额资金与组合回撤未模拟。</p>';
 for(const r of Object.keys(configs)){
  html+='<h3>'+configs[r]+'</h3><div class="table-wrap"><table class="table"><thead><tr><th>模型／季度</th><th>信号股票日／日期</th><th>30bps费用假设均值</th><th>同日样本差</th></tr></thead><tbody>';
  for(const [m,name]of Object.entries(models))for(const q of a.replay.quarters?.[r]?.[m]?.core_common?.quarters||[]){
   html+='<tr><td>'+name+' · Q'+esc(q.quarter)+'</td><td>'+esc(q.signals)+'／'+esc(q.dates)+'</td><td>'+pct(q.assumed30bps)+'</td><td>'+pp(q.sampleExcess30bps)+'</td></tr>';
  }
  html+='</tbody></table></div>';
 }
 html+='<h3>扩展评估范围 · 与核心范围分开</h3><div class="table-wrap"><table class="table"><thead><tr><th>模型／季度</th><th>信号股票日／日期</th><th>30bps费用假设均值</th><th>同日样本差</th></tr></thead><tbody>';
 for(const [model,name]of Object.entries(models))for(const q of a.replay.quarters.long_expanded[model].expanded_readable.quarters)
  html+='<tr><td>'+name+' · Q'+q.quarter+'</td><td>'+q.signals+'／'+q.dates+'</td><td>'+pct(q.assumed30bps)+'</td><td>'+pp(q.sampleExcess30bps)+'</td></tr>';
 return html+'</tbody></table></div></details>';
}
export function renderLongReview(a){
 if(!validateLongReview(a))return '<section class="card" id="longTrainingReview" data-state="unavailable"><h2>长历史比较材料暂不可读取</h2><p>没有核验完整材料，暂停展示成绩；不能显示成零收益或没有机会。</p></section>';
 const s=a.summary,c=s.coverage,crossed=s.pairedCoreBrierDifferences.filter(d=>d.uncertainty.low<=0&&d.uncertainty.high>=0).length;
 const lows=Object.values(s.regimes).flatMap(r=>Object.values(r.models).flatMap(m=>Object.values(m.scopes).map(x=>x.singleStockLowExcursion.worstObserved))).filter(finite);
 let h='<section class="card" id="longTrainingReview" data-state="research-only"><div class="eyebrow">ROUND 2 / CONTROLLED COMPARISON</div><h2>扩大样本以后，优势有没有更可靠？</h2><p class="notice">九组训练与已保存预测复算完成。固定240只股票，取得 '+c.receivedStocks+'，失败 '+c.failedStocks+'；2020—2025共 '+c.readableLabels+' 条可读价格标签。2025仍是开发期，2026研究测试区未评估。</p><div class="study-facts"><article><small>三组共同核心评估</small><b>'+s.coreDevelopmentStockDays+' 个股票日</b><span>同一数据、同一32只核心名单，不把行数当独立交易数。</span></article><article><small>概率误差比较的区间跨0</small><b>'+crossed+'／9</b><span>尚不能确认稳定改善，不按最高分挑冠军。</span></article><article><small>信号后五日最深价格下探</small><b>'+pct(Math.min(...lows))+'</b><span>单标的价格路径，非实际亏损或组合最大回撤。</span></article></div><p class="warning">长历史配置出现值得复核的信号，但扩展训练在共同核心样本上的概率误差点值更大。更高的条件均值或AUC，不能单独作为升级成功的证据；扩展范围三个模型在第三季度均无信号，不能假设全年持续可用。暂不启用预测。</p><p>研究目标仍是：次日开盘至第五交易日收盘的原始价格是否上涨。固定0.6仅为实验门槛，不是已验证的六成胜率或正式买点。</p><h3>共同核心样本：全部九组固定展示</h3><p class="muted">原配置：2024年4月3日至8月30日训练、9月9日至年底校准。长配置：2020—2023训练、2024全年校准。训练截止与校准范围同时改变，只能作描述性配置比较，不能把差异全归因于增加年数。</p><div class="table-wrap" role="region" tabindex="0" aria-label="九组共同核心比较"><table class="table long-core-table">'+head+'<tbody>';
 for(const [r,label]of Object.entries(configs))for(const [m,name]of Object.entries(models))h+=row(s.regimes[r].models[m].scopes.core_common,label+'／'+name,'data-long-core="'+r+'/'+m+'"');
 h+='</tbody></table></div><p class="muted">AUC在0.5附近辨别力有限，Brier越小越好。费用假设均值先对同日股票等权，再对有信号日期等权；不是周收益承诺、实盘收益或组合净值。缺乏可成交证据，停牌、涨跌停和跳空可能阻止进出。无信号、无可靠区间保持未知。</p><h3>扩展范围另列 · '+s.expandedDevelopmentStockDays+' 个股票日</h3><p>以下结果覆盖不同股票范围，不能直接与上表均值相减，冒充同样本提升。</p><div class="table-wrap" role="region" tabindex="0" aria-label="扩展股票范围结果"><table class="table">'+head+'<tbody>';
 for(const [m,name]of Object.entries(models))h+=row(s.regimes.long_expanded.models[m].scopes.expanded_readable,name,'data-long-expanded="'+m+'"');
 h+='</tbody></table></div>'+quarterDetails(a)+'<details><summary>查看误差差值区间与核查材料</summary><p>差值为前配置减后配置，负值代表本次开发样本误差更低；400次10日日期块区间仅探索性，且包含多组比较，不能当未来优势证明。</p>';
 h+=s.pairedCoreBrierDifferences.map(d=>'<p>'+esc(d.a+' − '+d.b)+'：'+d.difference.toFixed(6)+'，区间 '+d.uncertainty.low.toFixed(6)+' 至 '+d.uncertainty.high.toFixed(6)+'</p>').join('');
 h+='<p>当前股票名单含幸存者和流动性选择偏差；未取得的 '+c.failedStocks+' 只没有补抽。复权与历史报价尺度未经独立核验。原始请求、排除台账、模型、所有预测均留档；'+a.replay.manifestFilesVerified+' 个归档文件哈希已检查，九个保存模型的推理预测已复算，不代表重新训练或最终测试通过。</p><p>原始产物临时到期 '+esc(a.artifact?.expiresAt)+'；不是永久备份。首轮记录继续保留。</p><a href="'+esc(a.sourceRunUrl)+'" target="_blank" rel="noopener noreferrer">训练记录与全部原始产物 ↗</a><p class="muted">研究版本 '+esc(a.sourceCommit)+'</p></details><p class="warning">实际交易收益、组合最大回撤、先止盈后止损：未研究。正式资格仍未判定，T2未启用，个人风险预算待设置。</p></section>';
 return h;
}

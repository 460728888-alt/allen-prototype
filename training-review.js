const finite=x=>typeof x==='number'&&Number.isFinite(x);
const count=x=>Number.isInteger(x)&&x>=0;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={logistic:'逻辑回归',lightgbm:'LightGBM',catboost:'CatBoost'};
function valid(a){
 return a?.schema===1&&a.kind==='exploratory_development_only'&&a.approved===false&&a.probabilitiesEnabled===false
  &&a.finalTestOpened===false&&a.winner===null&&a.target==='next_open_to_fifth_close_gross_up'
  &&a.selectionThreshold===.6&&/^https:\/\/github\.com\/460728888-alt\/allen-prototype\/actions\/runs\/\d+$/.test(a.sourceRunUrl||'')
  &&a.coverage?.requestedStocks===32&&count(a.coverage.receivedStocks)&&a.coverage.receivedStocks>0
  &&count(a.coverage.failedStocks)&&a.coverage.receivedStocks+a.coverage.failedStocks===32
  &&['train','calibration','development','purged','embargo_or_outside'].every(k=>count(a.counts?.[k]))
  &&a.counts.train>0&&a.counts.development>0&&count(a.coverage.readableLabels)&&count(a.coverage.eligibleStockDays)
  &&a.coverage.readableLabels<=a.coverage.eligibleStockDays&&count(a.coverage.benchmarkPairedLabels)
  &&a.coverage.benchmarkPairedLabels<=a.coverage.readableLabels
  &&Object.values(a.counts).reduce((s,x)=>s+x,0)===a.coverage.readableLabels
  &&finite(a.constantBrier)&&a.constantBrier>=0&&a.constantBrier<=1
  &&Object.keys(names).every(k=>a.models?.[k]?.status==='research_only'&&finite(a.models[k].brier)
   &&a.models[k].brier>=0&&a.models[k].brier<=1&&finite(a.models[k].auc)&&a.models[k].auc>=0&&a.models[k].auc<=1
   &&count(a.models[k].signals)&&a.models[k].signals<=a.counts.development);
}
export function renderTrainingReview(a){
 if(!valid(a))return '<section class="card" id="trainingReview" data-state="unavailable"><h2>训练核查结果暂不可读取</h2><p>缺少可核对的报告，暂停展示成绩；不能显示为没有机会或零收益。</p></section>';
 const noSignals=Object.keys(names).every(k=>a.models[k].signals===0);
 return '<section class="card" id="trainingReview" data-state="research-only"><div class="eyebrow">TRAINED / DEVELOPMENT ONLY</div><h2>首轮训练完成，暂不启用预测</h2><p class="notice">固定32只股票的历史数据，取得 '+a.coverage.receivedStocks+'，失败 '+a.coverage.failedStocks+'；可读开发样本 '+a.counts.development+' 个股票日。2025年已经参与过研究，只能作为开发验证，不能当最终未见考试。</p><p><b>研究目标：</b>次交易日开盘至第五交易日收盘的原始价格是否上涨，未扣费。跑赢大盘概率、先止盈后止损概率尚未评估。</p><p class="warning">'+(noSignals?'三个模型都未产生达到固定0.6实验阈值的信号。没有降低阈值凑推荐；这是2025年开发样本结果，不能解读为今天没有机会。':'实验信号仍需可成交验证和最终样本外检验，不作为买点或上线概率。')+'</p><div class="table-wrap" role="region" tabindex="0" aria-label="固定模型开发结果"><table class="table"><thead><tr><th>固定候选</th><th>概率误差 Brier</th><th>区分能力 AUC</th><th>实验阈值信号数</th></tr></thead><tbody>'+Object.entries(names).map(([k,name])=>'<tr data-training-model="'+k+'"><td>'+name+'</td><td>'+a.models[k].brier.toFixed(4)+'</td><td>'+a.models[k].auc.toFixed(4)+'</td><td>'+a.models[k].signals+'</td></tr>').join('')+'</tbody></table></div><p class="muted">误差越小越好；仅用训练期上涨比例作常数预测，其开发集Brier为 '+a.constantBrier.toFixed(4)+'。AUC在0.5附近表示本次区分能力有限，不等于上涨概率或交易胜率。这里没有统计显著性结论，不根据这一轮挑冠军。</p><details><summary>查看分段、风险与复核材料</summary><p>训练：2024年截至8月30日；校准：9月9日至12月31日；开发：2025年1月9日至12月31日。跨边界标签剔除 '+esc(a.counts.purged)+' 个。ret60使用61根完整日线；未用2026日线作特征、标签或评估。</p><p>报价尺度和复权未独立核验，固定当前名单含幸存者偏差。五日样本相互重叠，未完成可执行组合回测、最大回撤和统计区间验证。实际收益与无信号成本结果保持未知，不显示成0。</p><p>这是新实验重新下载的数据，未恢复旧研究丢失的原始逐日样本。完整产物包括新原始请求、协议、排除台账、模型和全部预测。</p><p>产物临时到期 '+esc(a.artifact?.expiresAt||'尚未核验')+'；需登录GitHub下载，不是永久备份。当前环境没有下载整个压缩包再独立复算。</p><p>接口可能附带当前行情元数据，除股票代码外均未用于特征或标签。</p><a href="'+esc(a.sourceRunUrl)+'" target="_blank" rel="noopener noreferrer">查看训练记录与下载实验产物 ↗</a><p class="muted">计算版本 '+esc(a.sourceCommit)+' · 完成 '+esc(a.completedAt)+'</p></details><p class="warning">上线门槛尚未通过，保持观察研究；不启用模型概率，不生成个人仓位建议。</p></section>';
}

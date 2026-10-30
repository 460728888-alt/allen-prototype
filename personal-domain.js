import {calendarExpectation,originalScaleComparable} from './lib/data-contract.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n),positive=n=>finite(n)&&n>0;
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const through=s=>s?.dataThrough||s?.data?.dataThrough;
const complete=s=>s?.data?.complete===true||s?.data?.lastBarComplete===true||(s?.history?.at(-1)?.complete===true&&s.history.at(-1).date===through(s));
const labels={ok:'数据正常',partial:'部分覆盖',failed:'请求失败',stale:'数据过期',insufficient:'数据不足',unverified:'时效待核验'};
const rawOK=s=>!!s&&s.data?.state==='ok'&&complete(s)&&positive(s.price)&&validDate(through(s));
const comparable=(o,s)=>validDate(o?.dataThrough)&&validDate(s?.data?.historyStart)&&Array.isArray(s?.data?.corporateActions)&&s.data.corporateActions.every(e=>validDate(e?.date))&&through(s)>=o.dataThrough&&originalScaleComparable(o,{...s,dataThrough:through(s)});
export function assessData(status,market,calendar,now=new Date()){
 const coverage=status?.coverage||{},items=market?.stocks;let expected=null,dataThrough=market?.dataThrough||status?.dataThrough||null;
 const result=(state,title,message,canJudge=false)=>({state,title,message,canJudge,expectedThrough:expected,dataThrough,coverage,failures:status?.failures||[]});
 if(status?.state==='failed')return result('failed','无法完成判断',status.message||'本次数据请求失败；不能解释为没有机会。');
 if(!status||status.state==='unavailable')return result('insufficient','无法完成判断','真实数据尚未就绪；不能解释为没有机会。');
 let cal;try{cal=calendarExpectation(calendar,now)}catch{return result('unverified','日历无法核验','日期或交易日历格式异常，暂停判断。')}
 expected=cal.expected;
 if(!cal.verified)return result('unverified','日历无法核验',cal.reason);
 if(!Array.isArray(items))return result('failed','无法完成判断','股票文件格式异常。');
 if(dataThrough&&!validDate(dataThrough))return result('unverified','数据日期未核验','缺少有效数据截止日期。');
 if(dataThrough>expected)return result('unverified','数据日期未核验','文件日期晚于应有完整日线，暂停判断。');
 if(!dataThrough)dataThrough=items.map(through).filter(validDate).sort().at(-1)||null;
 if(dataThrough>expected)return result('unverified','数据日期未核验','个股日期晚于应有完整日线。');
 const readable=items.filter(s=>rawOK(s)&&through(s)===expected);
 if(!readable.length){const stale=dataThrough&&dataThrough<expected;return result(stale?'stale':'insufficient',stale?'数据过期':'无法完成判断',stale?'旧快照落后于应有完整交易日；暂停新判断。':'缺少可判断的完整日线或有效价格；不能解释为没有机会。')}
 if(!['ok','partial'].includes(status.state))return result('unverified','数据状态待核验','生成任务未返回可靠状态。');
 const partial=status.state==='partial'||coverage.fallback===true||readable.length!==items.length||['failed','stale','insufficient','notRequested'].some(k=>finite(coverage[k])&&coverage[k]>0);
 return result(partial?'partial':'ok',partial?'部分覆盖':'数据正常',partial?'仅在本次有效范围内判断；未覆盖或失败部分仍未知。':'只使用应有交易日的完整日线，不代表存在机会。',true);
}
export function stockQuality(stock,a){
 let state='insufficient',reason='有效价格或完整日线缺失，暂停判断。';
 if(!a?.canJudge){state=a?.state||'unverified';reason=a?.message||'全局数据状态未核验。'}
 else if(through(stock)>a.expectedThrough){state='unverified';reason='个股日期晚于已完成交易日。'}
 else if(stock?.data?.state==='stale'||(validDate(through(stock))&&through(stock)<a.expectedThrough)){state='stale';reason='个股行情落后于应有完整交易日。'}
 else if(['failed','request_failed'].includes(stock?.data?.state)){state='failed';reason='个股请求失败。'}
 else if(rawOK(stock)&&through(stock)===a.expectedThrough){state='ok';reason='有效完整日线。'}
 return {state,label:labels[state]||labels.unverified,canJudge:state==='ok',reason};
}
export function isObservation(s){const p=s?.profile,v=s?.structure?.volume;return rawOK(s)&&s.levels?.state==='ok'&&['usefulPullback','volumeDriedUp','priceTight','lowsStoppedFalling'].every(k=>p?.[k]===true)&&['current','average20','ratio'].every(k=>positive(v?.[k]))&&positive(p.volumeDryRatio)}
export function stageOf(s,a,record=null){
 const stage=(id,label,reason)=>({id,label,reason});
 if(record?.status==='invalidated')return stage('invalid','已留档失效','保留原判断与失效记录。');
 if(record?.status==='closed')return stage('follow','研究已结束','结束不等于盈利，结果需分别核验。');
 const q=stockQuality(s,a);if(!q.canJudge)return stage('paused','暂停核验',q.reason);
 const o=record?.original,stop=o?.levels?.invalidation??o?.levels?.stop;
 if(o&&!comparable(o,s))return stage('paused','原价尺度待核验','公司行动或覆盖不足，暂停原价比较。');
 if(o&&positive(stop)&&s.price<=stop)return stage('invalid','原结构条件已触发失效','有效完整收盘触及原失效价，不等待放量。');
 const raw=s.structure?.stage||'';
 if(raw==='结构失效')return stage('invalid','结构破位','仅描述当前窗口；未保存的旧判断不能事后冒认。');
 if(raw==='向上突破待确认')return stage('trigger','价格量能触发·待确认','触发不等于买点，仍需随后守住原突破位。');
 if(raw==='突破后回踩')return stage('pullback','回踩线索·待核验','原突破位置与先后顺序还需核实，不能直接认定有效回踩。');
 if(isObservation(s)||s.structure?.evidence?.compression===true)return stage('compression','收窄整理·待确认','整理线索不证明后续上涨。');
 if(raw.includes('回调'))return stage('pullback','回调线索·趋势待核验','尚未证明此前有明确上涨趋势。');
 return stage('trend','前置趋势待核验','均线线索不能代替先后核验。');
}
export function explain(s,a,record=null){
 const p=s?.profile||{},v=s?.structure?.volume||{},range=s?.structure?.range||{},l=record?.original?.levels||s?.levels||{},at=through(s)||'截止未知',rows=s?.history||s?.miniHistory||[],fmt=n=>finite(n)?n.toFixed(2):'未核验';
 const dates=(from,to)=>rows.length>=Math.abs(from)?rows.at(from)?.date+' 至 '+rows.at(to)?.date:'完整日期待核验';
 const source=typeof s?.source==='string'?s.source:s?.source?.provider||'公开日线提供方，未经独立核验',stop=l.invalidation??l.stop,q=stockQuality(s,a),scale=record?.original?comparable(record.original,s):true;
 return {reason:stageOf(s,a,record).reason,support:[
 {title:'回调线索',text:'原观察回撤 '+fmt(p.pullbackPct)+'%；尚未证明此前有明确上涨趋势。',date:dates(-60,-1),formula:'此前40根最高价，对比最近20根最低价：(近期低点/前段高点−1)×100；原观察范围−30%至−5%。',source},
 {title:'成交量减少',text:'最近5根/之前20根均量比 '+fmt(p.volumeDryRatio)+'；缺量不能当缩量。',date:dates(-25,-1),formula:'最近5根均量 ÷ 再往前20根均量；原观察阈值≤0.90。',source},
 {title:'波动收窄',text:'结构区间宽度 '+fmt(range.widthPct)+'%；收窄标记 '+(s?.structure?.evidence?.compression===true?'成立':'尚未成立或未知')+'。',date:dates(-21,-2),formula:'此前20根不含判断日，区间宽度/中点≤12%，且|MA5/MA20−1|≤5%；仅说明整理。',source},
 {title:'价格量能触发',text:'当日量比 '+fmt(v.ratio)+'；突破参考 '+fmt(l.breakout)+'。',date:at,formula:'有效完整收盘≥突破参考，且当日量/此前20根均量≥1.5；随后守位仍需观察。',source}],
 doubt:'前置上涨、先后关系及收益优势未证明；T1＋1.5配置不兼容，合格候选未判定，T2未启用。',
 confirmation:positive(l.breakout)?(q.canJudge?'':'先补齐可靠完整日线；')+'收盘≥'+fmt(l.breakout)+'且量比≥1.5只算触发，继续观察随后1—3个交易日能否守住原突破位。':'突破价未核验，先补齐数据与结构条件。',
 invalidation:positive(stop)?'有效完整日线收盘≤原失效参考 '+fmt(stop)+'即可结束原结构，不等待放量；'+(!q.canJudge?'当前数据不可判断，不能判为失效。':!scale?'原价尺度不可比，暂停触发核验。':'实际退出可能受跳空、跌停或停牌影响。'):'失效价未核验，不生成退出结论。',probability:null};
}
export function selectFocus(items,a,limit=3){return (Array.isArray(items)?items:[]).filter(s=>stockQuality(s,a).canJudge&&isObservation(s)&&stageOf(s,a).id!=='invalid').slice().sort((x,y)=>String(x.symbol).localeCompare(String(y.symbol))).slice(0,Math.max(0,Math.min(3,Number.isInteger(limit)?limit:3)))}

const ORDER=['all_readable','simple_trend','legacy_observation','legacy_with_prior_trend','price_trigger_only'];
const COSTS=[0,30,60];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const number=v=>finite(v)?v:null;
const count=v=>Number.isInteger(v)&&v>=0?v:null;
const fraction=v=>finite(v)&&v>=0&&v<=1?v:null;
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const unknownInterval=()=>({low:null,high:null,crossesZero:null,replicates:null});
const fail=(reason,costBps=null)=>({state:'invalid',reason,costBps,groups:[],selected:null,coverage:null,winner:null,liveOutcomes:null});
function coverageOf(raw){
 if(!plain(raw))return null;const out={};
 for(const key of ['requestedStocks','receivedStocks','failedStocks','eligibleStockDays','submittedStockDays','featureReadable','validPriceLabels','purgedBoundary','benchmarkPriceLabels','missingBenchmarkLabels'])out[key]=count(raw[key]);
 out.benchmarkAvailable=typeof raw.benchmarkAvailable==='boolean'?raw.benchmarkAvailable:null;
 out.featureCoverage=fraction(raw.featureCoverage);out.priceLabelCoverage=fraction(raw.priceLabelCoverage);
 out.exclusionReasons=plain(raw.exclusionReasons)?Object.fromEntries(Object.entries(raw.exclusionReasons).map(([key,value])=>[key,count(value)])):null;return out;
}
function intervalOf(group){
 const source=group?.uncertainty?.sampleExcess;
 if(!plain(source)||source.state!=='exploratory_date_block_interval')return unknownInterval();
 const low=number(source.low),high=number(source.high),replicates=count(source.replicates);
 if(low===null||high===null||low>high)return {...unknownInterval(),replicates:replicates>0?replicates:null};
 return {low,high,crossesZero:low<=0&&high>=0,replicates:replicates>0?replicates:null};
}
function fixedQuarters(group){
 const rows=Array.isArray(group?.quarters)?group.quarters:[];
 return [1,2,3,4].map(quarter=>{
  const source=rows.find(q=>q.quarter===quarter),dates=count(source?.dates);
  return {quarter,dates,grossReturn:dates>0?number(source?.meanPriceReturn):null,sampleExcess:dates>0?number(source?.meanSampleExcess):null};
 });
}
function groupOf(id,source,costBps){
 const scenario=source?.hypotheticalCostScenarios?.find(s=>s.roundTripBps===costBps);
 return {id,available:!!source,signalStockDays:count(source?.signalStockDays),labelledStockDays:count(source?.labelledStockDays),labelMissing:count(source?.labelMissing),distinctDates:count(source?.distinctDates),distinctSymbols:count(source?.distinctSymbols),positiveFraction:fraction(source?.grossPositivePriceFraction),grossReturn:number(source?.dailyEqualWeightMeanPriceReturn),indexExcess:number(source?.dailyEqualWeightMeanIndexExcess),sampleExcess:number(source?.dailyEqualWeightMeanSampleExcess),assumedReturn:scenario?.executable===false?number(scenario.dailyEqualWeightMeanAssumedReturn):null,executable:scenario?.executable===false?false:null,interval:intervalOf(source),quarters:fixedQuarters(source)};
}
// A read-only view of an existing frozen reconstructed summary, not a new backtest.
export function buildStudyView(report,{costBps=30,groupId='legacy_observation'}={}){
 if(!COSTS.includes(costBps))return fail('只支持原摘要中的0、30、60bps假设成本。');
 if(!ORDER.includes(groupId))return fail('未知研究组，不能静默选择其他规则。',costBps);
 if(!plain(report)||report.approved!==false||report.provenance!=='reconstructed'||report.probabilitiesEnabled!==false)return fail('只接受未获批准、未启用概率的事后重建摘要。',costBps);
 if(!Array.isArray(report.groups)||!report.groups.length)return fail('研究摘要缺少规则组，不能生成比较结果。',costBps);
 const byId=new Map();
 for(const source of report.groups){
  if(!plain(source)||!ORDER.includes(source.id))return fail('摘要含未知或无效研究组，暂停比较。',costBps);
  if(byId.has(source.id))return fail('研究组编号重复，不能选择表现较好的一条。',costBps);
  byId.set(source.id,source);
  const scenarios=source.hypotheticalCostScenarios;
  if(scenarios!==undefined&&scenarios!==null&&!Array.isArray(scenarios))return fail('成本场景格式异常。',costBps);
  const seenCosts=new Set();
  for(const scenario of Array.isArray(scenarios)?scenarios:[]){
   if(!plain(scenario)||!COSTS.includes(scenario.roundTripBps)||scenario.executable!==false)return fail('成本场景未明确标为原假设场景，不能称为实际交易收益。',costBps);
   if(seenCosts.has(scenario.roundTripBps))return fail('同一成本场景重复，不能选择较好的结果。',costBps);
   seenCosts.add(scenario.roundTripBps);
  }
  const quarters=source.quarters;
  if(quarters!==undefined&&quarters!==null&&!Array.isArray(quarters))return fail('季度摘要格式异常。',costBps);
  const seenQuarters=new Set();
  for(const quarter of Array.isArray(quarters)?quarters:[]){
   if(!plain(quarter)||![1,2,3,4].includes(quarter.quarter)||seenQuarters.has(quarter.quarter))return fail('季度摘要无效或重复，不能静默挑选。',costBps);
   seenQuarters.add(quarter.quarter);
  }
 }
 const groups=ORDER.map(id=>groupOf(id,byId.get(id),costBps)),coverage=coverageOf(report.coverage);
 const incomplete=!coverage||groups.some(g=>!g.available||['signalStockDays','labelledStockDays','labelMissing','distinctDates','distinctSymbols','positiveFraction','grossReturn','indexExcess','sampleExcess','assumedReturn'].some(k=>g[k]===null)||g.interval.low===null||g.interval.replicates===null||g.quarters.some(q=>q.dates===null||q.grossReturn===null||q.sampleExcess===null));
 return {state:incomplete?'partial':'ok',reason:incomplete?'部分摘要字段缺失或未核验；未知保持空值，不补0。':'只展示已留存的事后重建摘要，未证明可执行优势。',costBps,groups,selected:groups.find(g=>g.id===groupId),coverage,winner:null,liveOutcomes:null};
}

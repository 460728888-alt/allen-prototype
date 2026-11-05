import {stockQuality,stageOf} from './personal-domain.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v),positive=v=>finite(v)&&v>0;
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const through=s=>s?.dataThrough||s?.data?.dataThrough||null;
const text=v=>typeof v==='string'?v:'';
export const REVIEW_GROUPS=[{id:'invalidated',label:'原结构已失效'},{id:'paused',label:'暂停复核'},{id:'price_condition',label:'价格触及原突破参考'},{id:'waiting',label:'等待条件'}];
const rank=new Map(REVIEW_GROUPS.map((g,i)=>[g.id,i]));
function scaleIssue(original,current){
 const originalThrough=through(original),currentThrough=through(current),start=current?.data?.historyStart,actions=current?.data?.corporateActions;
 if(!day(originalThrough))return '原始数据截止日期未核验，暂停原价比较。';
 if(!day(currentThrough)||currentThrough<originalThrough)return '当前日期缺失或早于原判断，暂停原价比较。';
 if(!day(start)||start>originalThrough)return '当前历史未覆盖原判断日期，暂停原价比较。';
 if(!Array.isArray(actions)||actions.some(e=>!day(e?.date)))return '公司行动记录未核验，暂停原价比较。';
 if(actions.some(e=>e.date>originalThrough&&e.date<=currentThrough))return '原判断之后存在分红或拆合股等公司行动，原价尺度不可直接比较。';
 return null;
}
// Read-only: does not mutate original snapshots or append events.
export function buildReviewQueue(records,stocks,assessment){
 const rows=Array.isArray(stocks)?stocks:[],bySymbol=new Map(),duplicates=new Set();
 for(const s of rows){if(typeof s?.symbol!=='string')continue;if(bySymbol.has(s.symbol))duplicates.add(s.symbol);else bySymbol.set(s.symbol,s)}
 const items=[];
 for(const r of Array.isArray(records)?records:[]){
  if(!r||typeof r.id!=='string'||!['observing','invalidated'].includes(r.status))continue;
  const current=bySymbol.get(r.symbol),original=r.original,stop=original?.levels?.invalidation??original?.levels?.stop,breakout=original?.levels?.breakout;
  const quality=stockQuality(current,assessment);
  let issue=!current?'不在本次发布范围，不能判为失效。':duplicates.has(r.symbol)?'同一证券有重复快照，暂停混合判断。':!quality.canJudge?(Array.isArray(current.data?.reasons)&&current.data.reasons.length?current.data.reasons.join('；'):quality.reason):scaleIssue(original,current);
  if(!issue&&!positive(stop))issue='原始失效参考缺失，暂停复核。';
  if(!issue&&stageOf(current,assessment,r).id==='paused')issue='原价尺度或完整日期尚未核验，暂停原条件比较。';
  const price=!issue&&positive(current?.price)?current.price:null;
  const distance=price!==null&&positive(stop)?(price/stop-1)*100:null;
  let group,label,reason,next;
  if(r.status==='invalidated'){
   group='invalidated';label='原结构已失效';reason='此研究已保存失效记录，原始判断仍保留。';
   next='查看原判断及失效记录；结构失效不代表已卖出或按参考价成交。';
  }else if(issue){
   group='paused';label='暂停复核';reason=issue;
   next='补齐可靠数据或核对价格尺度后再复核；当前不能据此认定失效。';
  }else if(price<=stop){
   group='invalidated';label='原失效条件已触及';reason='当前有效完整收盘不高于原失效参考，不等待放量。';
   next='复核原判断与后续记录；实际退出仍受跳空、跌停、停牌和可成交条件限制。';
  }else if(!positive(breakout)){
   group='paused';label='暂停复核';reason='原始突破参考缺失，不能判断价格条件。';
   next='核对原研究条件；不使用当前窗口的新突破价替换原条件。';
  }else if(price>=breakout){
   group='price_condition';label='价格触及原突破参考';reason='有效完整收盘已达到原突破参考，仅表示价格条件触及。';
   next='继续核验原量能条件及随后守位；不等于放量确认、买点或上涨保证。';
  }else{
   group='waiting';label='等待条件';reason='有效完整收盘尚未达到原突破参考，继续等待。';
   next='跟踪原确认和失效条件，原始价位不随新窗口自动移动。';
  }
  items.push({id:r.id,symbol:text(r.symbol),name:text(r.name)||text(r.symbol),group,label,reason,next,currentPrice:group==='paused'?null:price,distancePct:group==='paused'||!finite(distance)?null:distance,originalThrough:through(original)||r.dataThrough||null,currentThrough:through(current),originalStop:positive(stop)?stop:null,originalBreakout:positive(breakout)?breakout:null,createdAt:text(r.createdAt),distanceLabel:'距原失效参考的结构距离，非可承受亏损或退出保证'});
 }
 items.sort((a,b)=>rank.get(a.group)-rank.get(b.group)||a.createdAt.localeCompare(b.createdAt)||a.symbol.localeCompare(b.symbol)||a.id.localeCompare(b.id));
 const counts=Object.fromEntries(REVIEW_GROUPS.map(g=>[g.id,items.filter(x=>x.group===g.id).length]));
 return {items,counts,total:items.length};
}

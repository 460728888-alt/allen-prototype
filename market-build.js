import {normalizeDailyChart,calendarExpectation,finiteNumber,failureOf} from './lib/data-contract.js';
import {priceLevels,SCREEN_STRATEGY} from './lib/price-levels.js';
import {analyzeVolumeStructure} from './lib/volume-structure.js';
import {buildVolumeScreenProfile} from './lib/volume-screen.js';
const finite=x=>typeof x==='number'&&Number.isFinite(x),validSymbol=x=>/^\d{6}\.(SS|SZ)$/.test(x),iso=x=>new Date(x).toISOString();
export const FALLBACK=Object.entries({'601138.SS':'工业富联','000977.SZ':'浪潮信息','688981.SS':'中芯国际','300750.SZ':'宁德时代','600519.SS':'贵州茅台','000001.SZ':'平安银行','000858.SZ':'五粮液','002594.SZ':'比亚迪','600036.SS':'招商银行','601318.SS':'中国平安','601166.SS':'兴业银行','600030.SS':'中信证券','688008.SS':'澜起科技','002463.SZ':'沪电股份','603986.SS':'兆易创新','000333.SZ':'美的集团','000651.SZ':'格力电器','300059.SZ':'东方财富','600276.SS':'恒瑞医药','601899.SS':'紫金矿业','600900.SS':'长江电力','601088.SS':'中国神华','000725.SZ':'京东方A','002475.SZ':'立讯精密','300308.SZ':'中际旭创','002230.SZ':'科大讯飞','600887.SS':'伊利股份','601012.SS':'隆基绿能','688041.SS':'海光信息','000823.SZ':'超声电子','600667.SS':'太极实业','603083.SS':'剑桥科技'}).map(([symbol,name])=>({symbol,code:symbol.slice(0,6),name}));
async function getJSON(url,{fetchImpl,clock,deadline,timeoutMs=12000,referer}){
 const remaining=deadline-clock();if(remaining<=0)throw Object.assign(Error('本次取数预算已用尽'),{code:'time_budget',state:'request_failed'});
 const r=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 AllenPersonalResearch/1',...(referer?{Referer:referer}:{})},signal:AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,remaining)))});
 if(!r.ok)throw Object.assign(Error('公开数据源返回 HTTP '+r.status),{code:'http_'+r.status,state:'request_failed'});return r.json();
}
function poolRow(r){
 const code=String(r.code||''),name=String(r.name||code).slice(0,100);
 const symbol=/^[036]\d{5}$/.test(code)?code+(code.startsWith('6')?'.SS':'.SZ'):null;
 const price=finiteNumber(r.trade),amount=finiteNumber(r.amount),cap=finiteNumber(r.mktcap);
 return symbol&&price>=2&&amount>=2e7&&cap>=1e5&&!/(?:\*?ST|退市)/i.test(name)?{symbol,code,name,amount}:null;
}
export async function fetchPool({fetchImpl=globalThis.fetch,clock=Date.now,deadline=clock()+360000,limit=1200}={}){
 const sourceFailures=[],selected=new Map(),poolDeadline=Math.min(deadline,clock()+60000);let returnedPages=0,requestedPages=0;
 for(let page=1;page<=60&&clock()<poolDeadline;page+=4){
  const pages=Array.from({length:Math.min(4,61-page)},(_,i)=>page+i);
  const results=await Promise.allSettled(pages.map(async number=>{
   requestedPages++;
   const rows=await getJSON('https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?num=100&sort=amount&asc=0&node=hs_a&symbol=&page='+number,{fetchImpl,clock,deadline:poolDeadline,timeoutMs:8000,referer:'https://finance.sina.com.cn/'});
   if(!Array.isArray(rows))throw Object.assign(Error('股票池分页格式异常'),{code:'pool_format',state:'request_failed'});return rows;
  }));
  let nonempty=false;
  results.forEach((r,i)=>{if(r.status==='rejected'){sourceFailures.push({source:'sina_current_pool_page_'+pages[i],...failureOf(r.reason)});return}returnedPages++;if(r.value.length)nonempty=true;for(const raw of r.value){const item=poolRow(raw);if(item&&!selected.has(item.symbol))selected.set(item.symbol,item)}});
  if(selected.size>=limit||!returnedPages||!nonempty)break;
 }
 const rows=[...selected.values()].sort((a,b)=>b.amount-a.amount||a.symbol.localeCompare(b.symbol)).slice(0,limit);
 if(rows.length)return {rows,source:'sina_current_amount_rank_filtered',fallback:false,sourceFailures,requestedPages,returnedPages};
 sourceFailures.push({source:'sina_current_pool',code:'fallback_pool',message:'未取得可用动态股票池，使用原仓库固定32只A股备用样本，不是全市场覆盖'});
 return {rows:FALLBACK.slice(0,limit),source:'repository_CN_NAMES_fixed_32_survivors',fallback:true,sourceFailures,requestedPages,returnedPages};
}
export function normalizeStock(item,result,{calendar,now,provider='Yahoo Finance public daily chart',fetchedAt=now.toISOString()}){
 if(!validSymbol(item.symbol)||result?.meta?.symbol!==item.symbol)throw Object.assign(Error('返回证券代码与请求不一致'),{state:'request_failed',code:'symbol_mismatch'});
 const normalized=normalizeDailyChart(result,{symbol:item.symbol,calendar,now,minimum:60});
 const history=normalized.rows.slice(-120),last=history.at(-1),previous=history.at(-2);
 const data={...normalized.data,judgmentAsOf:now.toISOString(),fetchedAt,complete:normalized.data.state==='ok'&&last?.complete===true&&!last?.missingSession};
 let levels=priceLevels(history),structure=null,profile=null;
 if(data.state==='ok')try{structure=analyzeVolumeStructure(history);levels=structure.levels;profile=buildVolumeScreenProfile(history,structure)}catch(error){data.state='insufficient';data.complete=false;data.reasons=[...new Set([...data.reasons,error.message])]}
 const current=finite(last?.close)&&last.close>0?last.close:null,changePct=current!==null&&finite(previous?.close)&&previous.close>0?(current/previous.close-1)*100:null;
 const observation=data.state==='ok'&&profile?.usefulPullback===true&&profile?.volumeDriedUp===true&&profile?.priceTight===true&&profile?.lowsStoppedFalling===true;
 const source={provider,fetchedAt,quoteBasis:'provider_daily_quote_anchored_at_judgment_day',historicalQuoteScaleVerified:false,note:'提供方可能修订历史报价；严格历史报价尺度未独立核验'};
 const stock={symbol:item.symbol,code:item.symbol.slice(0,6),name:String(item.name||result.meta.longName||result.meta.shortName||item.symbol).slice(0,120),price:current,changePct,currency:typeof result.meta.currency==='string'?result.meta.currency:null,exchange:typeof result.meta.exchangeName==='string'?result.meta.exchangeName:null,industry:null,dataThrough:data.dataThrough,data,levels,structure,profile,strategy:SCREEN_STRATEGY,stage:structure?.stage||'暂停核验',observation,qualified:null,probability:null,detailPath:'data/stocks/'+item.symbol+'.json',miniHistory:history.slice(-20).map(r=>({date:r.date,close:r.close,volume:r.volume,complete:r.complete,missingSession:!!r.missingSession})),source};
 const detail={...stock,history,company:{name:stock.name,exchange:stock.exchange,currency:stock.currency},financial:{state:'unavailable',message:'尚未接入可核验财报、披露时间和报告期，不以缺失替代0'},news:{state:'unavailable',items:[],message:'尚未自动采集公告正文；事件不等于价格确认'}};
 return {stock,detail};
}
async function history(item,{fetchImpl,clock,deadline,now,expected,calendar}){
 const end=Date.parse(expected+'T00:00:00+08:00')+86400000,start=end-241*86400000;let lastError;
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com'])try{
  const query=new URLSearchParams({period1:String(Math.floor(start/1000)),period2:String(Math.floor(end/1000)),interval:'1d',events:'div,splits'});
  const body=await getJSON('https://'+host+'/v8/finance/chart/'+encodeURIComponent(item.symbol)+'?'+query,{fetchImpl,clock,deadline}),result=body?.chart?.result?.[0];
  if(!result)throw Object.assign(Error(String(body?.chart?.error?.description||'行情结果为空').slice(0,240)),{state:'request_failed',code:'empty_chart'});
  return normalizeStock(item,result,{calendar,now,fetchedAt:iso(clock()),provider:'Yahoo Finance / '+host});
 }catch(error){lastError=error;if(clock()>=deadline)break}
 throw lastError||Error('无法读取公开日线');
}
export async function buildMarket({calendar,fetchImpl=globalThis.fetch,now=new Date(),clock=Date.now,limit=1200,maxDurationMs=360000,pool=null,codeSourceCommit=null}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('构建时间无效');if(!Number.isInteger(limit)||limit<1||limit>1200)throw Error('股票上限必须在1至1200之间');
 const attemptedAt=now.toISOString(),deadline=clock()+maxDurationMs,expectation=calendarExpectation(calendar,now);
 const coverage={targetRequested:limit,poolSize:0,requested:0,returned:0,usable:0,failed:0,stale:0,insufficient:0,observations:0,qualified:null,poolSource:'not_fetched',fallback:false,notRequested:0};
 if(!expectation.verified)return {status:{schema:1,state:'unavailable',attemptedAt,generatedAt:iso(clock()),dataThrough:null,expectedThrough:null,codeSourceCommit,coverage,failures:[],sourceFailures:[],message:expectation.reason+'；无法完成判断'},market:null,details:{}};
 const selected=pool||await fetchPool({fetchImpl,clock,deadline,limit});
 const universe=[...new Map((selected.rows||[]).filter(i=>validSymbol(i?.symbol)).slice(0,limit).map(i=>[i.symbol,i])).values()];
 coverage.poolSize=universe.length;coverage.poolSource=selected.source||'explicit_test_pool';coverage.fallback=selected.fallback===true;
 const failures=[],stocks=[],details={};let next=0;
 async function worker(){while(next<universe.length&&clock()<deadline){const item=universe[next++];coverage.requested++;try{
  const parsed=await history(item,{fetchImpl,clock,deadline,now,expected:expectation.expected,calendar});coverage.returned++;
  if(parsed.stock.data.state==='ok'){coverage.usable++;if(parsed.stock.observation)coverage.observations++}
  else {if(parsed.stock.data.state==='stale')coverage.stale++;else coverage.insufficient++;failures.push({symbol:item.symbol,state:parsed.stock.data.state,code:parsed.stock.data.state,message:parsed.stock.data.reasons.join('；').slice(0,240)})}
  stocks.push(parsed.stock);details[item.symbol]=parsed.detail;
 }catch(error){coverage.failed++;failures.push({symbol:item.symbol,...failureOf(error)})}}}
 await Promise.all(Array.from({length:Math.min(6,universe.length)},worker));coverage.notRequested=universe.length-coverage.requested;stocks.sort((a,b)=>a.symbol.localeCompare(b.symbol));
 const generatedAt=iso(clock());for(const s of stocks){s.generatedAt=generatedAt;details[s.symbol].generatedAt=generatedAt}
 const through=stocks.filter(s=>s.data.state==='ok').map(s=>s.dataThrough).filter(Boolean).sort(),dataThrough=through.length?through[0]:null,sourceFailures=selected.sourceFailures||[];
 const partial=coverage.fallback||sourceFailures.length>0||coverage.usable!==universe.length||coverage.notRequested>0,state=!coverage.usable?'failed':partial?'partial':'ok';
 const status={schema:1,state,attemptedAt,generatedAt,dataThrough,expectedThrough:expectation.expected,codeSourceCommit,coverage,failures,sourceFailures,poolPages:{requested:selected.requestedPages??null,returned:selected.returnedPages??null},message:!coverage.usable?'本次未取得可判断的完整日线，无法完成判断；旧成功快照保留，不能解释为没有机会':partial?'部分范围或来源有限，只对当前完整数据研究；其余范围未知':'已取得当前股票池完整日线；结构观察不是可靠买点'};
 return {status,market:{schema:1,dataKind:'historical_provider_data',generatedAt,dataThrough,expectedThrough:expectation.expected,codeSourceCommit,universeBasis:'current_liquid_pool_not_historical_point_in_time',stocks},details};
}

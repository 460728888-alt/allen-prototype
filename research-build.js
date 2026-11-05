const validSymbol=v=>typeof v==='string'&&/^\d{6}\.(SS|SZ)$/.test(v);
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const iso=v=>new Date(v).toISOString();
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&iso(Date.parse(v)).slice(0,10)===v;
const dateOf=v=>{const d=typeof v==='string'?v.slice(0,10):'';return day(d)?d:null};
const text=(v,max=1000)=>typeof v==='string'?v.trim().slice(0,max):'';
const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v!=='string'||!v.trim()||!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v.trim()))return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clone=v=>JSON.parse(JSON.stringify(v));
const cnDate=v=>iso(v+8*3600000).slice(0,10);
const shiftDay=(d,n)=>iso(Date.parse(d+'T00:00:00Z')+n*86400000).slice(0,10);
const errorInfo=e=>({code:e?.code||(['TimeoutError','AbortError'].includes(e?.name)?'timeout':'request_error'),message:text(e?.message||'公开数据获取失败',240)});
function quarters(today){const years=[Number(today.slice(0,4))-1,Number(today.slice(0,4))];return years.flatMap(y=>['03-31','06-30','09-30','12-31'].map(md=>y+'-'+md)).filter(d=>d<today).sort().reverse().slice(0,2)}
function query(base,params){return base+'?'+new URLSearchParams(params)}
const metrics={revenue:'TOTAL_OPERATE_INCOME',netProfit:'PARENT_NETPROFIT',revenueGrowth:'YSTZ',profitGrowth:'SJLTZ',roe:'WEIGHTAVG_ROE',grossMargin:'XSMLL',eps:'BASIC_EPS',bps:'BPS',operatingCashPerShare:'MGJYXJJE'};
export function normalizeFinancialRow(raw,{period,today,observedAt,symbol}={}){
 const expected=symbol?.replace('.SS','.SH');
 if(!validSymbol(symbol)||raw?.SECUCODE!==expected||String(raw.SECURITY_CODE||'')!==symbol.slice(0,6))throw Error('财报返回证券身份不一致');
 const reportDate=dateOf(raw.REPORTDATE),noticeDate=dateOf(raw.NOTICE_DATE),updateDate=raw.UPDATE_DATE===null||raw.UPDATE_DATE===undefined||raw.UPDATE_DATE===''?null:dateOf(raw.UPDATE_DATE);
 if(reportDate!==period||!noticeDate||noticeDate>today||reportDate>today||noticeDate<reportDate||((raw.UPDATE_DATE!==null&&raw.UPDATE_DATE!==undefined&&raw.UPDATE_DATE!=='')&&!updateDate)||updateDate>today)throw Error('报告期、披露日或修订日期缺失/未来，暂停使用');
 const values=Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,num(raw[v])]));
 if(!Object.values(values).some(v=>typeof v==='number'&&Number.isFinite(v)))throw Error('财报指标均缺失，暂停使用');
 return {reportDate,noticeDate,updateDate,observedAt,periodBasis:'year_to_date',currency:null,amountUnit:'source_yuan',unitNote:'来源页面金额单位为元，币种未注明；不默认CNY，不作汇率换算。',percentageUnit:'percent',reportName:text(raw.DATATYPE||raw.QDATE||raw.REPORT_TYPE||raw.REPORT_DATE_NAME,100)||period,industry:null,metrics:values,source:{provider:'东方财富公开业绩报表 RPT_LICO_FN_CPD',fetchedAt:observedAt,url:'https://data.eastmoney.com/bbsj/'+period.slice(0,7).replace('-','')+'/yjbb.html'},historicalAvailability:'provider_current_revision_not_point_in_time'};
}
export function normalizeCompany(raw,{symbol,fetchedAt}={}){
 const profile=raw?.jbzl,code=symbol?.slice(0,6);
 if(!validSymbol(symbol)||!profile||typeof profile!=='object'||Array.isArray(profile)||String(profile.agdm||'')!==code)throw Error('公司资料返回证券身份不一致');
 for(const value of [raw.SecurityCode,raw.SecuCode]){
  if(typeof value!=='string'||!value.trim())continue;const v=value.trim().toUpperCase(),m=v.match(/^(?:(SH|SZ))?(\d{6})(?:\.(SH|SZ))?$/);
  if(m&&(m[2]!==code||((m[1]||m[3])&&((m[1]||m[3])!==(symbol.endsWith('.SS')?'SH':'SZ')))))throw Error('公司资料顶层证券身份不一致');
 }
 const hasName=!!(text(profile.agjc,120)||text(profile.gsmc,240));
 return {state:hasName?'ok':'insufficient',cacheHit:false,symbol,fetchedAt,observedAt:fetchedAt,name:text(profile.agjc,120)||null,fullName:text(profile.gsmc,240)||null,industry:text(profile.sshy,200)||null,regulatoryIndustry:text(profile.sszjhhy,200)||null,exchange:text(profile.ssjys,120)||null,chairman:text(profile.dsz||profile.frdb,120)||null,generalManager:text(profile.zjl,120)||null,website:text(profile.gswz,400)||null,location:text(profile.qy,240)||null,introduction:text(profile.gsjj,8000)||null,business:text(profile.jyfw,8000)||null,source:{provider:'东方财富公司资料',fetchedAt,url:'https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code='+(symbol.endsWith('.SS')?'SH':'SZ')+code},historicalAvailability:'current_profile_not_point_in_time'};
}
export function normalizeAnnouncement(raw,{today,beginDate,observedAt,byCode}={}){
 const id=text(raw?.art_code,80),title=text(raw?.title_ch||raw?.title,1000),noticeDate=dateOf(raw?.notice_date);
 if(!/^AN\d{18}$/.test(id)||!title||!noticeDate||noticeDate>today||noticeDate<beginDate)throw Error('公告编号、标题或日期缺失/超出读取窗口');
 if(!Array.isArray(raw.codes))throw Error('公告缺少证券归属');
 const items=[],seen=new Set();let mismatches=0;
 for(const code of raw.codes){
  const six=String(code?.stock_code||''),symbol=byCode.get(six);if(!symbol)continue;
  const expected=symbol.endsWith('.SS')?'1':'0';
  if(String(code?.market_code)!==expected){mismatches++;continue}
  if(seen.has(symbol))continue;seen.add(symbol);
  const categories=Array.isArray(raw.columns)?[...new Set(raw.columns.map(c=>text(c?.column_name,120)).filter(Boolean))]:[];
  items.push({id,symbol,title,noticeDate,displayTime:text(raw.display_time,100)||null,displayTimeNote:'来源展示时间的时区与首次发布时刻未核验，不用于证明盘中已知。',category:categories.join(' / ')||'分类未提供',url:'https://data.eastmoney.com/notices/detail/'+six+'/'+id+'.html',observedAt,bodyRead:false,readState:'index_only',source:'东方财富公开公告索引'});
 }
 return {items,mismatches};
}
export async function buildResearch({market,now=new Date(),fetchImpl=globalThis.fetch,clock=Date.now,maxDurationMs=180000,previousBundles={},codeSourceCommit=null}={}){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('研究构建时间无效');
 if(!Array.isArray(market?.stocks))throw Error('缺少公开股票池');
 if(typeof maxDurationMs!=='number'||!Number.isFinite(maxDurationMs)||maxDurationMs<0)throw Error('研究请求预算无效');
 const startedAt=now.toISOString(),today=cnDate(now.getTime()),deadline=clock()+Math.min(180000,maxDurationMs),companyDeadline=Math.min(deadline,clock()+75000),periods=quarters(today),beginDate=shiftDay(today,-6);
 const stocks=[...new Map(market.stocks.filter(s=>validSymbol(s?.symbol)).map(s=>[s.symbol,s])).values()],byCode=new Map(stocks.map(s=>[s.symbol.slice(0,6),s.symbol])),bundles={},failures=[];
 const companyMeta={requested:0,returned:0,requestFailures:0,skipped:0,notRequested:0,ok:0,cached:0,failed:0,stale:0,insufficient:0};
 const financeMeta={requestedPages:0,returnedPages:0,pageCapPerPeriod:16,periods:[],rejectedRows:0,conflicts:0,complete:true};
 const newsMeta={beginDate,endDate:today,requestedPages:0,returnedPages:0,totalHits:null,totalPages:null,pageCap:20,truncated:false,rejectedItems:0,identityMismatches:0,complete:true};
 for(const s of stocks)bundles[s.symbol]={schema:1,symbol:s.symbol,company:{state:'not_requested',message:'本次尚未请求公司资料'},financial:{state:'unavailable',reports:[]},announcements:{state:'unavailable',items:[],scope:null}};
 async function get(url,until,ledger,key='requested'){
  const remaining=until-clock();if(remaining<=0)throw Object.assign(Error('本次公开研究取数预算已用尽'),{code:'time_budget'});
  ledger[key]++;
  const response=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 AllenPersonalResearch/1','Referer':'https://data.eastmoney.com/'},signal:AbortSignal.timeout(Math.max(1,Math.min(10000,remaining)))});
  if(!response.ok)throw Object.assign(Error('公开数据源返回 HTTP '+response.status),{code:'http_'+response.status});
  return {body:await response.json(),fetchedAt:iso(clock())};
 }
 const financialRows=new Map(),conflicted=new Set();
 async function financePeriod(period){
  const meta={period,requestedPages:0,returnedPages:0,totalPages:null,truncated:false,complete:true};financeMeta.periods.push(meta);
  const read=async page=>{
   const url=query('https://datacenter-web.eastmoney.com/api/data/v1/get',{reportName:'RPT_LICO_FN_CPD',columns:'ALL',filter:"(REPORTDATE='"+period+"')",sortColumns:'UPDATE_DATE,SECURITY_CODE',sortTypes:'-1,-1',pageSize:'500',pageNumber:String(page)});
   const result=await get(url,deadline,meta,'requestedPages');
   if(result.body?.success===false||!Array.isArray(result.body?.result?.data))throw Object.assign(Error('财报分页格式异常'),{code:'finance_format'});
   meta.returnedPages++;financeMeta.returnedPages++;
   for(const raw of result.body.result.data){
    const symbol=byCode.get(String(raw?.SECURITY_CODE||''));if(!symbol)continue;
    try{
     const report=normalizeFinancialRow(raw,{period,today,observedAt:result.fetchedAt,symbol}),key=symbol+'|'+period;
     if(conflicted.has(key))continue;
     const old=financialRows.get(key);
     if(old){
      const prior={...old,observedAt:null,source:{...old.source,fetchedAt:null}},next={...report,observedAt:null,source:{...report.source,fetchedAt:null}};
      if(JSON.stringify(prior)!==JSON.stringify(next)){financialRows.delete(key);conflicted.add(key);financeMeta.conflicts++;meta.complete=false;failures.push({symbol,source:'financial',code:'conflicting_report',message:'同一报告期重复行冲突，暂停使用该期数据'})}
     }else financialRows.set(key,report);
    }catch(error){financeMeta.rejectedRows++;meta.complete=false;failures.push({symbol,source:'financial',...errorInfo(error)})}
   }
   return result.body.result;
  };
  try{
   const first=await read(1),pages=num(first.pages);meta.totalPages=Number.isInteger(pages)&&pages>=0?pages:null;
   if(meta.totalPages===null){meta.complete=false;failures.push({source:'financial',period,code:'unknown_pages',message:'财报分页总数缺失，仅保留已取到记录'})}
   else{
    meta.truncated=meta.totalPages>16;
    for(let p=2;p<=Math.min(meta.totalPages,16);p++)await read(p);
    if(meta.truncated)meta.complete=false;
   }
  }catch(error){meta.complete=false;failures.push({source:'financial',period,...errorInfo(error)})}
  financeMeta.requestedPages+=meta.requestedPages;if(!meta.complete)financeMeta.complete=false;
 }
 async function finance(){
  await Promise.all(periods.map(financePeriod));
  for(const s of stocks){
   const reports=periods.map(p=>financialRows.get(s.symbol+'|'+p)).filter(Boolean);
   bundles[s.symbol].financial={state:reports.length?(financeMeta.complete&&reports.length===periods.length?'ok':'partial'):(financeMeta.returnedPages?'unavailable':'failed'),reports,scope:{periods:[...periods],complete:financeMeta.complete,pageCapPerPeriod:16},message:reports.length?'仅展示已取得且日期可核验的累计报告；当前修订版不能冒充历史当时数据。':'未取得可核验的已披露报告，不代表公司没有财报。'};
  }
 }
 async function companies(){
  let next=0;
  async function worker(){while(next<stocks.length){
   const item=stocks[next++],symbol=item.symbol,oldBundle=previousBundles?.[symbol],old=oldBundle?.symbol===symbol?oldBundle.company:null,oldTime=stamp(old?.fetchedAt)?Date.parse(old.fetchedAt):null;
   if(old&&['ok','cached'].includes(old.state)&&old.symbol===symbol&&oldTime!==null&&clock()>=oldTime&&clock()-oldTime<=7*86400000){
    bundles[symbol].company={...clone(old),state:'ok',cacheHit:true,source:{...clone(old.source||{}),fetchedAt:old.fetchedAt},observedAt:stamp(old.observedAt)&&Date.parse(old.observedAt)<=oldTime?old.observedAt:old.fetchedAt,message:'复用7日内公开资料，原获取与观察时间保留。'};continue;
   }
   if(clock()>=companyDeadline){
    companyMeta.skipped++;
    bundles[symbol].company={state:oldTime!==null?'stale':'not_requested',fetchedAt:old?.fetchedAt||null,observedAt:old?.observedAt||old?.fetchedAt||null,requestState:'not_requested',message:oldTime!==null?'旧公司资料超过缓存期限，本次预算未覆盖，暂停使用。':'本次公司资料预算未覆盖，不能视为没有公司资料。'};continue;
   }
   try{
    const prefix=(symbol.endsWith('.SS')?'SH':'SZ')+symbol.slice(0,6),url='https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code='+prefix;
    const result=await get(url,companyDeadline,companyMeta);companyMeta.returned++;
    bundles[symbol].company=normalizeCompany(result.body,{symbol,fetchedAt:result.fetchedAt});
   }catch(error){companyMeta.requestFailures++;bundles[symbol].company={state:'failed',previousFetchedAt:old?.fetchedAt||null,message:errorInfo(error).message};failures.push({symbol,source:'company',...errorInfo(error)})}
  }}
  await Promise.all(Array.from({length:Math.min(6,stocks.length)},worker));
  for(const b of Object.values(bundles)){if(b.company.cacheHit)companyMeta.cached++;else if(b.company.state==='not_requested')companyMeta.notRequested++;else if(Object.hasOwn(companyMeta,b.company.state))companyMeta[b.company.state]++}
 }
 async function announcements(){
  const all=new Map();
  const read=async page=>{
   const url=query('https://np-anotice-stock.eastmoney.com/api/security/ann',{sr:'-1',page_size:'100',page_index:String(page),ann_type:'A',client_source:'web',f_node:'0',s_node:'0',begin_time:beginDate,end_time:today});
   const result=await get(url,deadline,newsMeta,'requestedPages');
   if(!Array.isArray(result.body?.data?.list))throw Object.assign(Error('公告分页格式异常'),{code:'news_format'});
   newsMeta.returnedPages++;
   for(const raw of result.body.data.list)try{
    const n=normalizeAnnouncement(raw,{today,beginDate,observedAt:result.fetchedAt,byCode});newsMeta.identityMismatches+=n.mismatches;
    for(const item of n.items){const key=item.symbol+'|'+item.id;if(!all.has(key))all.set(key,item)}
   }catch(error){newsMeta.rejectedItems++}
   return result.body.data;
  };
  try{
   const first=await read(1),hits=num(first.total_hits);newsMeta.totalHits=Number.isInteger(hits)&&hits>=0?hits:null;
   newsMeta.totalPages=newsMeta.totalHits===null?null:Math.ceil(newsMeta.totalHits/100);
   if(newsMeta.totalPages===null){newsMeta.complete=false;failures.push({source:'announcements',code:'unknown_pages',message:'公告总数未取得，不能声称完整覆盖'})}
   else{
    newsMeta.truncated=newsMeta.totalPages>20;
    for(let p=2;p<=Math.min(newsMeta.totalPages,20);p++)await read(p);
    if(newsMeta.truncated)newsMeta.complete=false;
   }
  }catch(error){newsMeta.complete=false;failures.push({source:'announcements',...errorInfo(error)})}
  if(newsMeta.rejectedItems||newsMeta.identityMismatches)newsMeta.complete=false;
  const scope={from:beginDate,through:today,beginDate,endDate:today,complete:newsMeta.complete,totalHits:newsMeta.totalHits,totalPages:newsMeta.totalPages,returnedPages:newsMeta.returnedPages,pageCap:20,truncated:newsMeta.truncated,noticeTimePrecision:'day',displayTimeTimezoneVerified:false};
  for(const s of stocks){
   const items=[...all.values()].filter(x=>x.symbol===s.symbol).sort((a,b)=>b.noticeDate.localeCompare(a.noticeDate)||b.id.localeCompare(a.id));
   bundles[s.symbol].announcements={state:newsMeta.returnedPages?(newsMeta.complete?'ok':'partial'):'failed',items,scope:{...scope},message:items.length?'公告索引未读正文，事件不是价格确认。':'本窗口未取得匹配公告索引；不等于没有公告或风险。'};
  }
 }
 await Promise.all([finance(),companies(),announcements()]);
 const endedAt=iso(clock()),symbols={},eventItems=[];
 for(const s of stocks){
  const b=bundles[s.symbol];b.bundleId=s.symbol+':'+endedAt;b.fetchedAt=endedAt;b.asOf=endedAt;b.requestedAt=startedAt;b.codeSourceCommit=codeSourceCommit;
  symbols[s.symbol]={path:'data/research/'+s.symbol+'.json',bundleId:b.bundleId,states:{company:b.company.state,financial:b.financial.state,announcements:b.announcements.state}};
  eventItems.push(...b.announcements.items.map(item=>({...item,bundleId:b.bundleId})));
 }
 eventItems.sort((a,b)=>b.noticeDate.localeCompare(a.noticeDate)||b.id.localeCompare(a.id)||a.symbol.localeCompare(b.symbol));
 const coverage={poolSize:stocks.length,company:{...companyMeta,usable:companyMeta.ok+companyMeta.cached},financial:{withReports:Object.values(bundles).filter(b=>b.financial.reports.length).length,withoutReports:Object.values(bundles).filter(b=>!b.financial.reports.length).length,...financeMeta},announcements:{withItems:Object.values(bundles).filter(b=>b.announcements.items.length).length,withoutItems:Object.values(bundles).filter(b=>!b.announcements.items.length).length,...newsMeta}};
 const partial=!financeMeta.complete||!newsMeta.complete||companyMeta.ok+companyMeta.cached!==stocks.length||Object.values(bundles).some(b=>b.financial.state!=='ok');
 const usable=companyMeta.ok+companyMeta.cached>0||coverage.financial.withReports>0||newsMeta.returnedPages>0;
 const state=!stocks.length?'unavailable':!usable?'failed':partial?'partial':'ok',source={financial:'东方财富公开业绩报表',company:'东方财富公司资料',announcements:'东方财富公告索引',notice:'公开来源可能修订或缺失；首次观察时间来自本次实际获取，不回溯为披露日。'};
 const status={schema:1,state,generatedAt:endedAt,attemptedAt:startedAt,fetchedAt:endedAt,asOf:endedAt,priceDataThrough:market.dataThrough||null,codeSourceCommit,coverage,source,failures,message:partial?'部分研究来源未完整覆盖，未取得的内容保持未知。':'完成限定范围公开研究读取，指标与公告不构成买点或概率。'};
 const index={schema:1,state,generatedAt:endedAt,fetchedAt:endedAt,asOf:endedAt,priceDataThrough:market.dataThrough||null,codeSourceCommit,symbols,eventItems:eventItems.slice(0,60),eventScope:{maxItems:60,totalMatched:eventItems.length,order:'notice_date_desc_not_recommendation'},coverage,source};
 return {status,index,bundles};
}

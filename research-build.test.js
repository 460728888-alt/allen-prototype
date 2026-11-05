import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResearch,normalizeFinancialRow,normalizeCompany,normalizeAnnouncement} from './research-build.js';
const now=new Date('2026-11-05T00:00:00Z'),time=now.getTime(),at=now.toISOString(),today='2026-11-05',period='2026-09-30';
const market={dataThrough:'2026-11-04',stocks:[{symbol:'600036.SS',name:'合成银行甲'},{symbol:'000001.SZ',name:'合成银行乙'}]};
function rawFinance(symbol='600036.SS',p=period){return {SECUCODE:symbol.replace('.SS','.SH'),SECURITY_CODE:symbol.slice(0,6),REPORTDATE:p,NOTICE_DATE:p===period?'2026-10-25 00:00:00':'2026-08-01 00:00:00',UPDATE_DATE:p===period?'2026-10-28 00:00:00':'2026-08-02 00:00:00',TOTAL_OPERATE_INCOME:0,PARENT_NETPROFIT:-200,YSTZ:-12.5,SJLTZ:0,WEIGHTAVG_ROE:3.2,XSMLL:null,BASIC_EPS:-.2,BPS:12,MGJYXJJE:'--',PUBLISHNAME:'不是已核验行业'};}
function rawCompany(code='600036'){return {SecuCode:code+'.'+(code.startsWith('6')?'SH':'SZ'),jbzl:{agdm:code,agjc:'合成公司'+code,gsmc:'合成公司全称',sshy:'合成行业',gswz:'javascript:alert(1)',gsjj:'合成测试公司资料，不是真实研究'}};}
function rawNews(){return {art_code:'AN202611040000000001',title:'合成测试公告，不是利好判断',notice_date:'2026-11-04 00:00:00',display_time:'2026-11-04 18:00:00',columns:[{column_name:'其他'}],codes:[{stock_code:'600036',market_code:'1'},{stock_code:'000001',market_code:'0'}]};}
const response=body=>({ok:true,status:200,json:async()=>body});
function fetchFixture({financeTransform=x=>x,newsTransform=x=>x,companyTransform=x=>x,pages=1,hits=1,trace=[]}={}){return async url=>{
 const u=new URL(url);trace.push(u);
 if(u.hostname==='datacenter-web.eastmoney.com'){const p=u.searchParams.get('filter').match(/\d{4}-\d{2}-\d{2}/)[0],rows=financeTransform(market.stocks.map(s=>rawFinance(s.symbol,p)),u);return response({success:true,result:{pages,data:rows}})}
 if(u.hostname==='emweb.securities.eastmoney.com')return response(companyTransform(rawCompany(u.searchParams.get('code').slice(2)),u));
 if(u.hostname==='np-anotice-stock.eastmoney.com')return response({data:{total_hits:hits,list:newsTransform([rawNews()],u)}});
 throw Error('Unexpected external test request '+u.hostname);
};}
const run=changes=>buildResearch({market,now,clock:()=>time,fetchImpl:fetchFixture(),...changes});
test('financial values retain zero negatives missing values and source units',()=>{
 const r=normalizeFinancialRow(rawFinance(),{period,today,observedAt:at,symbol:'600036.SS'});
 assert.equal(r.metrics.revenue,0);assert.equal(r.metrics.netProfit,-200);assert.equal(r.metrics.revenueGrowth,-12.5);assert.equal(r.metrics.profitGrowth,0);assert.equal(r.metrics.grossMargin,null);assert.equal(r.metrics.operatingCashPerShare,null);assert.equal(r.currency,null);assert.equal(r.amountUnit,'source_yuan');assert.equal(r.percentageUnit,'percent');assert.equal(r.periodBasis,'year_to_date');assert.equal(r.observedAt,at);assert.equal(r.industry,null);assert.equal(Object.hasOwn(r,'ttm'),false);
});
test('financial identity and unknown or future disclosure dates fail closed',()=>{
 for(const patch of [{SECUCODE:'600036.SZ'},{SECURITY_CODE:'000001'},{REPORTDATE:'2026-12-31'},{NOTICE_DATE:null},{NOTICE_DATE:'2026-11-06'},{UPDATE_DATE:'2026-11-06'},{UPDATE_DATE:'2026-99-99'},{NOTICE_DATE:'2026-09-01'}])assert.throws(()=>normalizeFinancialRow({...rawFinance(),...patch},{period,today,observedAt:at,symbol:'600036.SS'}));
});
test('company identity is checked and website remains untrusted source text',()=>{
 assert.equal(normalizeCompany(rawCompany(),{symbol:'600036.SS',fetchedAt:at}).symbol,'600036.SS');assert.throws(()=>normalizeCompany(rawCompany('000001'),{symbol:'600036.SS',fetchedAt:at}));assert.throws(()=>normalizeCompany({...rawCompany(),SecurityCode:'000001.SZ'},{symbol:'600036.SS',fetchedAt:at}));assert.equal(normalizeCompany(rawCompany(),{symbol:'600036.SS',fetchedAt:at}).website,'javascript:alert(1)');
});
test('one announcement expands all matched securities with exchange verification',()=>{
 const byCode=new Map([['600036','600036.SS'],['000001','000001.SZ']]),r=normalizeAnnouncement(rawNews(),{today,beginDate:'2026-10-30',observedAt:at,byCode});
 assert.deepEqual(r.items.map(x=>x.symbol),['600036.SS','000001.SZ']);assert.equal(r.items[0].bodyRead,false);assert.equal(r.items[0].observedAt,at);assert.equal(r.items[0].displayTime,'2026-11-04 18:00:00');
 const bad=rawNews();bad.codes[0].market_code='0';const wrong=normalizeAnnouncement(bad,{today,beginDate:'2026-10-30',observedAt:at,byCode});assert.equal(wrong.mismatches,1);assert.deepEqual(wrong.items.map(x=>x.symbol),['000001.SZ']);
 for(const patch of [{notice_date:'2026-11-06'},{notice_date:'2026-10-01'},{art_code:'javascript:alert(1)'}])assert.throws(()=>normalizeAnnouncement({...rawNews(),...patch},{today,beginDate:'2026-10-30',observedAt:at,byCode}));
});
test('building keeps the price universe and creates independently timestamped company packets',async()=>{
 const before=JSON.stringify(market),r=await run();assert.equal(JSON.stringify(market),before);assert.equal(r.status.coverage.poolSize,2);assert.equal(r.status.state,'ok');
 for(const s of market.stocks){const b=r.bundles[s.symbol];assert.equal(b.financial.reports.length,2);assert.deepEqual(b.financial.reports.map(x=>x.reportDate),['2026-09-30','2026-06-30']);assert.equal(b.company.state,'ok');assert.equal(b.announcements.items.length,1);assert.equal(b.asOf,at);assert.equal(r.index.symbols[s.symbol].bundleId,b.bundleId);assert.equal(r.index.symbols[s.symbol].path,'data/research/'+s.symbol+'.json')}
 assert.equal(r.index.eventItems.length,2);assert.equal(r.index.eventScope.order,'notice_date_desc_not_recommendation');assert.equal(r.index.priceDataThrough,'2026-11-04');assert.equal(r.status.generatedAt,r.index.generatedAt);
});
test('fresh company cache retains its first observation and avoids new company requests',async()=>{
 const oldAt='2026-11-01T00:00:00.000Z',previousBundles=Object.fromEntries(market.stocks.map(s=>[s.symbol,{symbol:s.symbol,company:normalizeCompany(rawCompany(s.symbol.slice(0,6)),{symbol:s.symbol,fetchedAt:oldAt})}])),trace=[],before=JSON.stringify(previousBundles),r=await run({previousBundles,fetchImpl:fetchFixture({trace})});
 assert.equal(trace.filter(u=>u.hostname==='emweb.securities.eastmoney.com').length,0);assert.equal(r.status.coverage.company.cached,2);assert.equal(r.bundles['600036.SS'].company.fetchedAt,oldAt);assert.equal(r.bundles['600036.SS'].company.observedAt,oldAt);assert.equal(JSON.stringify(previousBundles),before);
});
test('finite financial and announcement pagination is explicit for every security',async()=>{
 const r=await run({fetchImpl:fetchFixture({pages:30,hits:5000})});assert.equal(r.status.coverage.financial.requestedPages,32);assert.ok(r.status.coverage.financial.periods.every(p=>p.truncated));assert.equal(r.status.coverage.announcements.requestedPages,20);assert.equal(r.status.coverage.announcements.truncated,true);
 for(const b of Object.values(r.bundles)){assert.equal(b.financial.state,'partial');assert.equal(b.announcements.state,'partial');assert.equal(b.announcements.scope.complete,false)}assert.equal(r.index.eventItems.length,2);
});
test('no budget means no invented requests or successful empty research',async()=>{
 let calls=0;const r=await run({maxDurationMs:0,fetchImpl:async()=>{calls++;throw Error('must not request')}});
 assert.equal(calls,0);assert.equal(r.status.coverage.company.requested,0);assert.equal(r.status.coverage.company.notRequested,2);assert.equal(r.status.coverage.financial.requestedPages,0);assert.equal(r.status.coverage.announcements.requestedPages,0);assert.equal(r.bundles['600036.SS'].company.state,'not_requested');assert.equal(r.bundles['600036.SS'].announcements.state,'failed');assert.match(r.bundles['600036.SS'].announcements.message,/不等于没有公告/);assert.equal(r.status.state,'failed');
});
test('expired cache is distinct from an actual failed company request',async()=>{
 const oldAt='2026-10-01T00:00:00.000Z',previousBundles={'600036.SS':{symbol:'600036.SS',company:normalizeCompany(rawCompany(),{symbol:'600036.SS',fetchedAt:oldAt})}},unrequested=await run({previousBundles,maxDurationMs:0});
 assert.equal(unrequested.bundles['600036.SS'].company.state,'stale');assert.equal(unrequested.status.coverage.company.stale,1);assert.equal(unrequested.status.coverage.company.notRequested,1);assert.equal(unrequested.status.coverage.company.skipped,2);
 const base=fetchFixture(),r=await run({previousBundles,fetchImpl:async url=>url.includes('CompanySurvey')?{ok:false,status:503}:base(url)});assert.equal(r.bundles['600036.SS'].company.state,'failed');assert.equal(r.bundles['600036.SS'].company.previousFetchedAt,oldAt);assert.equal(r.status.coverage.company.failed,2);assert.equal(r.bundles['600036.SS'].financial.reports.length,2);
});
test('conflicting reports are excluded instead of selecting the better profit',async()=>{
 const r=await run({fetchImpl:fetchFixture({financeTransform:rows=>[...rows,{...rows[0],PARENT_NETPROFIT:999}]})});assert.equal(r.bundles['600036.SS'].financial.reports.length,0);assert.equal(r.bundles['000001.SZ'].financial.reports.length,2);assert.equal(r.status.coverage.financial.conflicts,2);assert.ok(r.status.failures.some(f=>f.code==='conflicting_report'));
});
test('packet cutoff is the end of its own child observations',async()=>{
 let tick=time;const base=fetchFixture(),r=await run({clock:()=>tick,fetchImpl:async url=>{tick+=1000;return base(url)}});
 assert.equal(Date.parse(r.index.asOf),tick);for(const b of Object.values(r.bundles)){assert.equal(Date.parse(b.asOf),tick);assert.ok(Date.parse(b.company.observedAt)<=tick);for(const p of b.financial.reports)assert.ok(Date.parse(p.observedAt)<=tick);for(const a of b.announcements.items)assert.ok(Date.parse(a.observedAt)<=tick)}
});
test('unchanged duplicate pages with different fetch times are not conflicting reports',async()=>{
 let tick=time;const base=fetchFixture({pages:2}),r=await run({clock:()=>tick,fetchImpl:async url=>{tick+=1000;return base(url)}});
 assert.equal(r.status.coverage.financial.conflicts,0);assert.equal(r.bundles['600036.SS'].financial.reports.length,2);
});
test('identity-only company and completely missing financial metrics are insufficient',()=>{
 assert.equal(normalizeCompany({jbzl:{agdm:'600036'}},{symbol:'600036.SS',fetchedAt:at}).state,'insufficient');
 const r=rawFinance();for(const key of ['TOTAL_OPERATE_INCOME','PARENT_NETPROFIT','YSTZ','SJLTZ','WEIGHTAVG_ROE','XSMLL','BASIC_EPS','BPS','MGJYXJJE'])r[key]=null;
 assert.throws(()=>normalizeFinancialRow(r,{period,today,observedAt:at,symbol:'600036.SS'}),/均缺失/);
});

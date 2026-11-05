import test from 'node:test';
import assert from 'node:assert/strict';
import {selectResearchView,safeAnnouncementUrl,safeResearchUrl} from './research-domain.js';
const symbol='600036.SS',now=new Date('2026-11-05T04:00:00Z'),id='AN202611050000000001',url='https://data.eastmoney.com/notices/detail/600036/'+id+'.html';
function bundle(bundleId='bundle-new',date='2026-11-05'){
 const fetchedAt=date+'T02:00:00Z',observedAt=date+'T01:00:00Z';
 return {schema:1,symbol,bundleId,asOf:fetchedAt,fetchedAt,company:{state:'ok',name:'合成公司',industry:null,source:{provider:'synthetic-test',fetchedAt}},financial:{state:'ok',amountUnit:'yuan_source',currency:null,periodBasis:'year_to_date',reports:[{reportDate:'2026-09-30',noticeDate:date,observedAt,metrics:{revenue:0,netProfit:-50,revenueGrowth:null,profitGrowth:-10,roe:0,grossMargin:null,eps:-.2,bps:2,operatingCashPerShare:0},source:{provider:'synthetic-test',url:'https://data.eastmoney.com/bbsj/202609/yjbb.html'}}]},announcements:{state:'ok',items:[{id,title:'合成公告，不是实盘证据',noticeDate:date,observedAt,url,source:{provider:'synthetic-test'}}]}};
}
function record(research=bundle('bundle-old','2026-11-04')){return {id:'synthetic-research-a',symbol,createdAt:'2026-11-04T03:00:00Z',original:{symbol,dataThrough:'2026-11-03',research},events:[]}}
const select=(changes={})=>selectResearchView({symbol,now,...changes});
test('current packet preserves observed availability, negative and missing values without inventing currency',()=>{
 const v=select({latest:bundle()});assert.equal(v.sourceKind,'current');assert.equal(v.state,'ok');assert.equal(v.canAttach,true);assert.equal(v.bundle.financial.currency,null);assert.equal(v.bundle.financial.amountUnit,'yuan_source');
 const r=v.bundle.financial.reports[0];assert.equal(r.metrics.revenue,0);assert.equal(r.metrics.netProfit,-50);assert.equal(r.metrics.revenueGrowth,null);assert.equal(r.availableAt,r.observedAt);assert.equal(r.noticePrecision,'day');assert.equal(r.availabilityBasis,'observed_at');assert.equal(Object.hasOwn(r.metrics,'unknownMetric'),false);
});
test('original view never fills old records with current public data',()=>{
 const r=record();delete r.original.research;const v=select({record:r,latest:bundle()});assert.equal(v.state,'not_saved');assert.equal(v.bundle,null);assert.equal(v.canAttach,false);assert.match(v.label,/当时未保存/);
});
test('original and current views remain separate for independent same-stock records',()=>{
 const a=record(),b=record(bundle('bundle-b','2026-11-04'));b.id='synthetic-research-b';b.original.research.financial.reports[0].metrics.netProfit=-25;
 const latest=bundle(),before=JSON.stringify([a,b,latest]),old=select({record:a,latest}),second=select({record:b,latest}),later=select({record:a,latest,later:true});
 assert.equal(old.sourceKind,'original');assert.equal(old.bundle.bundleId,'bundle-old');assert.equal(old.canAttach,false);assert.equal(second.bundle.financial.reports[0].metrics.netProfit,-25);assert.equal(later.bundle.bundleId,'bundle-new');assert.match(later.label,/尚未留档/);assert.equal(JSON.stringify([a,b,latest]),before);
});
test('date-only disclosure cannot backdate data before it was observed',()=>{
 const latest=bundle();latest.fetchedAt=latest.asOf='2026-11-05T00:00:00Z';latest.company.source.fetchedAt=latest.fetchedAt;
 const v=select({record:{...record(latest),createdAt:'2026-11-05T00:30:00Z'}});assert.equal(v.state,'partial');assert.equal(v.bundle.financial.reports.length,0);assert.equal(v.bundle.announcements.items.length,0);assert.equal(v.excluded.reports,1);assert.equal(v.excluded.announcements,1);
});
test('future disclosure, missing observation and future report periods are excluded',()=>{
 const latest=bundle(),f=latest.financial,a=latest.announcements;
 f.reports.push({...f.reports[0],noticeDate:'2026-11-06'},{...f.reports[0],observedAt:undefined},{...f.reports[0],reportDate:'2026-12-31'});
 a.items.push({...a.items[0],noticeDate:'2026-11-05T05:00:00Z'},{...a.items[0],observedAt:'2026-11-06T01:00:00Z'});
 const v=select({latest});assert.equal(v.excluded.reports,3);assert.equal(v.excluded.announcements,2);assert.equal(v.bundle.financial.reports.length,1);assert.equal(v.bundle.announcements.items.length,1);
});
test('exact disclosure timestamps still need an observation after publication',()=>{
 const latest=bundle(),r=latest.financial.reports[0];r.noticeDate='2026-11-05T00:30:00Z';assert.equal(select({latest}).bundle.financial.reports[0].noticePrecision,'timestamp');r.noticeDate='2026-11-05T01:30:00Z';assert.equal(select({latest}).excluded.reports,1);
});
test('invalid identity and future or malformed packet timestamps cannot be attached',()=>{
 for(const mutate of [b=>{b.symbol='000001.SZ'},b=>{b.bundleId='bad/id'},b=>{b.fetchedAt='2026-11-06T01:00:00Z'},b=>{b.asOf='2026-11-06T01:00:00Z'},b=>{b.fetchedAt='2026-02-30T01:00:00Z'}]){
  const latest=bundle();mutate(latest);const v=select({latest});assert.equal(v.state,'invalid');assert.equal(v.bundle,null);assert.equal(v.canAttach,false);
 }
});
test('company facts fetched after the cutoff are hidden as a whole',()=>{
 const latest=bundle();latest.company.name='未来公司字段';latest.company.source.fetchedAt='2026-11-06T01:00:00Z';
 const v=select({latest});assert.equal(v.excluded.company,1);assert.equal(v.bundle.company.state,'insufficient');assert.equal(v.bundle.company.name,undefined);delete latest.company.source.fetchedAt;assert.equal(select({latest}).bundle.company.name,undefined);
});
test('saved provenance requires an actual earlier stored version',()=>{
 const latest=bundle(),r=record();r.events.push({id:'event-a',at:'2026-11-05T03:00:00Z',snapshot:{symbol,research:latest}});
 assert.equal(select({record:r,latest,later:true}).sourceKind,'current_saved');r.events[0].at='2026-11-06T03:00:00Z';assert.equal(select({record:r,latest,later:true}).sourceKind,'current');
});
test('missing or rejected latest packets fall back to the last valid appended packet',()=>{
 const r=record(),appended=bundle('bundle-appended');r.events=[{at:'2026-11-05T03:00:00Z',snapshot:{symbol,research:appended}},{at:'2026-11-04T04:00:00Z',snapshot:{symbol,research:r.original.research}}];
 const old=select({record:r,later:true});assert.equal(old.sourceKind,'saved_fallback');assert.equal(old.bundle.bundleId,'bundle-appended');assert.equal(old.canAttach,false);
 const bad=bundle();bad.symbol='000001.SZ';const fallback=select({record:r,latest:bad,later:true});assert.equal(fallback.bundle.bundleId,'bundle-appended');assert.equal(fallback.excluded.bundles,1);
});
test('different payload with the same packet identifier cannot masquerade as saved',()=>{
 const r=record(),latest=bundle('bundle-old','2026-11-04');latest.financial.reports[0].metrics.netProfit=999;
 const v=select({record:r,latest,later:true});assert.equal(v.sourceKind,'saved_fallback');assert.equal(v.bundle.financial.reports[0].metrics.netProfit,-50);assert.equal(v.canAttach,false);assert.match(v.reasons.join('；'),/编号存在不同内容/);
});
test('source links accept only exact stock announcement and public financial paths',()=>{
 assert.equal(safeAnnouncementUrl(url,symbol),url);assert.equal(safeResearchUrl('https://data.eastmoney.com/bbsj/202609/yjbb.html',symbol),'https://data.eastmoney.com/bbsj/202609/yjbb.html');
 for(const unsafe of [url.replace('https:','http:'),url+'#https://evil.test',url+'?redirect=evil',url.replace('data.eastmoney.com','data.eastmoney.com.evil.test'),url.replace('data.eastmoney.com','user@data.eastmoney.com'),url.replace('/600036/','/000001/'),url+'\n','javascript:alert(1)','https://data.eastmoney.com/bbsj/202613/yjbb.html'])assert.equal(safeResearchUrl(unsafe,symbol),null);
 const latest=bundle();latest.announcements.items[0].url=url+'#fake';assert.equal(select({latest}).excluded.announcements,1);
});
test('frozen inputs stay untouched and returned metrics are independent',()=>{
 const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v},latest=freeze(bundle()),r=freeze(record()),before=JSON.stringify([r,latest]);
 const v=select({record:r,latest,later:true});v.bundle.financial.reports[0].metrics.netProfit=-999;assert.equal(JSON.stringify([r,latest]),before);assert.equal(latest.financial.reports[0].metrics.netProfit,-50);
});
test('invalid judgment and future original capture fail closed',()=>{
 assert.equal(select({now:new Date('invalid'),latest:bundle()}).state,'invalid');const r=record();r.createdAt='2026-11-06T03:00:00Z';assert.equal(select({record:r}).state,'invalid');assert.equal(select().state,'unavailable');
});
test('a cleaned snapshot can be stored and compared with the original raw packet',()=>{
 const latest=bundle(),clean=select({latest}).bundle,r=record();r.events=[{at:'2026-11-05T03:00:00Z',snapshot:{symbol,research:clean}}];assert.equal(select({record:r,latest,later:true}).sourceKind,'current_saved');
});
test('child observations cannot postdate the packet cutoff even if they precede the current time',()=>{
 const latest=bundle();latest.fetchedAt=latest.asOf='2026-11-05T00:00:00Z';latest.company.source.fetchedAt=latest.fetchedAt;const v=select({latest});assert.equal(v.bundle.financial.reports.length,0);assert.equal(v.bundle.announcements.items.length,0);
});
test('contradictory child security identities are excluded',()=>{
 const latest=bundle();latest.company.symbol='000001.SZ';latest.financial.reports[0].symbol='000001.SZ';latest.announcements.items[0].symbol='000001.SZ';
 const v=select({latest});assert.equal(v.excluded.company,1);assert.equal(v.excluded.reports,1);assert.equal(v.excluded.announcements,1);
});
test('request failure metadata is not mislabeled as a future company fact',()=>{
 const latest=bundle();latest.company={state:'failed',previousFetchedAt:null,message:'HTTP 503'};const v=select({latest});assert.equal(v.bundle.company.state,'failed');assert.equal(v.bundle.company.message,'HTTP 503');
});

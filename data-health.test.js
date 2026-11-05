import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDataHealth} from './data-health.js';
const makeStatus=()=>({failures:[{symbol:'600036.SS',state:'insufficient',code:'invalid_ohlc',message:'日线价格关系异常；成交量缺失；日线价格关系异常'},{symbol:'600036.SS',state:'insufficient',code:'missing_volume',message:'成交量缺失'},{symbol:'000001.SZ',state:'insufficient',code:'missing_volume',message:'成交量缺失'}],sourceFailures:[]});
const makeStocks=()=>[{symbol:'600036.SS',name:'招商银行'},{symbol:'000001.SZ',name:'平安银行'}];
test('reason groups count each stock once and duplicate failures stay one row',()=>{
 const r=buildDataHealth(makeStatus(),makeStocks());assert.equal(r.total,2);assert.equal(r.filtered,2);assert.deepEqual(r.rows.map(x=>x.symbol),['000001.SZ','600036.SS']);
 assert.deepEqual(r.groups,[{key:'成交量缺失',label:'成交量缺失',count:2},{key:'日线价格关系异常',label:'日线价格关系异常',count:1}]);
 assert.equal(r.rows[1].message,'日线价格关系异常；成交量缺失');assert.equal(r.rows[1].name,'招商银行');assert.equal(r.rows[1].canOpen,true);
});
test('name, symbol, error code and reason queries combine with exact reason filter',()=>{
 const run=options=>buildDataHealth(makeStatus(),makeStocks(),options);
 assert.deepEqual(run({query:'600036.ss'}).rows.map(x=>x.symbol),['600036.SS']);assert.equal(run({query:'招商'}).filtered,1);assert.equal(run({query:'价格关系'}).filtered,1);assert.equal(run({query:'MISSING_VOLUME'}).filtered,2);assert.equal(run({reason:'成交量缺失'}).filtered,2);assert.equal(run({reason:'日线价格关系异常'}).filtered,1);
 const none=run({query:'平安',reason:'日线价格关系异常'});assert.equal(none.filtered,0);assert.equal(none.groups[0].count,2);
});
test('stable pagination clamps beyond either end and handles empty result',()=>{
 const failures=[5,4,3,2,1].map(i=>({symbol:String(i).padStart(6,'0')+'.SS',code:'network',message:'请求失败'})),r=buildDataHealth({failures},[],{page:99,pageSize:2});
 assert.equal(r.page,3);assert.equal(r.pages,3);assert.equal(r.total,5);assert.deepEqual(r.rows.map(x=>x.symbol),['000005.SS']);
 const first=buildDataHealth({failures},[],{page:0,pageSize:2});assert.equal(first.page,1);assert.deepEqual(first.rows.map(x=>x.symbol),['000001.SS','000002.SS']);
 const empty=buildDataHealth({failures},[],{query:'NO_MATCH',page:99,pageSize:2});assert.equal(empty.filtered,0);assert.equal(empty.page,1);assert.equal(empty.pages,1);assert.deepEqual(empty.rows,[]);
});
test('unavailable stock details do not hide failures or invent navigation',()=>{
 const r=buildDataHealth({failures:[{symbol:'300750.SZ',state:'insufficient',code:'history_short',message:'历史不足'}]},[]);
 assert.equal(r.total,1);assert.equal(r.rows[0].symbol,'300750.SZ');assert.equal(r.rows[0].name,'300750.SZ');assert.equal(r.rows[0].canOpen,false);assert.equal(r.rows[0].state,'insufficient');assert.deepEqual(r.rows[0].attempts,[]);
});
test('failure attempts take precedence, stock attempts are fallback and duplicates merge once',()=>{
 const one={host:'query1',state:'insufficient',reasons:['价格关系异常']},two={host:'query2',state:'request_failed',code:'http_503'};
 const status={generatedAt:'2026-11-04T16:00:00Z',failures:[{symbol:'000001.SZ',code:'bad',attempts:[one]},{symbol:'600036.SS',code:'bad'},{symbol:'600036.SS',code:'bad',attempts:[one]},{symbol:'300750.SZ',code:'bad',attempts:[]}]},stocks=['000001.SZ','600036.SS','300750.SZ'].map(symbol=>({symbol,generatedAt:status.generatedAt,source:{attempts:[one,two]}})),r=buildDataHealth(status,stocks),bySymbol=new Map(r.rows.map(x=>[x.symbol,x]));
 assert.deepEqual(bySymbol.get('000001.SZ').attempts,[one]);assert.deepEqual(bySymbol.get('600036.SS').attempts,[one,two]);assert.deepEqual(bySymbol.get('300750.SZ').attempts,[]);
});
test('source and unattributed failures stay separate from per-stock counts',()=>{
 const sourceFailures=[{source:'pool_page_1',code:'http_503',message:'股票池分页失败'}],global={code:'build_failed',message:'构建异常'},r=buildDataHealth({failures:[{symbol:'600036.SS',code:'missing_data'},global],sourceFailures},[]);
 assert.equal(r.total,1);assert.equal(r.groups[0].key,'missing_data');assert.equal(r.groups[0].count,1);assert.equal(r.rows[0].state,null);assert.deepEqual(r.sourceFailures,sourceFailures);assert.deepEqual(r.unattributedFailures,[global]);
});
test('frozen inputs remain unchanged and returned audit objects are independent copies',()=>{
 const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
 const status=freeze({coverage:{failed:null},failures:[{symbol:'600036.SS',message:'缺量',attempts:[{host:'query1',reasons:['缺量']}]},{message:'构建异常',detail:{reasons:['未知']}}],sourceFailures:[{source:'pool',detail:{values:['分页失败']}}]}),stocks=freeze([{symbol:'600036.SS',name:'测试样本',source:{attempts:[{host:'query2'}]}}]),before=JSON.stringify([status,stocks]),r=buildDataHealth(status,stocks);
 r.rows[0].attempts[0].reasons.push('输出变化');r.sourceFailures[0].detail.values.push('输出变化');r.unattributedFailures[0].detail.reasons.push('输出变化');assert.equal(JSON.stringify([status,stocks]),before);assert.equal(status.coverage.failed,null);
});
test('missing collections produce an empty list without manufactured stock rows',()=>{
 const r=buildDataHealth(undefined,undefined);assert.equal(r.total,0);assert.equal(r.filtered,0);assert.deepEqual(r.rows,[]);assert.deepEqual(r.groups,[]);assert.deepEqual(r.sourceFailures,[]);assert.deepEqual(r.unattributedFailures,[]);
});

test('old retained market files cannot supply this attempts audit',()=>{
 const stocks=[{symbol:'600036.SS',generatedAt:'2026-11-03T16:00:00Z',source:{attempts:[{host:'old',state:'ok'}]}}];
 const status={generatedAt:'2026-11-04T16:00:00Z',failures:[{symbol:'600036.SS',code:'invalid_ohlc',message:'当前异常'}]};
 assert.deepEqual(buildDataHealth(status,stocks).rows[0].attempts,[]);
 status.failures[0].attempts=[{host:'current',state:'insufficient'}];assert.equal(buildDataHealth(status,stocks).rows[0].attempts[0].host,'current');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {renderResearchPanel} from './research-ui.js';
const symbol='600036.SS',bundle=()=>({schema:1,symbol,bundleId:'synthetic-unit',fetchedAt:'2026-11-04T08:00:00Z',asOf:'2026-11-04T08:00:00Z',company:{state:'ok',name:'合成公司',introduction:'<script>bad()</script>',source:{fetchedAt:'2026-11-04T08:00:00Z'}},financial:{state:'ok',reports:[{reportDate:'2026-09-30',noticeDate:'2026-10-30',observedAt:'2026-11-04T08:00:00Z',currency:null,metrics:{revenue:-123456789,netProfit:0,revenueGrowth:null,profitGrowth:-12.5,roe:0,grossMargin:null,eps:null,bps:2.2,operatingCashPerShare:-1},source:{url:'https://data.eastmoney.com/bbsj/202609/yjbb.html'}}]},announcements:{state:'partial',items:[{id:'AN202610301831242230',title:'<img src=x onerror=bad()>',noticeDate:'2026-10-30',observedAt:'2026-11-04T08:00:00Z',url:'javascript:bad()'}],scope:{complete:false}}});
test('financial presentation preserves losses, zero, missing metrics and percentage units',()=>{
 const html=renderResearchPanel({bundle:bundle(),label:'合成测试',state:'ok'},{symbol});
 assert.match(html,/-1\.23 亿/);assert.match(html,/归母净利润（源单位元）<\/dt><dd>0<\/dd>/);assert.match(html,/-12\.5%/);assert.ok(!html.includes('-1250%'));assert.match(html,/每股收益（源单位元\/股）<\/dt><dd>未取得/);assert.match(html,/年初至报告期末累计/);assert.match(html,/币种未注明/);
});
test('company and announcement content is escaped and unsafe links are never clickable',()=>{
 const html=renderResearchPanel({bundle:bundle(),label:'合成测试'},{symbol});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img '));assert.ok(!html.includes('href="javascript:'));assert.match(html,/&lt;script&gt;/);assert.match(html,/来源链接未核验/);assert.match(html,/尚未读取正文/);
});
test('old records without research data do not claim current financials were known',()=>{
 const html=renderResearchPanel({state:'not_saved',label:'当时未保存公司资料',bundle:null},{symbol});
 assert.match(html,/当时未保存/);assert.ok(!html.includes('归母净利润（源单位元）'));assert.ok(!html.includes('合成公司'));
});
test('only an eligible later-view snapshot exposes append action and a finance view does not mix announcement content',()=>{
 const view={bundle:bundle(),state:'partial',label:'当前未留档',canAttach:true};
 assert.match(renderResearchPanel(view,{symbol,recordId:'r'}),/data-attach-research/);assert.ok(!renderResearchPanel({...view,canAttach:false},{symbol,recordId:'r'}).includes('data-attach-research'));
 const finance=renderResearchPanel(view,{symbol,mode:'financial'});assert.ok(!finance.includes('announcement-item'));assert.match(finance,/年初至报告期末累计/);
});

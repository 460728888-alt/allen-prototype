import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {analyzeVolumeStructure} from '../lib/volume-structure.js';
import {buildVolumeScreenProfile} from '../lib/volume-screen.js';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),prefix='/allen-prototype/',output=path.join(root,'test-results');
fs.mkdirSync(path.join(output,'screens'),{recursive:true});
const frozenStudy=JSON.parse(fs.readFileSync(path.join(root,'data/history-study.json'),'utf8'));
const calendar=JSON.parse(fs.readFileSync(path.join(root,'data/calendar.json'),'utf8')),published=JSON.parse(fs.readFileSync(path.join(root,'data/market.json'),'utf8'));
const completed=calendar.sessions.filter(d=>Date.parse(d+'T15:05:00+08:00')<=Date.now()),through=published.expectedThrough||completed.at(-1);
assert.ok(through&&calendar.sessions.includes(through),'Reviewed current calendar required');
const instant=Date.parse(through+'T16:30:00+08:00'),dates=calendar.sessions.filter(d=>d<=through).slice(-120),generatedAt=new Date(instant-1800000).toISOString();
assert.equal(dates.length,120);
function stock(symbol,name,flat=false){
 const history=dates.map((date,i)=>{const close=flat?100:i<100?100+i*.2:107.5;return {date,open:close,high:close+.2,low:close-.2,close,volume:i>=115?500:1000,complete:true}});
 const structure=analyzeVolumeStructure(history),profile=buildVolumeScreenProfile(history,structure);
 return {symbol,code:symbol.slice(0,6),name,price:history.at(-1).close,changePct:0,currency:'CNY',exchange:symbol.endsWith('.SS')?'SHH':'SHZ',dataThrough:through,data:{state:'ok',dataThrough:through,complete:true,lastBarComplete:true,historyStart:dates[0],corporateActions:[],reasons:[]},levels:structure.levels,structure,profile,history,miniHistory:history.slice(-20),detailPath:'data/stocks/'+symbol+'.json',source:{provider:'synthetic-browser-test',attempts:[{host:'synthetic-primary',requested:true,checkedAt:generatedAt,state:'insufficient',dataThrough:through,reasons:['合成日线价格关系异常']},{host:'synthetic-secondary',requested:true,checkedAt:generatedAt,state:'ok',dataThrough:through,reasons:[]}],usedSecondary:true,independentConfirmation:false},company:{name},financial:{state:'unavailable'},news:{state:'unavailable',items:[]}};
}

function companyFixture(symbol,name,version=1){
 const observedAt=new Date(instant-1800000+version*1000).toISOString(),id='AN202611041234567890';
 return {schema:1,symbol,bundleId:'synthetic-'+symbol+'-'+version,fetchedAt:observedAt,asOf:observedAt,
  company:{state:'ok',symbol,name,fullName:name+'股份有限公司',industry:'合成行业',introduction:'合成公司介绍，非实际公司资料',fetchedAt:observedAt,observedAt,source:{provider:'synthetic-research-test',fetchedAt:observedAt}},
  financial:{state:'ok',reports:[{symbol,reportDate:'2026-09-30',noticeDate:dates.at(-2),updateDate:dates.at(-2),observedAt,currency:null,amountUnit:'source_yuan',periodBasis:'year_to_date',metrics:{revenue:123456789,netProfit:version===1?-120:456,revenueGrowth:0,profitGrowth:-12.5,roe:3,grossMargin:null,eps:.12,bps:2,operatingCashPerShare:-.2},source:{provider:'synthetic-research-test',fetchedAt:observedAt,url:'https://data.eastmoney.com/bbsj/202609/yjbb.html'}}]},
  announcements:{state:'partial',items:[{id,symbol,title:'合成公告版本'+version+' <img src=x onerror=bad()>',noticeDate:dates.at(-2),observedAt,url:'https://data.eastmoney.com/notices/detail/'+symbol.slice(0,6)+'/'+id+'.html',category:'合成测试',bodyRead:false,readState:'index_only'}],scope:{from:dates.at(-5),through,complete:false}}
 };
}

function fixture(mode='active'){
 const list=[stock('600036.SS','合成样本甲',mode==='empty'),stock('000001.SZ','合成样本乙',mode==='empty')],coverage={targetRequested:2,poolSize:2,requested:2,returned:2,usable:2,failed:0,stale:0,insufficient:0,observations:mode==='empty'?0:2,qualified:null,poolSource:'synthetic-test-only',fallback:false,notRequested:0};
 const status={schema:1,state:'ok',attemptedAt:generatedAt,generatedAt,dataThrough:through,expectedThrough:through,coverage,failures:[],sourceFailures:[],message:'合成浏览器验收数据，不是实盘行情'};
 if(mode==='failed'){status.state='failed';Object.assign(coverage,{returned:0,usable:0,failed:2});status.failures=[{symbol:'SYNTHETIC',code:'timeout',message:'合成请求全部失败'}]}
 if(mode==='partial'){status.state='partial';Object.assign(coverage,{returned:1,usable:1,failed:1,observations:1});status.failures=[{symbol:'SYNTHETIC',code:'timeout',message:'合成请求超时'}];list.pop()}
 if(mode==='quality'){
  status.state='partial';Object.assign(coverage,{targetRequested:32,poolSize:32,requested:32,returned:2,usable:1,failed:30,insufficient:1,observations:1});
  Object.assign(list[0].data,{state:'insufficient',complete:false,reasons:['合成日线价格关系异常']});Object.assign(list[0].source.attempts[1],{state:'insufficient',reasons:['合成备用日线仍异常']});
  status.failures=[{symbol:list[0].symbol,state:'insufficient',code:'invalid_ohlc',message:'合成日线价格关系异常'},...Array.from({length:30},(_,i)=>({symbol:String(600100+i)+'.SS',state:'request_failed',code:'timeout',message:'合成请求超时 <img src=x onerror=alert(1)>'}))];
  status.acquisition={httpRequests:64,secondaryRequests:32,recovered:0,skippedRetries:0};
 }
 if(mode==='stale'){const previous=dates.at(-2);status.dataThrough=previous;coverage.stale=2;coverage.usable=0;for(const item of list){item.dataThrough=previous;item.data.dataThrough=previous;item.data.state='stale';item.history.pop();item.price=item.history.at(-1).close}}
 const researchBundles=Object.fromEntries(list.map(item=>[item.symbol,companyFixture(item.symbol,item.name)]));
 const researchIndex={schema:1,generatedAt,symbols:Object.fromEntries(Object.entries(researchBundles).map(([symbol,b])=>[symbol,{path:'data/research/'+symbol+'.json',bundleId:b.bundleId}])),eventItems:Object.values(researchBundles).flatMap(b=>b.announcements.items)};
 const researchStatus={schema:1,state:mode==='research-failed'?'failed':'partial',generatedAt,preservedPrevious:mode==='research-failed',message:'合成研究资料状态，不是实盘信息'};
 return {status,market:{schema:1,dataKind:'synthetic',generatedAt,dataThrough:status.dataThrough,expectedThrough:through,stocks:list},list,researchBundles,researchIndex,researchStatus,delayResearch:null,delayPrice:null};
}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return}
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith(prefix)){res.writeHead(404).end();return}
 const relative=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html',file=path.resolve(root,relative),outside=path.relative(root,file);
 if(outside==='..'||outside.startsWith('..'+path.sep)||path.isAbsolute(outside)){res.writeHead(403).end();return}
 const content=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:content);
}catch{res.writeHead(404).end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true}),results=[];
async function open(width,height,mode='active'){
 const context=await browser.newContext({viewport:{width,height},acceptDownloads:true});
 await context.addInitScript(({instant})=>{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[instant]))}static now(){return instant}}},{instant});
 const page=await context.newPage(),errors=[],remote=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(url.origin!==base||url.pathname.startsWith(prefix+'api/'))remote.push(request.url())});
 if(mode==='training-missing')await page.route('**/training-review.json*',route=>route.fulfill({status:503,json:{error:'synthetic-training-review-outage'}}));
 if(mode==='long-training-missing')await page.route('**/long-training-review.json*',route=>route.fulfill({status:503,json:{error:'synthetic-long-review-outage'}}));
 const f=fixture(mode);await page.route('**/data/**',async route=>{
  const pathname=new URL(route.request().url()).pathname,key=pathname.slice(pathname.indexOf('/data/')+6);
  if(key==='history-study.json'&&mode==='study-missing')return route.fulfill({status:503,json:{error:'synthetic-study-outage'}});
  if(key==='status.json')return route.fulfill({json:f.status});if(key==='market.json')return route.fulfill({json:f.market});
  if(key==='research-index.json')return route.fulfill({json:f.researchIndex});if(key==='research-status.json')return route.fulfill({json:f.researchStatus});
  if(key.startsWith('research/')){const symbol=key.slice(9,-5);if(f.delayResearch===symbol)await new Promise(resolve=>setTimeout(resolve,1600));const b=f.researchBundles[symbol];return b?route.fulfill({json:b}):route.fulfill({status:404,json:{error:'missing research'}})}
  if(key.startsWith('stocks/')){if(f.delayPrice===key.slice(7,-5))await new Promise(resolve=>setTimeout(resolve,1600));const item=f.list.find(s=>s.symbol===key.slice(7,-5));return item?route.fulfill({json:item}):route.fulfill({status:404,json:{error:'missing'}})}
  return route.continue();
 });
 await page.goto(base+prefix,{waitUntil:'networkidle'});await page.locator('#searchInput').waitFor();
 return {context,page,errors,remote,f};
}
async function navigate(page,id){await page.locator('nav [data-page="'+id+'"]').click()}
async function geometry(page){const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+2,JSON.stringify(size))}
async function screenshot(page,name){await page.screenshot({path:path.join(output,'screens',name+'.jpg'),type:'jpeg',quality:76,fullPage:true})}
async function choose(page){if(!await page.locator('[data-stock="600036.SS"]').count())await page.locator('#searchInput').fill('600036');await page.locator('[data-stock="600036.SS"]').first().click();await page.locator('#researchArchive').waitFor();await page.locator('#companyResearch[data-research-version]').waitFor()}
try{
 for(const [width,height]of [[1194,834],[390,844],[1440,900]])for(const mode of ['active','failed','partial','empty','stale']){
  const sample=await open(width,height,mode),{context,page,errors,remote}=sample;
  try{
   const text=await page.locator('#app').innerText();
   if(mode==='failed'){assert.match(text,/无法完成判断/);assert.ok(!/暂无符合.*结构观察/.test(text))}
   if(mode==='stale')assert.match(text,/数据过期|过期/);
   if(mode==='empty')assert.match(text,/暂无.*结构观察|没有.*候选|数据不足/);
   if(mode==='partial'){assert.match(text,/部分|失败|覆盖/);await page.locator('summary').filter({hasText:/失败原因/}).first().click();assert.match(await page.locator('#app').innerText(),/合成请求超时/)}
   await geometry(page);await screenshot(page,'home-'+mode+'-'+width);
   if(mode==='active'){
    await navigate(page,'map');await geometry(page);await screenshot(page,'map-'+width);await navigate(page,'home');await choose(page);await page.locator('svg.price-chart').waitFor();await page.locator('.source-audit summary').click();assert.match(await page.locator('.source-audit').innerText(),/synthetic-primary/);assert.match(await page.locator('.source-audit').innerText(),/不是第二份独立证实/);
    for(const marker of ['pullback','compression','breakout']){await page.locator('button[data-marker="'+marker+'"]').click();const d=page.locator('#evidenceDialog');await d.waitFor({state:'visible'});const text=await d.innerText();assert.match(text,/支持证据/);assert.match(text,/疑点/);assert.match(text,/日期|截止/);assert.match(text,/计算|公式/);await page.keyboard.press('Escape')}
    const originalStage=await page.locator('#researchArchive .archive-grid > section > article:first-child > .pill').innerText();
    await page.locator('[data-save-research]').click();await page.locator('#notice').filter({hasText:/已保存/}).waitFor();
    assert.equal(await page.locator('#researchArchive .archive-grid > section > article:first-child > .pill').innerText(),originalStage);
    const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.equal(before.research.length,1);assert.equal(before.research[0].original.research.symbol,'600036.SS');assert.equal(before.research[0].original.history.length,120);
    await page.locator('#noteText').fill('合成：后来追加的笔记');await page.locator('[data-save-note]').click();await page.locator('#notice').filter({hasText:/已追加/}).waitFor();
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.deepEqual(after.research[0].original,before.research[0].original);assert.ok(!await page.locator('#app').innerText().then(t=>t.includes('合成：后来追加的笔记')));
    await page.locator('[data-time="later"]').click();assert.match(await page.locator('#app').innerText(),/合成：后来追加的笔记/);
    await page.locator('[data-save-research]').click();await page.locator('#notice').filter({hasText:/已保存/}).waitFor();const twice=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.equal(twice.research.length,2);assert.notEqual(twice.research[0].id,twice.research[1].id);
    await geometry(page);await screenshot(page,'research-'+width);await page.reload({waitUntil:'networkidle'});await page.locator('#searchInput').waitFor();await navigate(page,'library');
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.deepEqual(restored.research.map(r=>r.id),twice.research.map(r=>r.id));
    const downloading=page.waitForEvent('download');await page.locator('#exportBackup').click();const dl=await downloading,exportFile=path.join(output,'synthetic-backup-'+width+'.json');await dl.saveAs(exportFile);assert.equal(JSON.parse(fs.readFileSync(exportFile,'utf8')).research.length,2);
    await page.locator('#importBackup').setInputFiles(exportFile);await page.locator('#notice').filter({hasText:/已合并/}).waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')).research.length),2);
    const changed=sample.f.list.find(s=>s.symbol==='600036.SS'),rolling={...changed.levels,stop:changed.price+5,invalidation:changed.price+5};
    changed.levels=rolling;changed.structure={...changed.structure,stage:'结构失效',levels:rolling};changed.profile={...changed.profile,levels:rolling};
    const newer=companyFixture('600036.SS',changed.name,2);sample.f.researchBundles['600036.SS']=newer;sample.f.researchIndex.symbols['600036.SS'].bundleId=newer.bundleId;sample.f.researchIndex.eventItems=newer.announcements.items;
    await navigate(page,'home');await page.locator('[data-refresh]').first().click();await page.locator('#notice').filter({hasText:/已读取/}).waitFor();assert.equal(await page.locator('.review-item').count(),2);assert.match(await page.locator('.review-panel').innerText(),/待设置/);
    const reviewed=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.deepEqual(reviewed.research.map(r=>r.original),twice.research.map(r=>r.original));assert.ok(reviewed.research.every(r=>r.status==='observing'));
    await page.locator('.review-item [data-research-id]').first().click();await page.locator('#researchArchive').waitFor();await page.locator('[data-time="later"]').click();assert.match(await page.locator('#researchArchive .archive-grid > section > article:first-child > .pill').innerText(),/原结构继续跟踪/);
    await page.locator('#companyResearch[data-research-version]').waitFor();assert.match(await page.locator('#companyResearch').innerText(),/合成公告版本2/);assert.equal(await page.locator('#companyResearch img').count(),0);
    await page.locator('[data-attach-research]').click();await page.locator('#notice').filter({hasText:/资料已追加|资料快照已追加/}).waitFor();
    const attached=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.deepEqual(attached.research.map(r=>r.original),twice.research.map(r=>r.original));assert.ok(attached.research.some(r=>r.events.some(e=>e.snapshot?.research?.bundleId==='synthetic-600036.SS-2')));
    await page.locator('[data-time="original"]').click();assert.match(await page.locator('#companyResearch').innerText(),/合成公告版本1/);assert.ok(!(await page.locator('#companyResearch').innerText()).includes('合成公告版本2'));await geometry(page);await screenshot(page,'company-research-'+width);

    await navigate(page,'validation');await geometry(page);assert.match(await page.locator('#app').innerText(),/事后重建|未验证|未证明/);await page.locator('#studyComparison').waitFor();await page.locator('#trainingReview[data-state="research-only"]').waitFor();await page.locator('#longTrainingReview[data-state="research-only"]').waitFor();assert.equal(await page.locator('[data-long-core]').count(),9);assert.equal(await page.locator('[data-long-expanded]').count(),3);await page.locator('#longQuarters > summary').click();assert.equal(await page.locator('#longQuarters tbody tr').count(),48);assert.match(await page.locator('#longQuarters').innerText(),/Q4/);await geometry(page);await page.locator('#longQuarters > summary').click();assert.match(await page.locator('#longTrainingReview').innerText(),/-21.59%/);assert.equal(await page.locator('[data-training-model]').count(),3);assert.match(await page.locator('#trainingReview').innerText(),/暂不启用|开发验证/);assert.match(await page.locator('#trainingReview').innerText(),/不能解读为今天没有机会/);
    const studyGroup=frozenStudy.groups.find(g=>g.id==='legacy_observation'),getCost=(g,cost)=>String(g.hypotheticalCostScenarios.find(s=>s.roundTripBps===cost).dailyEqualWeightMeanAssumedReturn);
    assert.equal(await page.locator('.study-assumed').getAttribute('data-value'),getCost(studyGroup,30));
    const sampleDifference=await page.locator('.study-sample').getAttribute('data-value'),quarters=await page.locator('.study-quarter-grid').innerText(),order=await page.locator('[data-study-row]').evaluateAll(nodes=>nodes.map(n=>n.dataset.studyRow));
    await page.locator('#studyCost').selectOption('60');assert.equal(await page.locator('.study-assumed').getAttribute('data-value'),getCost(studyGroup,60));assert.equal(await page.locator('.study-sample').getAttribute('data-value'),sampleDifference);assert.equal(await page.locator('.study-quarter-grid').innerText(),quarters);assert.deepEqual(await page.locator('[data-study-row]').evaluateAll(nodes=>nodes.map(n=>n.dataset.studyRow)),order);
    await page.locator('#studyGroup').selectOption('legacy_with_prior_trend');const prior=frozenStudy.groups.find(g=>g.id==='legacy_with_prior_trend');assert.equal(await page.locator('.study-assumed').getAttribute('data-value'),getCost(prior,60));assert.ok(Number(await page.locator('.study-assumed').getAttribute('data-value'))<0);assert.match(await page.locator('.study-counterexample').innerText(),/正变化比例/);
    const studyDownload=page.waitForEvent('download');await page.locator('[data-download-study]').click();const studyFile=path.join(output,'frozen-study-'+width+'.json');await (await studyDownload).saveAs(studyFile);assert.deepEqual(JSON.parse(fs.readFileSync(studyFile,'utf8')),frozenStudy);assert.match(await page.locator('.study-audit').innerText(),/原逐日样本|不能宣称已完整复现/);assert.match(await page.locator('.benchmark-card').innerText(),/Zacks Rank/);await geometry(page);await screenshot(page,'validation-'+width);
   }
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);results.push({width,height,mode,passed:true});
  }finally{await context.close()}
 }

 for(const [width,height]of [[1194,834],[390,844],[1440,900]]){
  const sample=await open(width,height,'quality'),{context,page,errors,remote}=sample;
  try{
   await page.locator('[data-tool="health"]').first().click();await page.locator('#dataHealth').waitFor();assert.equal(await page.locator('.health-item').count(),25);
   await page.locator('[data-health-page="2"]').click();assert.equal(await page.locator('.health-item').count(),6);
   await page.locator('#healthReason').selectOption('合成日线价格关系异常');assert.equal(await page.locator('.health-item').count(),1);assert.match(await page.locator('#healthResults').innerText(),/600036.SS/);
   await page.locator('#healthReason').selectOption('');await page.locator('#healthSearch').fill('600100');assert.equal(await page.locator('.health-item').count(),1);assert.equal(await page.locator('.health-item [data-stock]').count(),0);assert.equal(await page.locator('#dataHealth img').count(),0);assert.match(await page.locator('.health-item').innerText(),/不能打开虚构档案/);
   await page.locator('#healthSearch').fill('合成样本甲');assert.equal(await page.locator('.health-item').count(),1);await page.locator('.health-item [data-stock]').click();await page.locator('#researchArchive').waitFor();assert.equal(await page.locator('[data-save-research]').isDisabled(),true);
   await page.locator('.source-audit summary').click();assert.match(await page.locator('.source-audit').innerText(),/获取过程|原数据校验|合成/);await geometry(page);await screenshot(page,'data-health-'+width);
   await navigate(page,'home');await page.locator('[data-tool="health"]').first().click();await page.locator('#healthSearch').fill('');await page.locator('#healthReason').selectOption('合成日线价格关系异常');
   sample.f.status.failures=sample.f.status.failures.filter(f=>f.symbol!=='600036.SS');Object.assign(sample.f.list[0].data,{state:'ok',complete:true,reasons:[]});Object.assign(sample.f.status.coverage,{usable:2,insufficient:0});
   await navigate(page,'home');await page.locator('[data-refresh]').first().click();await page.locator('#notice').filter({hasText:/已读取/}).waitFor();await page.locator('[data-tool="health"]').first().click();assert.equal(await page.locator('#healthReason').inputValue(),'');assert.equal(await page.locator('.health-item').count(),25);
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);results.push({case:'data-health',width,height,passed:true});
  }finally{await context.close()}
 }

 const broken=await open(1194,834);try{
  const before=await broken.page.evaluate(()=>localStorage.getItem('allen.personal.v1'));await broken.page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('synthetic quota failure')}});
  await choose(broken.page);await broken.page.locator('[data-save-research]').click();await broken.page.locator('#notice').filter({hasText:/保存失败|未保存|无法保存/}).waitFor();assert.equal(await broken.page.evaluate(()=>localStorage.getItem('allen.personal.v1')),before);assert.deepEqual(broken.errors,[]);results.push({case:'storage-failure',passed:true});
 }finally{await broken.context.close()}
 const nextThrough=calendar.sessions[calendar.sessions.indexOf(through)+1];assert.ok(nextThrough);const nextInstant=Date.parse(nextThrough+'T16:30:00+08:00');
 for(const focusEvent of [true,false]){
  const sample=await open(1194,834);try{
   await choose(sample.page);const before=await sample.page.evaluate(()=>localStorage.getItem('allen.personal.v1'));
   await sample.page.evaluate(({instant,focusEvent})=>{const PreviousDate=Date;globalThis.Date=class extends PreviousDate{constructor(...args){super(...(args.length?args:[instant]))}static now(){return instant}};if(focusEvent)window.dispatchEvent(new Event('focus'))},{instant:nextInstant,focusEvent});
   if(focusEvent){await sample.page.waitForFunction(()=>document.querySelector('[data-save-research]')?.disabled===true);await navigate(sample.page,'home');assert.match(await sample.page.locator('#app').innerText(),/数据过期|行情过期/)}
   else {await sample.page.evaluate(()=>document.querySelector('[data-save-research]').click());await sample.page.locator('#notice').filter({hasText:/过期|不可判断|未保存|暂停/}).waitFor()}
   assert.equal(await sample.page.evaluate(()=>localStorage.getItem('allen.personal.v1')),before);assert.deepEqual(sample.errors,[]);assert.deepEqual(sample.remote,[]);results.push({case:focusEvent?'overnight-focus':'overnight-save-guard',passed:true});
  }finally{await sample.context.close()}
 }

 for(const [width,height]of [[1194,834],[390,844],[1440,900]]){
  const sample=await open(width,height,'research-failed'),{page,context}=sample;
  try{
   await page.locator('[data-stock="600036.SS"]').first().click();await page.locator('#researchArchive').waitFor();await page.locator('[data-save-research]').waitFor({state:'visible'});await page.locator('[data-save-research]').click();await page.locator('#notice').filter({hasText:/财报公告未取得/}).waitFor();
   const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.equal(data.research.length,1);assert.equal(Object.hasOwn(data.research[0].original,'research'),false);assert.equal(data.research[0].original.data.state,'ok');await geometry(page);assert.deepEqual(sample.errors,[]);assert.deepEqual(sample.remote,[]);results.push({case:'research-failed-price-preserved',width,height,passed:true});
  }finally{await context.close()}
 }
 const race=await open(1194,834);try{
  race.f.delayResearch='600036.SS';await race.page.locator('[data-stock="600036.SS"]').first().click();await race.page.locator('#researchArchive').waitFor();
  await navigate(race.page,'home');await race.page.locator('#searchInput').fill('000001');await race.page.locator('[data-stock="000001.SZ"]').first().click();await race.page.locator('#companyResearch[data-research-version="synthetic-000001.SZ-1"]').waitFor();await race.page.waitForTimeout(1800);
  assert.match(await race.page.locator('#researchArchive h1').innerText(),/000001.SZ/);assert.equal(await race.page.locator('#companyResearch').getAttribute('data-research-version'),'synthetic-000001.SZ-1');assert.deepEqual(race.errors,[]);assert.deepEqual(race.remote,[]);results.push({case:'research-selection-race',passed:true});
 }finally{await race.context.close()}
 const incomplete=await open(1194,834);try{
  incomplete.f.delayPrice='600036.SS';await incomplete.page.locator('[data-stock="600036.SS"]').first().click();await incomplete.page.locator('#companyResearch[data-research-version]').waitFor();assert.equal(await incomplete.page.locator('[data-save-research]').isDisabled(),true);
  await incomplete.page.evaluate(()=>document.querySelector('[data-save-research]').dispatchEvent(new MouseEvent('click',{bubbles:true})));await incomplete.page.locator('#notice').filter({hasText:/未完整加载|不可判断/}).waitFor();assert.equal(await incomplete.page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')||'{"research":[]}').research.length),0);
  await incomplete.page.locator('[data-save-research]').click();await incomplete.page.locator('#notice').filter({hasText:/已保存/}).waitFor();assert.equal(await incomplete.page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')).research[0].original.history.length),120);assert.deepEqual(incomplete.errors,[]);results.push({case:'complete-snapshot-before-save',passed:true});
 }finally{await incomplete.context.close()}


 for(const [width,height]of [[1194,834],[390,844],[1440,900]]){
  const sample=await open(width,height,'study-missing');try{
   await navigate(sample.page,'validation');assert.match(await sample.page.locator('#studyComparison').innerText(),/暂不可比较|未取得|缺少/);assert.equal(await sample.page.locator('.study-assumed').count(),0);assert.equal(await sample.page.locator('[data-download-study]').count(),0);await geometry(sample.page);assert.deepEqual(sample.errors,[]);assert.deepEqual(sample.remote,[]);results.push({case:'study-missing-no-results',width,height,passed:true});
  }finally{await sample.context.close()}
 }

 for(const [width,height]of [[1194,834],[390,844],[1440,900]]){
  const sample=await open(width,height,'training-missing');try{
   await navigate(sample.page,'validation');await sample.page.locator('#trainingReview[data-state="unavailable"]').waitFor();
   assert.match(await sample.page.locator('#trainingReview').innerText(),/不能显示为没有机会或零收益/);
   assert.equal(await sample.page.locator('[data-training-model]').count(),0);await sample.page.locator('#studyComparison').waitFor();
   await geometry(sample.page);assert.deepEqual(sample.errors,[]);assert.deepEqual(sample.remote,[]);
   results.push({case:'training-review-missing-no-zero',width,height,passed:true});
  }finally{await sample.context.close()}
 }
 for(const [width,height]of [[1194,834],[390,844],[1440,900]]){
  const sample=await open(width,height,'long-training-missing');try{
   await navigate(sample.page,'validation');await sample.page.locator('#longTrainingReview[data-state="unavailable"]').waitFor();
   assert.match(await sample.page.locator('#longTrainingReview').innerText(),/不能显示成零收益或没有机会/);
   assert.equal(await sample.page.locator('[data-long-core]').count(),0);await sample.page.locator('#trainingReview[data-state="research-only"]').waitFor();
   await geometry(sample.page);assert.deepEqual(sample.errors,[]);assert.deepEqual(sample.remote,[]);
   results.push({case:'long-review-missing-no-false-zero',width,height,passed:true});
  }finally{await sample.context.close()}
 }
 const actual=await browser.newContext({viewport:{width:1194,height:834}});try{
  const page=await actual.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+prefix,{waitUntil:'networkidle'});await page.locator('#searchInput').waitFor();await geometry(page);
  const file=path.join(output,'screens','real-published-home.jpg');await page.screenshot({path:file,type:'jpeg',quality:72,fullPage:true});assert.deepEqual(errors,[]);console.log('PERSONAL_PREVIEW_IMAGE home '+fs.readFileSync(file).toString('base64'));results.push({case:'real-data-smoke',passed:true});
 }finally{await actual.close()}
 console.log('PERSONAL_BROWSER_RESULTS '+JSON.stringify(results));
}finally{fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}

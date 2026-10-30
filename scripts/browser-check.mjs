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
const calendar=JSON.parse(fs.readFileSync(path.join(root,'data/calendar.json'),'utf8')),published=JSON.parse(fs.readFileSync(path.join(root,'data/market.json'),'utf8'));
const completed=calendar.sessions.filter(d=>Date.parse(d+'T15:05:00+08:00')<=Date.now()),through=published.expectedThrough||completed.at(-1);
assert.ok(through&&calendar.sessions.includes(through),'Reviewed current calendar required');
const instant=Date.parse(through+'T16:30:00+08:00'),dates=calendar.sessions.filter(d=>d<=through).slice(-120),generatedAt=new Date(instant-1800000).toISOString();
assert.equal(dates.length,120);
function stock(symbol,name,flat=false){
 const history=dates.map((date,i)=>{const close=flat?100:i<100?100+i*.2:107.5;return {date,open:close,high:close+.2,low:close-.2,close,volume:i>=115?500:1000,complete:true}});
 const structure=analyzeVolumeStructure(history),profile=buildVolumeScreenProfile(history,structure);
 return {symbol,code:symbol.slice(0,6),name,price:history.at(-1).close,changePct:0,currency:'CNY',exchange:symbol.endsWith('.SS')?'SHH':'SHZ',dataThrough:through,data:{state:'ok',dataThrough:through,complete:true,lastBarComplete:true,historyStart:dates[0],corporateActions:[],reasons:[]},levels:structure.levels,structure,profile,history,miniHistory:history.slice(-20),detailPath:'data/stocks/'+symbol+'.json',source:{provider:'synthetic-browser-test'},company:{name},financial:{state:'unavailable'},news:{state:'unavailable',items:[]}};
}
function fixture(mode='active'){
 const list=[stock('600036.SS','合成样本甲',mode==='empty'),stock('000001.SZ','合成样本乙',mode==='empty')],coverage={targetRequested:2,poolSize:2,requested:2,returned:2,usable:2,failed:0,stale:0,insufficient:0,observations:mode==='empty'?0:2,qualified:null,poolSource:'synthetic-test-only',fallback:false,notRequested:0};
 const status={schema:1,state:'ok',attemptedAt:generatedAt,generatedAt,dataThrough:through,expectedThrough:through,coverage,failures:[],sourceFailures:[],message:'合成浏览器验收数据，不是实盘行情'};
 if(mode==='failed'){status.state='failed';Object.assign(coverage,{returned:0,usable:0,failed:2});status.failures=[{symbol:'SYNTHETIC',code:'timeout',message:'合成请求全部失败'}]}
 if(mode==='partial'){status.state='partial';Object.assign(coverage,{returned:1,usable:1,failed:1,observations:1});status.failures=[{symbol:'SYNTHETIC',code:'timeout',message:'合成请求超时'}];list.pop()}
 if(mode==='stale'){const previous=dates.at(-2);status.dataThrough=previous;coverage.stale=2;coverage.usable=0;for(const item of list){item.dataThrough=previous;item.data.dataThrough=previous;item.data.state='stale';item.history.pop();item.price=item.history.at(-1).close}}
 return {status,market:{schema:1,dataKind:'synthetic',generatedAt,dataThrough:status.dataThrough,expectedThrough:through,stocks:list},list};
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
 const f=fixture(mode);await page.route('**/data/**',route=>{
  const pathname=new URL(route.request().url()).pathname,key=pathname.slice(pathname.indexOf('/data/')+6);
  if(key==='status.json')return route.fulfill({json:f.status});if(key==='market.json')return route.fulfill({json:f.market});
  if(key.startsWith('stocks/')){const item=f.list.find(s=>s.symbol===key.slice(7,-5));return item?route.fulfill({json:item}):route.fulfill({status:404,json:{error:'missing'}})}
  return route.continue();
 });
 await page.goto(base+prefix,{waitUntil:'networkidle'});await page.locator('#searchInput').waitFor();
 return {context,page,errors,remote,f};
}
async function navigate(page,id){await page.locator('nav [data-page="'+id+'"]').click()}
async function geometry(page){const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+2,JSON.stringify(size))}
async function screenshot(page,name){await page.screenshot({path:path.join(output,'screens',name+'.jpg'),type:'jpeg',quality:76,fullPage:true})}
async function choose(page){if(!await page.locator('[data-stock="600036.SS"]').count())await page.locator('#searchInput').fill('600036');await page.locator('[data-stock="600036.SS"]').first().click();await page.locator('#researchArchive').waitFor()}
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
    await navigate(page,'map');await geometry(page);await screenshot(page,'map-'+width);await navigate(page,'home');await choose(page);await page.locator('svg.price-chart').waitFor();
    for(const marker of ['pullback','compression','breakout']){await page.locator('button[data-marker="'+marker+'"]').click();const d=page.locator('#evidenceDialog');await d.waitFor({state:'visible'});const text=await d.innerText();assert.match(text,/支持证据/);assert.match(text,/疑点/);assert.match(text,/日期|截止/);assert.match(text,/计算|公式/);await page.keyboard.press('Escape')}
    await page.locator('[data-save-research]').click();await page.locator('#notice').filter({hasText:/已保存/}).waitFor();
    const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.equal(before.research.length,1);
    await page.locator('#noteText').fill('合成：后来追加的笔记');await page.locator('[data-save-note]').click();await page.locator('#notice').filter({hasText:/已追加/}).waitFor();
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.deepEqual(after.research[0].original,before.research[0].original);assert.ok(!await page.locator('#app').innerText().then(t=>t.includes('合成：后来追加的笔记')));
    await page.locator('[data-time="later"]').click();assert.match(await page.locator('#app').innerText(),/合成：后来追加的笔记/);
    await page.locator('[data-save-research]').click();await page.locator('#notice').filter({hasText:/已保存/}).waitFor();const twice=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.equal(twice.research.length,2);assert.notEqual(twice.research[0].id,twice.research[1].id);
    await geometry(page);await screenshot(page,'research-'+width);await page.reload({waitUntil:'networkidle'});await page.locator('#searchInput').waitFor();await navigate(page,'library');
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')));assert.deepEqual(restored.research.map(r=>r.id),twice.research.map(r=>r.id));
    const downloading=page.waitForEvent('download');await page.locator('#exportBackup').click();const dl=await downloading,exportFile=path.join(output,'synthetic-backup-'+width+'.json');await dl.saveAs(exportFile);assert.equal(JSON.parse(fs.readFileSync(exportFile,'utf8')).research.length,2);
    await page.locator('#importBackup').setInputFiles(exportFile);await page.locator('#notice').filter({hasText:/已合并/}).waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('allen.personal.v1')).research.length),2);
    await navigate(page,'validation');await geometry(page);assert.match(await page.locator('#app').innerText(),/事后重建|未验证|未证明/);await screenshot(page,'validation-'+width);
   }
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);results.push({width,height,mode,passed:true});
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
 const actual=await browser.newContext({viewport:{width:1194,height:834}});try{
  const page=await actual.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+prefix,{waitUntil:'networkidle'});await page.locator('#searchInput').waitFor();await geometry(page);
  const file=path.join(output,'screens','real-published-home.jpg');await page.screenshot({path:file,type:'jpeg',quality:72,fullPage:true});assert.deepEqual(errors,[]);console.log('PERSONAL_PREVIEW_IMAGE home '+fs.readFileSync(file).toString('base64'));results.push({case:'real-data-smoke',passed:true});
 }finally{await actual.close()}
 console.log('PERSONAL_BROWSER_RESULTS '+JSON.stringify(results));
}finally{fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));await browser.close();await new Promise(resolve=>server.close(resolve))}

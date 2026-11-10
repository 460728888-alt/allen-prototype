import {renderLongReview} from './long-training-review.js';
import {renderTrainingReview} from './training-review.js';
import {createPersonalStore} from './personal-store.js';
import {assessData,stockQuality,isObservation,stageOf,explain,selectFocus} from './personal-domain.js';
import {buildReviewQueue} from './research-review.js';
import {buildDataHealth} from './data-health.js';
import {selectResearchView,safeResearchUrl} from './research-domain.js';
import {renderResearchPanel} from './research-ui.js';
import {buildStudyView} from './study-compare.js';
import {renderStudyPanel,renderBenchmarkCard} from './study-panel.js';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=x=>typeof x==='number'&&Number.isFinite(x),fmt=x=>finite(x)?x.toFixed(2):'未核验',pct=x=>finite(x)?(x*100).toFixed(2)+'%':'未核验',n=x=>Number.isInteger(x)?String(x):'未核验';
const state={page:'home',stock:null,recordId:null,later:false,detail:null,cache:new Map(),researchCache:new Map(),researchCurrent:null,researchIndex:null,researchStatus:null,researchLoading:false,researchError:null,market:{stocks:[]},status:null,calendar:null,assessment:null,study:null,studyAudit:null,trainingReview:null,longReview:null,studyCostBps:30,studyGroup:'legacy_observation',search:'',healthQuery:'',healthReason:'',healthPage:1,tool:'all',epoch:0,selection:0,saved:{watchlist:[],research:[],notes:[],portfolio:[],riskBudget:null},storeError:null};
let local;
const button=(text,attrs='',cls='')=>'<button class="'+cls+'" '+attrs+'>'+esc(text)+'</button>';
const bySymbol=symbol=>state.market.stocks.find(s=>s.symbol===symbol)||null;
const record=()=>state.saved.research.find(r=>r.id===state.recordId)||null;
const norm=s=>s?{...s,dataThrough:s.dataThrough||s.data?.dataThrough||null}:null;
const quality=s=>stockQuality(norm(s),state.assessment);
const title=(k,t,p='')=>'<div class="section-head"><div><div class="eyebrow">'+esc(k)+'</div><h2>'+esc(t)+'</h2></div><small>'+esc(p)+'</small></div>';
const empty=(t,p)=>'<section class="empty"><h3>'+esc(t)+'</h3><p>'+esc(p)+'</p></section>';
const source=s=>typeof s?.source==='string'?s.source:s?.source?.provider||'公开历史日线';
function notice(text,error=false){$('#notice').textContent=text;$('#notice').hidden=false;$('#notice').classList.toggle('error',error)}
function saved(){try{state.saved=local.read();state.storeError=null}catch(error){state.storeError=error.message}}
async function readJSON(path){const url=new URL(path,document.baseURI);if(url.origin!==location.origin)throw Error('只读取本站已发布文件');const response=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(path+' HTTP '+response.status);return response.json()}


function researchCoverage(newsOnly=false){
 const status=state.researchStatus,c=status?.coverage;
 if(!c)return '<p class="muted">本次公司与公告覆盖统计未取得，不能据此判断没有资料。</p>';
 const company=c.company||{},f=c.financial||{},a=c.announcements||{},groups=new Map();
 for(const v of Array.isArray(status.failures)?status.failures:[]){const key=(v.source||'资料')+' · '+(v.code||'未核验')+' · '+(v.message||'原因未保存');groups.set(key,(groups.get(key)||0)+1)}
 return '<details class="research-coverage"><summary>本批资料覆盖范围与失败原因</summary><p class="muted">生成 '+esc(status.generatedAt||status.fetchedAt||'未知')+'；资料池 '+n(c.poolSize)+' 只，不代表全市场。公司请求优先原网站已有公开样本，属于资料获取顺序，不是机会排名。</p>'+
 (!newsOnly?'<p class="muted">公司：新取得 '+n(company.ok)+' · 7日内缓存 '+n(company.cached)+' · 获取或校验失败 '+n(company.failed)+' · 不足 '+n(company.insufficient)+' · 过期 '+n(company.stale)+' · 未请求 '+n(company.notRequested)+'</p><p class="muted">财报：至少一期 '+n(f.withReports)+' 只 · 未取得 '+n(f.withoutReports)+' 只；读取 '+n(f.returnedPages)+' / 请求 '+n(f.requestedPages)+' 页，每报告期最多16页。</p>':'')+
 '<p class="muted">公告：'+esc(a.beginDate||'范围未知')+' 至 '+esc(a.endDate||'范围未知')+' · 已读 '+n(a.returnedPages)+' / 来源总页数 '+n(a.totalPages)+'，上限20页；'+esc(a.complete===true?'来源返回范围已读，仍未核验正文。':'范围未完整覆盖，未匹配不代表没有公告。')+'本批列表最多展示60条匹配记录。</p>'+
 [...groups].slice(0,15).map(([text,count])=>'<p class="muted">'+esc(text)+' · '+n(count)+' 条诊断记录</p>').join('')+'</details>';
}

function currentResearch(){
 const b=state.researchCurrent;
 if(!b||state.researchError||state.researchStatus?.preservedPrevious===true||!state.researchStatus||!['ok','partial'].includes(state.researchStatus.state))return null;
 const age=Date.now()-Date.parse(b.fetchedAt);
 return Number.isFinite(age)&&age>=0&&age<=7*86400000?b:null;
}
function researchView(){
 return selectResearchView({record:record(),latest:currentResearch(),later:state.later,now:new Date(),symbol:state.stock});
}
function companyPanel(mode='all'){
 const r=record(),view=researchView(),historical=!!r&&!state.later;
 return renderResearchPanel(view,{symbol:state.stock,loading:!historical&&state.researchLoading,error:historical?null:state.researchError,mode,recordId:r?.id||null})+(historical?'':researchCoverage());
}
function eventRadar(limit=5){
 const index=state.researchIndex,status=state.researchStatus,today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const items=(Array.isArray(index?.eventItems)?index.eventItems:[]).filter(i=>bySymbol(i.symbol)&&typeof i.noticeDate==='string'&&i.noticeDate<=today&&Number.isFinite(Date.parse(i.observedAt))&&Date.parse(i.observedAt)<=Date.now()&&safeResearchUrl(i.url||i.link,i.symbol)).slice(0,limit);
 const age=Date.now()-Date.parse(index?.generatedAt||'');
 const unavailable=!index||!Number.isFinite(age)||age<0||age>7*86400000||!status||!['ok','partial'].includes(status.state);
 return '<section class="card event-radar"><div class="eyebrow">INDEPENDENT CHANNEL / ANNOUNCEMENT INDEX</div><h2>公告线索 · 先核验正文</h2><p class="muted">按公告日期展示，不是利好排名。事件不等于价格确认，标题不代替正文。</p>'+
 (unavailable?'<p class="warning">本次公告资料未能完成获取，不能解释为没有公告。行情研究独立保留。</p>':items.length?items.map(i=>{const s=bySymbol(i.symbol);return '<article class="event"><span class="pill">公告待核验</span><h3>'+esc(s?.name||i.symbol)+'</h3><p>'+esc(i.title)+'</p><small>公告日期 '+esc(i.noticeDate)+' · '+esc(i.category||'分类未提供')+'<br>价格阶段独立核查：'+esc(stageOf(s,state.assessment).label)+'</small><div class="row">'+button('连到价格与公司档案','data-stock="'+esc(i.symbol)+'"','link')+'<a href="'+esc(safeResearchUrl(i.url||i.link,i.symbol))+'" target="_blank" rel="noopener noreferrer">核对公告来源 ↗</a></div></article>'}).join(''):'<p class="muted">已读取范围暂未匹配可展示的公告，不表示这些公司没有公告。</p>')+
 '<p class="muted">本批生成 '+esc(index?.generatedAt||'未取得')+'，不是实时公告服务。只覆盖当前公开价格名单及本次有限分页范围；来源和抓取时间见个股资料。公告正文未自动解读。</p>'+button(limit<20?'查看本批公告线索列表':'查看全部研究工具','data-tool="'+(limit<20?'events':'all')+'"','link')+researchCoverage(true)+'</section>';
}
function renderKeepingNote(){
 const draft=$('#noteText')?.value;
 render();
 if(typeof draft==='string'&&$('#noteText'))$('#noteText').value=draft;
}
async function researchDetail(s){
 const entry=state.researchIndex?.symbols?.[s.symbol];
 if(!entry)throw Error('本次资料未覆盖这只股票；价格研究仍可用。');
 const expected='data/research/'+s.symbol+'.json';
 if(entry.path!==expected||typeof entry.bundleId!=='string')throw Error('资料索引路径或版本未核验。');
 const key=s.symbol+'|'+entry.bundleId;
 if(state.researchCache.has(key))return state.researchCache.get(key);
 const data=await readJSON(expected);
 if(data?.schema!==1||data.symbol!==s.symbol||data.bundleId!==entry.bundleId)throw Error('公司资料与索引版本不一致，暂停混用。');
 const verified=selectResearchView({latest:data,symbol:s.symbol,now:new Date()});
 if(!verified.bundle)throw Error(verified.label||'资料时间或证券代码未核验。');
 state.researchCache.set(key,data);return data;
}

function fetchAudit(s){
 const audit=typeof s?.source==='object'&&s.source?s.source:{},attempts=Array.isArray(audit.attempts)?audit.attempts.filter(a=>a&&typeof a==='object'):[];
 return '<details class="source-audit"><summary>查看本次行情获取过程</summary><p class="muted">备用通道仍来自同一提供方，不是第二份独立证实；只有通过原校验的完整日线才参与判断，不拼接或修正矛盾价格。</p>'+
 (attempts.length?attempts.map((a,i)=>'<div class="event"><b>'+esc((i+1)+' · '+a.host)+'</b> <span class="pill">'+esc(a.state==='ok'?'通过原数据校验':a.state==='stale'?'数据过期':a.state==='insufficient'?'数据不足或异常':'获取失败')+'</span><p>'+esc(a.checkedAt||'获取时间未保存')+' · 截止 '+esc(a.dataThrough||'未取得')+'</p><p>'+esc((Array.isArray(a.reasons)?a.reasons:[]).join('；')||a.message||(a.state==='ok'?'可供结构研究，不代表机会成立。':'原因未保存'))+'</p>'+(a.requested===false?'<small>预算限制，未实际发出请求。</small>':'')+'</div>').join(''):'<p class="muted">此快照未保存逐次获取过程，不事后补造。</p>')+
 (audit.retrySkipped?'<p class="warning">本次预算用尽，未发出后续备用请求。</p>':'')+'</details>';
}
function reviewPanel(limit=4){
 const q=buildReviewQueue(state.saved.research,state.market.stocks,state.assessment),labels={invalidated:'原结构已失效',paused:'暂停复核',price_condition:'价格条件触及·待复核',waiting:'继续等待'};
 return '<section class="card compact review-panel"><div class="eyebrow">MY FOLLOW-UP / REVIEW FIRST</div><h2>我的待复核清单</h2><p class="muted">'+Object.entries(labels).map(([key,label])=>label+' '+n(q.counts[key])).join(' · ')+'</p>'+
 (q.items.length?q.items.slice(0,limit).map(r=>'<article class="event review-item" data-review-group="'+esc(r.group)+'"><span class="pill '+(r.group==='invalidated'?'invalid':r.group==='paused'?'paused':'')+'">'+esc(r.label)+'</span><h3>'+esc(r.name||r.symbol)+'</h3><p>'+esc(r.reason)+'</p><small>原截止 '+esc(r.originalThrough||'未知')+' · 当前 '+esc(r.currentThrough||'未取得')+'<br>原失效参考 '+fmt(r.originalStop)+(finite(r.distancePct)?' · 距参考 '+r.distancePct.toFixed(2)+'%':' · 距离未核验')+'</small><p>'+esc(r.next)+'</p>'+button('复核原判断 ↗','data-research-id="'+esc(r.id)+'"','link')+'</article>').join(''):'<p class="muted">保存个人研究后，会按失效、数据暂停和等待条件整理；不会为了填满清单生成机会。</p>')+
 (q.items.length>limit?'<p class="muted">先显示 '+limit+' / '+q.total+' 条，同股不同研究分别保留。</p>':'')+
 button('查看全部跟踪与备份','data-page="library"','link')+'<p class="muted">风险预算 <b>待设置</b>，不生成个人仓位。距参考只描述结构距离，不能保证成交或退出。</p></section>';
}
function healthRows(){
 const h=buildDataHealth(state.status,state.market.stocks,{query:state.healthQuery,reason:state.healthReason,page:state.healthPage,pageSize:25});
 state.healthPage=h.page;
 return '<p role="status">异常股票 '+n(h.total)+' · 当前筛选 '+n(h.filtered)+' · 第 '+n(h.page)+' / '+n(h.pages)+' 页</p>'+
 (h.rows.length?h.rows.map(r=>'<article class="event health-item"><div class="row"><h3>'+esc(r.name||r.symbol)+'</h3><span class="pill paused">'+esc(({insufficient:'数据不足或异常',stale:'数据过期',request_failed:'请求失败',failed:'获取失败'})[r.state]||'待核验')+'</span></div><p>'+esc(r.symbol)+' · '+esc(r.message||r.code||'未保存具体原因')+'</p>'+
 (r.attempts?.length?'<small>'+r.attempts.filter(a=>a&&typeof a==='object').map(a=>esc(a.host)+'：'+esc(a.state)+(a.message?' · '+esc(a.message):'')).join('<br>')+'</small>':'')+
 (r.canOpen?button('查看原数据与来源 ↗','data-stock="'+esc(r.symbol)+'"','link'):'<small>本次未返回个股文件，不能打开虚构档案。</small>')+'</article>').join(''):empty(h.total?'当前筛选没有匹配记录':'本次未记录逐股票异常','这不代表未覆盖的股票都正常，也不代表没有市场机会。'))+
 '<div class="row">'+button('上一页','data-health-page="'+(h.page-1)+'" '+(h.page<=1?'disabled':''))+button('下一页','data-health-page="'+(h.page+1)+'" '+(h.page>=h.pages?'disabled':''))+'</div>';
}
function healthPanel(){
 const h=buildDataHealth(state.status,state.market.stocks),a=state.status?.acquisition||{};
 if(state.healthReason&&!h.groups.some(g=>g.key===state.healthReason)){state.healthReason='';state.healthPage=1}
 return '<section class="card" id="dataHealth"><div class="eyebrow">DATA HEALTH / NO SILENT FAILURE</div><h2>哪些股票暂时不能判断</h2><p class="muted">股票覆盖数与HTTP请求次数分开。数据异常、过期或请求失败不等于没有机会；备用通道成功也不证明策略有效。</p>'+
 '<p>日线HTTP请求 '+n(a.httpRequests)+' · 其中备用请求 '+n(a.secondaryRequests)+' · 备用后通过原校验 '+n(a.recovered)+' 只 · 预算限制未重试 '+n(a.skippedRetries)+' 只</p>'+
 '<div class="fields"><label for="healthSearch">查名称、代码或原因<input id="healthSearch" type="search" value="'+esc(state.healthQuery)+'" placeholder="例如：价格关系、成交量或代码"></label><label for="healthReason">按失败原因筛选<select id="healthReason"><option value="">全部原因</option>'+h.groups.map(g=>'<option value="'+esc(g.key)+'" '+(state.healthReason===g.key?'selected':'')+'>'+esc(g.label)+' · '+n(g.count)+'只</option>').join('')+'</select></label></div>'+
 '<div id="healthResults">'+healthRows()+'</div>'+
 '<details><summary>股票池来源与全局获取问题</summary>'+(h.sourceFailures.length?h.sourceFailures.map(f=>'<p>'+esc(f.source||'数据源')+' · '+esc(f.message||f.code||'原因未保存')+'</p>').join(''):'<p class="muted">本次未记录股票池来源问题。</p>')+
 (h.unattributedFailures||[]).map(f=>'<p>'+esc(f.message||f.code||'全局失败原因未保存')+'</p>').join('')+'</details></section>';
}

function banner(){
 const a=state.assessment||{},c=a.coverage||state.status?.coverage||{},fail=[...(Array.isArray(state.status?.sourceFailures)?state.status.sourceFailures:[]),...(Array.isArray(state.status?.failures)?state.status.failures:[])];
 return '<section class="data-banner" role="status"><div class="row"><span class="pill '+esc(a.state)+'">'+esc(a.title||'数据待核验')+'</span><b>数据截止 '+esc(a.dataThrough||state.market.dataThrough||'未知')+'</b><span>应有完整日线 '+esc(a.expectedThrough||'未核验')+'</span></div><p>目标 '+n(c.targetRequested)+' · 股票池 '+n(c.poolSize)+' · 请求 '+n(c.requested)+' · 返回 '+n(c.returned)+' · 可判断 '+n(c.usable)+' · 请求失败 '+n(c.failed)+' · 过期 '+n(c.stale)+' · 不足 '+n(c.insufficient)+' · 未请求 '+n(c.notRequested)+' · 合格候选：未判定</p><p>'+esc(a.message||state.status?.message||'')+(c.fallback?' 当前为备用样本，不是全市场覆盖。':'')+'</p><details><summary>查看来源、更新时间和失败原因</summary><p>池来源 '+esc(c.poolSource||'未知')+'；本次尝试 '+esc(state.status?.attemptedAt||'尚未执行')+'；发布 '+esc(state.market.generatedAt||'尚未生成')+'</p>'+fail.slice(0,15).map(f=>'<p>'+esc(f.symbol||f.source||'数据源')+' · '+esc(f.code||'')+' · '+esc(f.message||f.reason||'未返回原因')+'</p>').join('')+'<p>GitHub工作日收盘后定时生成。“读取最新数据”只重新读取已发布文件，不是实时扫描。日历覆盖至 '+esc(state.calendar?.validThrough||'未核验')+'。</p></details>'+button('查看全部异常股票与获取过程','data-tool="health"','link')+'</section>';
}
function mini(s){const rows=s.miniHistory||s.history?.slice(-20)||[];if(rows.some(r=>!r||!finite(r.close)||r.close<=0||r.missingSession))return '<p class="muted">历史含缺口，暂停连线。</p>';const p=rows.map(r=>r.close);if(p.length<2)return '';const lo=Math.min(...p),span=Math.max(...p)-lo||1;return '<svg class="mini-chart" viewBox="0 0 280 36" aria-label="已发布历史收盘示意"><polyline points="'+p.map((v,i)=>(8+i*264/(p.length-1)).toFixed(1)+','+(31-(v-lo)*26/span).toFixed(1)).join(' ')+'"/></svg>'}
function card(s){
 const e=explain(s,state.assessment),stage=stageOf(s,state.assessment),q=quality(s);
 return '<article class="card stock-card"><div class="stock-top"><span class="pill '+esc(stage.id)+'">'+esc(stage.label)+'</span><b class="price">'+fmt(s.price)+'</b></div><h2>'+esc(s.name||s.symbol)+'</h2><span class="stock-code">'+esc(s.symbol)+'</span>'+mini(s)+'<p>'+esc(e.reason)+'</p><dl><dt>还差什么</dt><dd>'+esc(e.confirmation)+'</dd><dt>主要疑点</dt><dd>'+esc(e.doubt)+'</dd><dt>何时放弃</dt><dd>'+esc(e.invalidation)+'</dd></dl><div class="card-bottom"><small>'+esc(s.dataThrough||s.data?.dataThrough||'未知')+' · '+esc(q.label)+'</small>'+button('打开研究档案 ↗','data-stock="'+esc(s.symbol)+'"','primary')+'</div></article>';
}
function searchResults(){if(!state.search.trim())return '';const q=state.search.trim().toLowerCase(),items=state.market.stocks.filter(s=>(s.name+' '+s.symbol+' '+s.code).toLowerCase().includes(q)).slice(0,18);return items.length?items.map(s=>'<button data-stock="'+esc(s.symbol)+'"><b>'+esc(s.name||s.symbol)+'</b><small>'+esc(s.symbol)+' · '+esc(quality(s).label)+'</small></button>').join(''):'<p class="muted">本次已发布股票池未找到；不代表股票不存在。</p>'}
function search(){return '<div class="search"><label for="searchInput">搜索已发布股票</label><input id="searchInput" type="search" placeholder="名称或6位代码" value="'+esc(state.search)+'"><small class="muted">仅本次覆盖范围</small></div><div class="search-results" id="searchResults">'+searchResults()+'</div>'}
function home(){
 const focus=selectFocus(state.market.stocks,state.assessment,3),first=focus[0],e=first?explain(first,state.assessment):null;
 return '<section class="hero"><div><div class="eyebrow">TODAY / DISCOVER · WAIT · REVIEW</div><h1>'+esc(first?'先研究 '+first.name+'，等条件走出来。':'先核对条件，再等待机会。')+'</h1><p>'+esc(e?.reason||'不强行每天推荐股票。先看为什么、还差什么，以及什么时候放弃。')+'</p><div class="row">'+(first?button('进入重点研究 ↗','data-stock="'+esc(first.symbol)+'"','primary'):button('查看机会演化','data-page="map"','primary'))+button('读取最新数据','data-refresh')+'</div></div><div class="conditions"><p><b>现在还差什么</b><br>'+esc(e?.confirmation||'完整日线、可靠量能、清楚的趋势与阶段先后关系；数据不足时等待。')+'</p><p><b>什么情况下放弃</b><br>'+esc(e?.invalidation||'保存原始条件后，以有效完整收盘复核原失效价。缺失数据不能判定失效。')+'</p></div></section>'+banner()+'<div class="grid main"><section>'+title('FOCUS / OBSERVATIONS','优先研究清单','最多3条 · 不是确定买点')+(focus.length?'<div class="focus-cards">'+focus.map(card).join('')+'</div>':empty(state.assessment?.canJudge?'暂无符合结构观察的股票':'无法完成判断',state.assessment?.canJudge?'本次已核验范围没有符合原观察条件的候选，可以继续等待。':'失败、过期或数据缺口不能解释为没有机会。'))+search()+eventRadar(4)+'</section><aside>'+reviewPanel(4)+'<section class="card compact"><h3>事件线索是独立渠道</h3><p class="muted">已接入公开公告索引。正文仍需核对，事件不直接成为价格确认。</p>'+button('打开事件研究','data-tool="events"','link')+'</section><section class="card"><h3>收益优势尚未证明</h3><p class="muted">历史上涨比例不是当前概率；规则分不等于胜率。</p>'+button('查看真实研究与限制','data-page="validation"','link')+'</section></aside></div>';
}
function map(){
 const lanes=[['trend','上涨趋势'],['pullback','缩量回调'],['compression','收窄整理'],['trigger','突破触发·待确认'],['follow','后续验证']];
 const groups=new Map(lanes.map(([id])=>[id,[]]));for(const s of state.market.stocks){const p=stageOf(s,state.assessment);if(quality(s).canJudge&&(isObservation(s)||p.id==='trigger')&&groups.has(p.id))groups.get(p.id).push(s)}
 const ended=state.saved.research.filter(r=>r.status==='invalidated'||r.status==='closed');
 return title('EVOLUTION / NONLINEAR','机会如何发展','阶段不是盈利进度')+'<p class="notice">允许倒退、暂停、过期和失效。原指标同时出现不等于已验证完整先后关系；事件证据与价格证据分开。</p>'+banner()+'<div class="lanes">'+lanes.map(([id,t],i)=>'<section class="lane"><div class="eyebrow">0'+(i+1)+'</div><h3>'+t+' · '+groups.get(id).length+'</h3>'+(groups.get(id).length?groups.get(id).slice(0,12).map(card).join(''):empty('等待核验','暂无当前可展示的候选。'))+(groups.get(id).length>12?'<p>更多股票请使用搜索查看。</p>':'')+'</section>').join('')+'</div><section class="card"><h2>失效、暂停与结束记录</h2>'+(ended.length?ended.map(r=>'<div class="list-row"><div><b>'+esc(r.name||r.symbol)+'</b><p>'+esc(r.id)+' · 原始截止 '+esc(r.dataThrough)+'</p></div>'+button('对照原始判断','data-research-id="'+esc(r.id)+'"','link')+'</div>').join(''):'<p class="muted">尚无本地结束记录，不代表历史没有失败。</p>')+'</section>'+search();
}
function chart(s){
 const rows=(s?.history||s?.miniHistory||[]).slice(-60);if(rows.some(r=>!r||!finite(r.close)||r.close<=0||r.missingSession))return empty('图表存在缺失交易日','保留缺口，暂停连续绘制；不压缩日期或补成0。');if(rows.length<2)return empty('图表数据不足','不把缺失价格补成0。');
 const w=740,left=43,right=18,top=18,bottom=201,vl=263,lo=Math.min(...rows.map(r=>finite(r.low)?r.low:r.close))*.985,hi=Math.max(...rows.map(r=>finite(r.high)?r.high:r.close))*1.015;
 const x=i=>left+i*(w-left-right)/(rows.length-1),y=p=>bottom-(p-lo)/(hi-lo||1)*(bottom-top),mv=Math.max(1,...rows.map(r=>finite(r.volume)?r.volume:0)),cw=Math.max(2,320/rows.length);
 let svg='<svg class="price-chart" viewBox="0 0 740 293" role="img" aria-label="历史价格成交量和可点击的研究标记">';
 for(let i=0;i<4;i++){const p=lo+(hi-lo)*i/3;svg+='<line class="grid-line" x1="'+left+'" x2="723" y1="'+y(p)+'" y2="'+y(p)+'"/><text x="0" y="'+(y(p)+3)+'">'+fmt(p)+'</text>'}
 rows.forEach((r,i)=>{const o=finite(r.open)?r.open:r.close,c=r.close<o?'#438b7e':'#b66a65';svg+='<line x1="'+x(i)+'" x2="'+x(i)+'" y1="'+y(finite(r.high)?r.high:r.close)+'" y2="'+y(finite(r.low)?r.low:r.close)+'" stroke="'+c+'"/><rect x="'+(x(i)-cw/2)+'" y="'+Math.min(y(o),y(r.close))+'" width="'+cw+'" height="'+Math.max(1,Math.abs(y(o)-y(r.close)))+'" fill="'+c+'"/>';if(finite(r.volume)&&r.volume>0){const h=38*r.volume/mv;svg+='<rect x="'+(x(i)-cw/2)+'" y="'+(vl-h)+'" width="'+cw+'" height="'+h+'" fill="'+c+'" opacity=".42"/>'}});
 for(const [p,t]of [[s.levels?.breakout,'突破参考'],[s.levels?.invalidation??s.levels?.stop,'失效参考']])if(finite(p)&&p>lo&&p<hi)svg+='<line class="reference" x1="43" x2="723" y1="'+y(p)+'" y2="'+y(p)+'"/><text x="50" y="'+(y(p)-5)+'">'+t+' '+fmt(p)+'</text>';
 for(const [i,key,t]of [[Math.max(0,rows.length-21),'pullback','回调？'],[Math.max(0,rows.length-6),'compression','收窄？'],[rows.length-1,'breakout','触发？']])svg+='<g class="marker" data-marker="'+key+'" role="button" tabindex="0" aria-label="查看'+t+'依据"><circle cx="'+x(i)+'" cy="'+y(rows[i].close)+'" r="6"/><text x="'+Math.min(681,x(i)-16)+'" y="'+Math.max(13,y(rows[i].close)-14)+'">'+t+'</text></g>';
 for(const i of [0,Math.floor(rows.length/2),rows.length-1])svg+='<text x="'+(x(i)-18)+'" y="287">'+esc(rows[i].date?.slice(5))+'</text>';
 return svg+'<text x="0" y="236">成交量</text></svg><small>价格涨跌使用红/绿，研究阶段使用独立文字标签。历史行情不等于历史预测。'+(rows.some(r=>!finite(r.volume)||r.volume<=0)?' 量能存在缺失或零值，暂停量能判断。':'')+'</small>';
}
function archiveView(){
 const r=record(),current=state.detail||bySymbol(state.stock),later=r&&state.later;
 const view=norm(r?(later?r.events.filter(e=>e.snapshot).at(-1)?.snapshot||r.original:r.original):current);
 const visible=r&&!later?null:r;
 const a=r&&!later?{...state.assessment,state:'ok',canJudge:view?.data?.state==='ok',expectedThrough:r.dataThrough,dataThrough:r.dataThrough}:state.assessment;
 return {r,current,view,later,visible,a,e:view?explain(view,a,visible):null};
}
function dossier(){
 const {r,current,view:s,later,visible,a,e}=archiveView();if(!s)return title('DOSSIER / LINK EVIDENCE','先选择一只股票')+search()+empty('尚未选择研究对象','从机会卡或搜索进入研究档案。');
 const stage=stageOf(s,a,visible),l=r?.original?.levels||s.levels||{},canSave=quality(current).canJudge&&Array.isArray(state.detail?.history)&&state.detail.history.length>=60;
 return '<section id="researchArchive"><div class="archive-head"><div><div class="eyebrow">'+(r?'SAVED / 原始判断不可覆盖':'PUBLISHED / 尚未建立个人研究')+'</div><h1>'+esc(s.name||s.symbol)+' <small class="stock-code">'+esc(s.symbol)+'</small></h1><p>'+esc(r?'研究编号 '+r.id:'当前发布快照')+' · 数据截止 '+esc(s.dataThrough||'未知')+'</p>'+(r?'<p>实际保存时间 '+esc(r.createdAt)+'，不是事后重建的预测。</p>':'')+'</div>'+(r?'<div class="timebar">'+button('当时判断','data-time="original" aria-pressed="'+!later+'"')+button('后来结果','data-time="later" aria-pressed="'+!!later+'"')+'</div>':button(state.saved.watchlist.includes(s.symbol)?'已在股票池':'加入股票池','data-watch="'+esc(s.symbol)+'"'))+'</div><div class="archive-grid"><section><article class="card compact"><span class="pill '+esc(stage.id)+'">'+esc(stage.label)+'</span><h2>价格、成交量与研究标记</h2>'+chart({...s,levels:l})+'<div class="chartkeys">'+button('① 回调依据','data-marker="pullback"')+button('② 收窄依据','data-marker="compression"')+button('③ 突破为何待确认','data-marker="breakout"')+'</div><small>来源 '+esc(source(s))+' · 此快照内的提供方历史日线，未保存的判断不事后补成预测。</small>'+fetchAudit(s)+'</article><article class="card compact"><h2>支持证据与疑点</h2><div class="facts">'+e.support.map(f=>'<div class="fact"><h3>'+esc(f.title)+'</h3><p>'+esc(f.text)+'</p><small>'+esc(f.date)+' · '+esc(f.formula)+'</small></div>').join('')+'</div><p class="warning">最重要的疑点：'+esc(e.doubt)+'</p></article><article class="card compact"><h2>'+esc(later?'后来追加的记录与结果':'当时保留的判断')+'</h2><p>'+esc(e.reason)+'</p>'+(r?(later?(r.events.length?r.events.map(v=>'<div class="event"><time>'+esc(v.at||v.createdAt)+' · '+esc(v.type)+'</time><p>'+esc(v.note||v.reason||v.message||'追加了一次真实观察')+'</p></div>').join(''):'<p class="muted">尚无后来记录，不推断成功或失败。</p>'):'<p class="muted">只展示最初快照，不混入后来笔记。当前记录状态请在后来结果查看。</p>'):'<p class="muted">保存后才创建独立编号，今天看到的历史图不能冒充当时预测。</p>')+'<form id="noteForm" class="note-form"><label for="noteText">追加证据、疑点或投资逻辑</label><textarea id="noteText" maxlength="4000" placeholder="记录来源、日期、支持与反面证据；只保存在此浏览器。"></textarea><button class="primary" data-save-note type="submit">追加笔记</button></form></article>'+companyPanel()+'</section><aside><article class="card compact"><div class="eyebrow">CONDITIONAL / STRUCTURAL REFERENCE</div><h2>等待什么，何时放弃</h2><p class="muted">'+esc(e.confirmation)+'</p><p class="warning">'+esc(e.invalidation)+'</p><dl class="levels">'+[['入场参考',l.entry],['突破参考',l.breakout],['原始失效参考',l.invalidation??l.stop],['止损条件参考',l.stop],['T1结构参考',l.target1],['T1风险收益比',l.rr1],['T2参考（未启用）',l.target2]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+fmt(v)+'</dd>').join('')+'</dl><small>此前20根完整日线不含判断日。T1＋1.5配置不兼容，合格候选未判定，T2未启用；目标价不是收益承诺。</small>'+button(r?'另建一条独立研究':'保存原始研究','data-save-research '+(!canSave?'disabled':''),'primary')+'<small>'+esc(canSave?'新机会新编号，旧条件不覆盖。':'当前数据不可判断，暂停新建；旧记录保留。')+'</small></article><article class="card compact"><h3>风险预算：待设置</h3><p class="muted">暂不生成个人仓位建议。止损参考不能保证退出价格；跳空、跌停、停牌、T+1与流动性可能增加损失。</p><p class="muted">当前概率未验证，不显示。价格变化、模拟结果与真实交易收益分别保留。</p></article><article class="card"><h3>设备留档与备份</h3><p class="muted">本地记录不上传，不自动跨设备同步。保存失败会明确提示。</p>'+button('打开备份与跟踪','data-page="library"','link')+'</article></aside></div></section>';
}
function library(){
 if(state.storeError)return empty('本地记录暂不可读',state.storeError+'。原数据未清空，请保留网站数据。');
 return reviewPanel(8)+title('MY RESEARCH / DEVICE ONLY','股票池、研究与计划','风险预算待设置')+'<p class="privacy">个人记录只保存在此浏览器。换设备、清除浏览器数据或存储故障时不能承诺恢复，请导出备份；导入仅合并，不静默覆盖。</p><div class="row">'+button('导出个人备份','id="exportBackup"','primary')+'<label>合并导入备份 <input id="importBackup" type="file" accept=".json,application/json"></label></div><div class="grid main"><section><article class="card compact"><h2>我的股票池</h2>'+(state.saved.watchlist.length?state.saved.watchlist.map(symbol=>{const s=bySymbol(symbol);return '<div class="list-row"><div><b>'+esc(s?.name||symbol)+'</b><p>'+esc(symbol)+' · '+esc(s?quality(s).label:'不在本次覆盖范围')+'</p></div><div class="row">'+button('研究 ↗','data-stock="'+esc(symbol)+'"','link')+button('移出','data-remove-watch="'+esc(symbol)+'"','link')+'</div></div>'}).join(''):'<p class="muted">从个股档案加入，不填入虚构股票。</p>')+'</article><article class="card compact"><h2>独立研究机会</h2>'+(state.saved.research.length?state.saved.research.slice().reverse().map(r=>'<div class="list-row"><div><b>'+esc(r.name||r.symbol)+'</b> <span class="pill '+(r.status==='invalidated'?'invalid':'')+'">'+esc(r.status==='invalidated'?'已失效':r.status==='closed'?'已结束':'跟踪中')+'</span><p>'+esc(r.id)+'<br>保存 '+esc(r.createdAt)+' · 原始截止 '+esc(r.dataThrough)+'</p></div>'+button('原始与后来 ↗','data-research-id="'+esc(r.id)+'"','link')+'</div>').join(''):'<p class="muted">尚未保存。同一股票可以多次发现，研究编号互不覆盖。</p>')+'</article>'+search()+'</section><aside><article class="card compact"><h2>持仓记录</h2><p class="muted">填写实际成本和股数，不自动下单或建议仓位。</p>'+state.saved.portfolio.map(h=>{const s=bySymbol(h.symbol),p=quality(s).canJudge&&finite(s?.price)?(s.price-h.cost)*h.quantity:null;return '<div class="event"><b>'+esc(h.name||h.symbol)+'</b><p>'+esc(h.symbol)+' · '+n(h.quantity)+' 股 · 成本 '+fmt(h.cost)+'<br>按发布价格估算变化 '+fmt(p)+'，未扣费，不是实际交易收益。</p>'+button('移除记录','data-remove-holding="'+esc(h.symbol)+'"','link')+'</div>'}).join('')+'<form id="holdingForm"><div class="fields"><label>代码<input name="symbol" placeholder="600036.SS" required></label><label>实际股数<input name="quantity" type="number" min="1" step="1" required></label><label>实际成本<input name="cost" type="number" min=".0001" step="any" required></label></div><button type="submit">保存持仓记录</button></form></article><article class="card"><h3>费用与本地简报</h3>'+button('费用计算','data-tool="fees"','link')+' · '+button('生成本地简报','data-tool="brief"','link')+'<p class="muted">原数据库没有被迁移、替换或恢复。本版不声称已导入未提供的旧记录。</p></article></aside></div>';
}
function validation(){
 return '<section class="hero"><div><div class="eyebrow">VALIDATION / FAIR COMPARISON</div><h1>用同条件结果检验上涨机会。</h1><p>补齐已有五日研究的成本、同日对照和季度检验。事后重建不代表当时预测，高正比例不代表稳定赚钱。</p></div><div class="conditions"><p>对标 Zacks Rank 的公开验证方式；市场、周期和成本不同，当前不能声称预测超过它。</p><p>模型与正式策略仍待验证，不生成未经支持的概率。</p></div></section>'+
 renderLongReview(state.longReview)+renderTrainingReview(state.trainingReview)+renderStudyPanel(state.study,{costBps:state.studyCostBps,groupId:state.studyGroup,audit:state.studyAudit})+renderBenchmarkCard()+banner();
}
const toolsList=[['health','数据复核','原因、覆盖与备用过程'],['company','公司研究','公开概况与来源'],['financial','财报关键值','报告期与披露可核对'],['industry','行业分析','同业数据待接入'],['events','事件雷达','公告索引·正文待核验'],['trend','趋势与量价','结构研究可用'],['risk','风险分析','条件复核可用'],['ai','AI研究对话','安全AI服务未接入'],['plans','投资逻辑与计划','本地留档可用'],['portfolio','持仓组合','本地记录可用'],['fees','费用计算','明确费率后可计算'],['brief','研究简报','本地生成可用']];
function brief(){return 'Allen 个人研究简报\n生成 '+new Date().toISOString()+'\n数据截止 '+(state.assessment?.dataThrough||'未知')+'\n数据状态 '+state.assessment?.title+'\n风险预算待设置，不生成仓位建议。\n\n股票池：'+state.saved.watchlist.join('、')+'\n\n独立研究：\n'+state.saved.research.map(r=>(r.name||r.symbol)+' '+r.id+' '+r.status+' 截止'+r.dataThrough).join('\n')+'\n\n笔记：\n'+state.saved.notes.slice(-10).map(x=>x.symbol+' '+x.createdAt+'\n'+x.text).join('\n\n')+'\n仅为本地研究整理；价格变化不等于实际收益。'}
function toolContent(){
 const t=state.tool,s=state.detail||bySymbol(state.stock);
 if(t==='all')return '';
 if(t==='health')return healthPanel();
 if(t==='fees')return '<article class="card"><h2>A股费用计算</h2><p class="muted">填写实际费率，缺失不当成0；不预设个人费率。</p><form id="feeForm"><div class="fields">'+[['buy','买入价'],['sell','卖出价'],['qty','股数'],['commission','佣金（万分之几）'],['minimum','最低单边佣金'],['stamp','卖出印花税（万分之几）'],['transfer','单边过户费（万分之几）']].map(([k,l])=>'<label>'+l+'<input name="'+k+'" type="number" min="0" step="any" required></label>').join('')+'</div><button class="primary">计算费用和估算净变化</button></form><div id="feeResult"></div></article>';
 if(t==='brief')return '<article class="card"><h2>本地研究简报</h2><pre class="brief">'+esc(brief())+'</pre>'+button('下载本地简报','data-download-brief')+'</article>';
 if(['portfolio','plans'].includes(t))return '<article class="card"><h2>投资逻辑、计划与持仓</h2><p>只记录你填写的条件和实际持仓，不生成个人仓位建议。</p>'+button('打开股票池与跟踪','data-page="library"','primary')+'</article>';
 if(['trend','risk'].includes(t))return '<article class="card"><h2>'+esc(toolsList.find(x=>x[0]===t)[1])+'</h2><p class="muted">'+esc(s?(s.name+' · '+s.symbol+' · '+(s.exchange||s.company?.exchange||'交易所未提供')+' · '+(s.currency||'币种未提供')):'先选择股票。')+'</p><p class="muted">价格结构、证据、确认与失效在同一个档案中核查。公司基础字段不等于完整尽调，未验证的概率不显示。</p>'+(s?button('打开当前个股档案','data-stock="'+esc(s.symbol)+'"','primary'):'')+search()+'</article>';
 if(t==='events')return eventRadar(60)+search();
 if(['company','financial'].includes(t))return s?companyPanel(t==='financial'?'financial':'company')+search():empty('先选择研究对象','公司资料与财报关键值需要核对具体股票。')+search();
 if(t==='ai')return '<article class="card"><h2>AI研究对话入口 · 尚未接入安全服务</h2><p class="muted">GitHub Pages不直接运行原来的AI后台；本版不索取或公开保存API密钥，不把规则文字冒充AI回答。</p><p>仍可在个股档案使用具体日期、公式和来源解释结构，再追加自己的研究问题。</p>'+search()+'</article>';
 return '<article class="card"><h2>'+esc(toolsList.find(x=>x[0]===t)?.[1]||'研究数据')+' · 数据待接入</h2><p class="muted">没有可靠的报告期、披露日期或行业范围时，不生成虚构分析，缺失也不当成0。入口保留，后续逐项适配。</p>'+search()+'</article>';
}
function tools(){return title('RESEARCH TOOLS / KEEP THE ENTRANCES','全部研究工具','可用状态逐项公开')+'<p class="muted">本地记录、浏览器计算和公开数据文件可用；公司概况、财报关键值与公告索引已接入；完整财务分析、行业比较和AI仍需逐项验证。</p><div class="tool-grid">'+toolsList.map(([id,t,status])=>'<article class="card"><span class="pill">'+status+'</span><h3>'+t+'</h3>'+button('打开 ↗','data-tool="'+id+'"','link')+'</article>').join('')+'</div><div id="toolContent" style="margin-top:20px">'+toolContent()+'</div>'}
function render(){
 document.querySelectorAll('nav [data-page]').forEach(b=>b.classList.toggle('selected',b.dataset.page===state.page));
 $('#app').innerHTML=(state.market.dataKind==='synthetic'?'<p class="test-label">合成测试数据 · 非真实行情或模型成绩</p>':'')+(state.storeError?'<p class="warning">本地记录暂不可读取：'+esc(state.storeError)+'；原数据未清空。</p>':'')+({home,map,dossier,library,validation,tools}[state.page]||home)();
}
async function detail(s){if(state.cache.has(s.symbol))return state.cache.get(s.symbol);if(!/^data\/stocks\/[0-9]{6}\.(SS|SZ)\.json$/.test(s.detailPath||''))return s;const d=norm(await readJSON(s.detailPath));if(d.symbol!==s.symbol||d.dataThrough!==(s.dataThrough||s.data?.dataThrough)||(s.generatedAt&&d.generatedAt!==s.generatedAt))throw Error('个股与列表快照不一致，暂停混合判断');state.cache.set(s.symbol,d);return d}
async function open(symbol,id=null){
 const selection=++state.selection,epoch=state.epoch;
 state.stock=symbol;state.recordId=id;state.later=false;state.page='dossier';state.detail=null;state.researchCurrent=null;state.researchLoading=true;state.researchError=null;render();
 const s=bySymbol(symbol),active=()=>selection===state.selection&&epoch===state.epoch&&state.stock===symbol;
 if(!s){state.researchLoading=false;render();if(!id)notice('不在当前覆盖范围，不编造行情。',true);return}
 await Promise.allSettled([
  detail(s).then(d=>{if(active()){state.detail=d;renderKeepingNote()}}).catch(error=>{if(active())notice('图表数据未能读取：'+error.message,true)}),
  researchDetail(s).then(b=>{if(active()){state.researchCurrent=b;state.researchLoading=false;renderKeepingNote()}}).catch(error=>{if(active()){state.researchError=error.message;state.researchLoading=false;renderKeepingNote()}})
 ]);
}
async function refresh(announce=true){
 const epoch=++state.epoch,r=await Promise.allSettled(['data/status.json','data/market.json','data/calendar.json','data/history-study.json','data/research-index.json','data/research-status.json','study-audit.json','training-review.json','long-training-review.json'].map(readJSON));if(epoch!==state.epoch)return;
 state.status=r[0].status==='fulfilled'?r[0].value:{state:'failed',message:r[0].reason.message,coverage:{},failures:[{message:r[0].reason.message}]};
 state.market=r[1].status==='fulfilled'&&Array.isArray(r[1].value?.stocks)?r[1].value:{stocks:[]};state.market.stocks=state.market.stocks.map(norm);
 if(r[1].status==='rejected')state.status={...state.status,state:'failed',message:'股票文件无法读取，无法完成判断'};
 state.calendar=r[2].status==='fulfilled'?r[2].value:null;state.study=r[3].status==='fulfilled'?r[3].value:null;state.studyAudit=r[6].status==='fulfilled'&&r[6].value?.schema===1?r[6].value:null;state.trainingReview=r[7].status==='fulfilled'?r[7].value:null;state.longReview=r[8].status==='fulfilled'?r[8].value:null;
 state.researchIndex=r[4].status==='fulfilled'&&r[4].value?.schema===1?r[4].value:null;state.researchStatus=r[5].status==='fulfilled'&&r[5].value?.schema===1?r[5].value:null;state.researchCache.clear();state.researchCurrent=null;state.researchError=null;state.researchLoading=false;
 state.assessment=assessData(state.status,state.market,state.calendar,new Date());state.cache.clear();state.detail=null;saved();
 if(!state.storeError&&state.assessment.canJudge)try{local.reconcile({...state.market,expectedThrough:state.assessment.expectedThrough},{expectedThrough:state.assessment.expectedThrough});saved()}catch(error){state.storeError=error.message}
 if(state.stock){const symbol=state.stock,selection=state.selection,s=bySymbol(symbol);if(s){
  const [priceResult,researchResult]=await Promise.allSettled([detail(s),researchDetail(s)]);
  if(epoch===state.epoch&&selection===state.selection&&symbol===state.stock){state.detail=priceResult.status==='fulfilled'?priceResult.value:null;state.researchCurrent=researchResult.status==='fulfilled'?researchResult.value:null;state.researchError=researchResult.status==='rejected'?researchResult.reason.message:null}
 }}
 if(epoch!==state.epoch)return;renderKeepingNote();if(announce)notice(state.assessment.canJudge?'已读取最新发布文件；不是实时扫描。':'读取完成，但'+state.assessment.title+'；不能据此判断没有机会。',!state.assessment.canJudge);
}
function showEvidence(key){const {view:s,visible,a,e}=archiveView();if(!s)return;$('#evidenceContent').innerHTML='<div class="eyebrow">EXPLAIN / DATE · FORMULA · SOURCE</div><h2>'+esc({pullback:'回调依据',compression:'收窄依据',breakout:'突破为什么仍待确认'}[key])+'</h2><p>数据截止 '+esc(s.dataThrough)+'</p><h3>支持证据</h3>'+e.support.map(f=>'<p><b>'+esc(f.title)+'</b><br>'+esc(f.text)+'<br><small>日期 '+esc(f.date)+'<br>计算 '+esc(f.formula)+'<br>来源 '+esc(f.source||source(s))+'</small></p>').join('')+'<h3>疑点</h3><p class="warning">'+esc(e.doubt)+'</p><h3>确认条件</h3><p>'+esc(e.confirmation)+'</p><h3>失效条件</h3><p>'+esc(e.invalidation)+'</p><small>规则解释不是AI预测，也不是收益保证。</small>';if(!$('#evidenceDialog').open)$('#evidenceDialog').showModal()}
function recheck(){if(!state.status)return;const next=assessData(state.status,state.market,state.calendar,new Date());const changed=JSON.stringify([next.state,next.expectedThrough,next.canJudge])!==JSON.stringify([state.assessment?.state,state.assessment?.expectedThrough,state.assessment?.canJudge]);state.assessment=next;if(changed){const draft=$('#noteText')?.value;render();if(typeof draft==='string'&&$('#noteText'))$('#noteText').value=draft}}
window.addEventListener('focus',recheck);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recheck()});setInterval(recheck,60000);
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function change(fn,text){try{if(state.storeError)throw Error(state.storeError);const result=await fn();saved();render();notice(typeof text==='function'?text(result):text);return result}catch(error){notice('保存失败：'+error.message+'；没有确认保存成功，原始记录不覆盖。',true);return null}}
document.addEventListener('click',async event=>{
 const b=event.target.closest('button,[data-marker]');if(!b)return;const d=b.dataset;
 if(b.hasAttribute('data-close')){$('#evidenceDialog').close();return}if(d.marker){showEvidence(d.marker);return}
 if(b.hasAttribute('data-refresh')){b.disabled=true;try{await refresh()}catch(error){notice('读取失败：'+error.message,true)}finally{b.disabled=false}return}
 if(d.researchId){saved();const r=state.saved.research.find(r=>r.id===d.researchId);if(r)await open(r.symbol,r.id);return}
 if(d.stock){await open(d.stock);return}if(d.time){state.later=d.time==='later';render();return}
 if(b.hasAttribute('data-save-research')){
  recheck();const s=norm(state.detail);
  if(!s||!Array.isArray(s.history)||s.history.length<60||!quality(s).canJudge){notice('当前行情档案未完整加载或数据不可判断，研究未保存。',true);return}
  const snapshot={...s,dataThrough:s.dataThrough,generatedAt:new Date().toISOString(),strategyVersion:s.profile?.strategy?.version||s.levels?.version||'range20-t1-review-1',publishedAt:state.market.generatedAt};
  const info=selectResearchView({latest:currentResearch(),symbol:s.symbol,now:new Date()});if(info.bundle)snapshot.research=info.bundle;
  const r=await change(()=>local.addResearch(snapshot),x=>'原始研究已保存，独立编号 '+x.id+(info.bundle?'；包含当时已取得的公司资料。':'；财报公告未取得，本次只保存价格研究。'));
  if(r){state.recordId=r.id;state.later=false;render()}return;
 }
 if(b.hasAttribute('data-attach-research')){
  recheck();const r=record(),s=norm(state.detail),view=researchView();
  if(!r||!state.later||!view.canAttach||!view.bundle||!s||!Array.isArray(s.history)||s.history.length<60||!quality(s).canJudge){notice('当前资料或行情不完整，未追加；原始记录未变。',true);return}
  await change(()=>local.appendEvent(r.id,{type:'note',note:'追加公司、财报与公告资料快照 '+view.bundle.bundleId,dataThrough:s.dataThrough,snapshot:{...s,research:view.bundle}}),'当前资料已追加，最初判断保持不变。');return;
 }
 if(d.watch){await change(()=>local.addWatch(bySymbol(d.watch)||d.watch),'已加入此浏览器的股票池。');return}
 if(d.removeWatch){await change(()=>local.removeWatch(d.removeWatch),'已移出股票池，独立研究保留。');return}
 if(d.removeHolding){await change(()=>local.removeHolding(d.removeHolding),'已移除所选持仓。');return}
 if(b.id==='exportBackup'){try{download('Allen-backup-'+new Date().toISOString().slice(0,10)+'.json',local.exportJSON());notice('个人备份已生成下载，未上传。')}catch(error){notice('导出失败：'+error.message,true)}return}
 if(b.hasAttribute('data-download-study')){if(buildStudyView(state.study).state==='invalid'){notice('摘要当前未核验，未生成下载。',true);return}download('Allen-five-session-summary.json',JSON.stringify(state.study,null,2));notice('已下载冻结摘要，不包含原逐日样本，不能据此声称完整复现。');return}
 if(b.hasAttribute('data-download-brief')){download('Allen-brief.txt',brief(),'text/plain;charset=utf-8');notice('已生成本地简报，未自动发送。');return}
 if(d.healthPage){state.healthPage=Number(d.healthPage);const target=$('#healthResults');if(target)target.innerHTML=healthRows();return}
 if(d.tool){state.tool=d.tool;state.page='tools';render();$('#toolContent')?.scrollIntoView({block:'start'});return}
 if(d.page){state.page=['home','map','dossier','library','validation','tools'].includes(d.page)?d.page:'home';render()}
});
document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('g[data-marker]')){e.preventDefault();showEvidence(e.target.dataset.marker)}});
document.addEventListener('input',e=>{if(e.target.id==='searchInput'){state.search=e.target.value;$('#searchResults').innerHTML=searchResults()}if(e.target.id==='healthSearch'){state.healthQuery=e.target.value;state.healthPage=1;$('#healthResults').innerHTML=healthRows()}});
document.addEventListener('change',async e=>{if(e.target.id==='studyCost'){state.studyCostBps=Number(e.target.value);render();return}if(e.target.id==='studyGroup'){state.studyGroup=e.target.value;render();return}if(e.target.id==='healthReason'){state.healthReason=e.target.value;state.healthPage=1;$('#healthResults').innerHTML=healthRows();return}if(e.target.id!=='importBackup')return;const f=e.target.files?.[0];if(!f)return;if(f.size>8*1024*1024){notice('导入失败：超过8MiB，请保留原备份。',true);return}try{await change(()=>f.text().then(text=>local.importJSON(text,{mode:'merge'})),'备份已合并，原始条件没有覆盖。')}catch(error){notice('导入失败：'+error.message,true)}});
document.addEventListener('submit',async e=>{
 if(e.target.id==='noteForm'){e.preventDefault();const text=$('#noteText').value.trim();if(!text){notice('请先填写笔记。',true);return}const r=record();await change(()=>r?local.appendEvent(r.id,{type:'note',note:text}):local.addNote(state.stock,text),'笔记已追加，原始条件未改变。');return}
 if(e.target.id==='holdingForm'){e.preventDefault();const f=new FormData(e.target),symbol=String(f.get('symbol')).trim().toUpperCase(),quantity=Number(f.get('quantity')),cost=Number(f.get('cost'));if(!/^\d{6}\.(SS|SZ)$/.test(symbol)||!Number.isInteger(quantity)||quantity<=0||!finite(cost)||cost<=0){notice('请填写正确代码、正整数股数和正成本。',true);return}await change(()=>local.setHolding({symbol,name:bySymbol(symbol)?.name||symbol,quantity,cost}),'实际持仓记录已保存，不是仓位建议。');return}
 if(e.target.id==='feeForm'){e.preventDefault();const f=new FormData(e.target),v={};for(const key of ['buy','sell','qty','commission','minimum','stamp','transfer']){const t=String(f.get(key)||'');if(!t.trim()){notice('价格和费率需明确填写，缺失不当成0。',true);return}v[key]=Number(t)}if(Object.values(v).some(x=>!finite(x)||x<0)||v.buy<=0||v.sell<=0||!Number.isInteger(v.qty)||v.qty<=0){notice('价格和股数需大于0，费率需非负。',true);return}const buy=v.buy*v.qty,sell=v.sell*v.qty,commission=Math.max(v.minimum,buy*v.commission/10000)+Math.max(v.minimum,sell*v.commission/10000),tax=sell*v.stamp/10000,transfer=(buy+sell)*v.transfer/10000;$('#feeResult').innerHTML='<p>佣金 '+fmt(commission)+' · 印花税 '+fmt(tax)+' · 过户费 '+fmt(transfer)+'</p><p><b>按填写价格估算净变化 '+fmt(sell-buy-commission-tax-transfer)+' 元</b></p><p class="muted">未模拟实际滑点、停牌、涨跌停和部分成交，不是收益承诺。</p>'}
});
try{local=createPersonalStore();saved()}catch(error){state.storeError=error.message;local={read(){throw error}}}
refresh(false).catch(error=>{$('#app').innerHTML=empty('无法完成判断',error.message);notice('数据初始化失败，不能解释为没有机会。',true)});

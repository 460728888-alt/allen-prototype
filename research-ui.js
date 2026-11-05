import {safeResearchUrl} from './research-domain.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v),fmt=v=>finite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:2}):'未取得';
const labels={ok:'资料已取得',cached:'缓存资料',partial:'部分资料',failed:'请求失败',request_failed:'请求失败',insufficient:'资料不足',stale:'资料过期',not_requested:'未覆盖',unavailable:'暂不可用',not_saved:'当时未保存',invalid:'版本或时间未核验',uncovered:'未覆盖'};
const stateLabel=s=>labels[s]||'待核验';
const link=(url,symbol,text)=>{const safe=safeResearchUrl(url,symbol);return safe?'<a href="'+esc(safe)+'" target="_blank" rel="noopener noreferrer">'+esc(text)+' ↗</a>':'<span class="muted">来源链接未核验</span>'};
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）':'时间未核验';
const amount=v=>finite(v)?(Math.abs(v)>=1e8?fmt(v/1e8)+' 亿':fmt(v)):'未取得';
export function renderResearchPanel(view,{symbol,loading=false,error=null,mode='all',recordId=null}={}){
 const b=view?.bundle;
 if(loading&&!b)return '<article class="card" id="companyResearch"><h2>公司与公告资料加载中</h2><p class="muted">价格研究独立可用。未加载的资料不会冒充已留档。</p></article>';
 if(!b)return '<article class="card" id="companyResearch"><h2>公司、财报与公告证据</h2><span class="pill paused">'+esc(stateLabel(view?.state))+'</span><p>'+esc(error||view?.label||'当前资料暂不可读取；这不代表没有公告或财报。')+'</p><p class="muted">旧研究没有保存的资料不事后补入。当时判断只展示当时已留档的内容。</p></article>';
 const company=b.company||{},financial=b.financial||{},ann=b.announcements||{},reports=Array.isArray(financial.reports)?financial.reports:[],items=Array.isArray(ann.items)?ann.items:[];
 const section=kind=>mode==='all'||mode===kind;
 const description=company.introduction||company.description||company.business||null;
 let html='<article class="card research-context" id="companyResearch" data-research-version="'+esc(b.bundleId)+'"><div class="eyebrow">COMPANY / FINANCIALS / ANNOUNCEMENTS</div><h2>连接事实，复核机会</h2><span class="pill">'+esc(view.label||stateLabel(view.state))+'</span><p class="muted">资料版本 '+esc(b.bundleId)+'<br>本次获取 '+esc(stamp(b.fetchedAt))+' · 可用信息截止 '+esc(stamp(b.asOf))+'</p>';
 if(error)html+='<p class="warning">'+esc(error)+'</p>';
 if(section('company'))html+='<section class="research-section"><h3>公司概况 <span class="pill">'+esc(stateLabel(company.state))+'</span></h3>'+
 (company.state==='ok'||company.state==='cached'||company.state==='partial'?'<p><b>'+esc(company.fullName||company.name||'名称未取得')+'</b><br>'+esc(company.industry||'行业未取得')+' · '+esc(company.exchange||'交易所未取得')+'</p>'+(description?'<details><summary>业务与公司介绍</summary><p>'+esc(description)+'</p></details>':'')+'<small>来源 '+esc(company.source?.provider||'东方财富公司资料')+' · 获取 '+esc(stamp(company.source?.fetchedAt||company.fetchedAt))+'；当前公司资料不是历史时点公司库。</small>':'<p class="muted">'+esc(company.message||company.reason||'当前未取得公司概况，不以缺失生成分析。')+'</p>')+'</section>';
 if(section('financial')){
  html+='<section class="research-section"><h3>已取得的财报关键值 <span class="pill">'+esc(stateLabel(financial.state))+'</span></h3><p class="muted">年初至报告期末累计，非单季度；不直接相加计算TTM。原金额单位来自来源表头“元”，币种未注明时不默认为人民币。百分数按来源原值显示。</p>';
  html+=reports.length?reports.slice(0,2).map(r=>{
   const m=r.metrics||r||{},facts=[];
   if(finite(m.netProfit)&&m.netProfit<0)facts.push('归母净利润为负。');
   if(finite(m.revenueGrowth)&&m.revenueGrowth<0)facts.push('营业收入同比为负。');
   if(finite(m.profitGrowth)&&m.profitGrowth<0)facts.push('归母净利润同比为负。');
   if(finite(m.operatingCashPerShare)&&m.operatingCashPerShare<0)facts.push('每股经营现金流为负。');
   return '<article class="report" data-report-date="'+esc(r.reportDate)+'"><h4>报告期 '+esc(r.reportDate)+'</h4><p class="muted">来源披露日 '+esc(r.noticeDate||'未取得')+' · 修订日 '+esc(r.updateDate||'未取得')+'<br>本系统实际见到 '+esc(stamp(r.observedAt))+'；仅有日期不能证明当日收盘前已知。</p><dl class="financial-values">'+[
    ['营业总收入（源单位元）',amount(m.revenue)],['归母净利润（源单位元）',amount(m.netProfit)],
    ['营收同比',finite(m.revenueGrowth)?fmt(m.revenueGrowth)+'%':'未取得'],['归母净利同比',finite(m.profitGrowth)?fmt(m.profitGrowth)+'%':'未取得'],
    ['加权ROE',finite(m.roe)?fmt(m.roe)+'%':'未取得'],['毛利率',finite(m.grossMargin)?fmt(m.grossMargin)+'%':'未取得'],
    ['每股收益（源单位元/股）',fmt(m.eps)],['每股净资产（源单位元/股）',fmt(m.bps)],['每股经营现金流（源单位元/股）',fmt(m.operatingCashPerShare)]
   ].map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl><p class="muted">币种 '+esc(r.currency||'来源未注明')+'；“亿”表示原金额除以1亿，不是价格目标。缺失保留未知，亏损与负增长不隐藏。</p>'+
   (facts.length?'<p class="warning">待复核的财务事实：'+esc(facts.join(' '))+' 这是字段事实，不是短期价格结论。</p>':'<p class="muted">这些字段不足以证明短期上涨；继续核对公告正文、可比口径与右侧价格条件。</p>')+
   link(r.source?.url||r.source?.link,symbol,'核对来源财报页面')+'</article>';
  }).join(''):'<p class="muted">'+esc(financial.message||'当前已获取范围没有可展示的合格财报；不表示公司没有财报。')+'</p>';
  html+='</section>';
 }
 if(section('events')){
  html+='<section class="research-section"><h3>公告待核验 <span class="pill">'+esc(stateLabel(ann.state))+'</span></h3><p class="muted">这里只读取标题、分类与日期索引，尚未读取正文；不自动判利好，不推动价格阶段。</p>'+
  (items.length?items.slice(0,12).map(i=>'<article class="event announcement-item"><h4>'+esc(i.title)+'</h4><p class="muted">'+esc(i.category||'公司公告')+' · 公告日期 '+esc(i.noticeDate||'未取得')+'<br>本系统见到 '+esc(stamp(i.observedAt))+'</p>'+link(i.url||i.link,symbol,'打开公告索引与原文入口')+'</article>').join(''):'<p class="muted">本次已获取范围暂未匹配公告；不代表没有公告，分页、日期和覆盖限制仍需核对。</p>')+
  '<p class="muted">公告范围 '+esc(ann.scope?.from||ann.scope?.beginDate||'起点未保存')+' 至 '+esc(ann.scope?.through||ann.scope?.endDate||'终点未保存')+'；'+esc(ann.scope?.complete===true?'来源返回范围已读取，仍不代表独立核验。':'本次范围有限，未匹配部分仍未知。')+'</p></section>';
 }
 if(view.excluded&&Object.values(view.excluded).some(v=>finite(v)&&v>0))html+='<p class="warning">有资料因日期、获取时刻或链接未通过核验而未展示，未据此生成判断。</p>';
 if(recordId&&view.canAttach)html+='<button class="primary" data-attach-research>把当前资料追加到这条研究</button><small>新增一条带行情与资料快照的笔记，原始判断不覆盖。</small>';
 return html+'</article>';
}

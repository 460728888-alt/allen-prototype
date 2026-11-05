const finite=n=>typeof n==='number'&&Number.isFinite(n);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const symbolOK=v=>typeof v==='string'&&/^\d{6}\.(SS|SZ)$/.test(v);
const idOK=v=>typeof v==='string'&&/^[A-Za-z0-9:_.-]{1,200}$/.test(v);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
function stamp(v){
 if(typeof v!=='string')return null;
 const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(v);
 if(!m||!day(m[1])||+m[2]>23||+m[3]>59||+m[4]>59||m[6]&&(+m[6]>14||+m[7]>59||+m[6]===14&&+m[7]!==0))return null;
 const n=Date.parse(v);return finite(n)?n:null;
}
const chinaDay=n=>new Date(n+8*3600000).toISOString().slice(0,10);
const zero=()=>({bundles:0,company:0,reports:0,announcements:0});
function clone(v,depth=0,seen=new Set()){
 if(depth>40)throw Error('资料嵌套过深');
 if(v===null||typeof v==='string'||typeof v==='boolean')return v;
 if(typeof v==='number'){if(!finite(v))throw Error('资料含非有限数字');return v}
 if(!Array.isArray(v)&&!plain(v))throw Error('资料必须是普通JSON');
 if(seen.has(v))throw Error('资料不能循环引用');seen.add(v);
 const out=Array.isArray(v)?[]:{};
 for(const key of Object.keys(v)){
  if(['__proto__','prototype','constructor'].includes(key))throw Error('资料含不允许的键');
  const d=Object.getOwnPropertyDescriptor(v,key);
  if(!d||d.get||d.set)throw Error('资料不能包含访问器');
  if(Array.isArray(v)&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=v.length))throw Error('资料数组格式无效');
  if(d.value===undefined&&!Array.isArray(v))continue;
  out[key]=clone(d.value,depth+1,seen);
 }
 if(Array.isArray(v)&&Object.keys(v).length!==v.length)throw Error('资料数组含缺失项');
 seen.delete(v);return out;
}
const canonical=v=>JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x})(v));
export function safeAnnouncementUrl(value,symbol){
 if(typeof value!=='string'||value.trim()!==value)return null;
 const m=/^https:\/\/data\.eastmoney\.com\/notices\/detail\/(\d{6})\/AN\d{18}\.html$/.exec(value);
 return m&&m[0]===value&&(symbol===undefined||symbolOK(symbol)&&m[1]===symbol.slice(0,6))?value:null;
}
export function safeResearchUrl(value,symbol){
 const announcement=safeAnnouncementUrl(value,symbol);if(announcement)return announcement;
 if(typeof value!=='string'||value.trim()!==value)return null;
 const m=/^https:\/\/data\.eastmoney\.com\/bbsj\/(\d{4})(\d{2})\/yjbb\.html$/.exec(value);
 return m&&m[0]===value&&+m[2]>=1&&+m[2]<=12?value:null;
}
function available(item,cutoff){
 const observed=stamp(item?.observedAt);if(observed===null||observed>cutoff)return null;
 const notice=item?.noticeDate;
 if(day(notice)){if(notice>chinaDay(cutoff)||notice>chinaDay(observed))return null;return {availableAt:item.observedAt,availabilityBasis:'observed_at',noticePrecision:'day'}}
 const published=stamp(notice);
 if(published===null||published>cutoff||published>observed)return null;
 return {availableAt:item.observedAt,availabilityBasis:'observed_at',noticePrecision:'timestamp'};
}
function clean(raw,symbol,cutoff){
 const excluded=zero(),reasons=[];let bundle;
 try{
  bundle=clone(raw);
  if(!plain(bundle)||bundle.schema!==1||bundle.symbol!==symbol||!symbolOK(bundle.symbol)||!idOK(bundle.bundleId))throw Error('资料包代码或版本编号不匹配');
  const fetched=stamp(bundle.fetchedAt),asOf=stamp(bundle.asOf);
  if(fetched===null||asOf===null||fetched>cutoff||asOf>cutoff)throw Error('资料包获取时间或截止时间缺失、无效或晚于判断时刻');
 }catch(error){excluded.bundles++;return {valid:false,bundle:null,excluded,reasons:[error.message]}}
 const itemCutoff=Math.min(cutoff,stamp(bundle.fetchedAt),stamp(bundle.asOf));
 let company=plain(bundle.company)?bundle.company:{state:'unavailable',message:'未保存公司资料'};
 const hasCompanyFields=['name','fullName','industry','regulatoryIndustry','exchange','introduction','business','chairman','generalManager','website','location'].some(k=>typeof company[k]==='string'&&company[k].trim());
 if(company.state==='ok'||hasCompanyFields){
  const at=stamp(company.source?.fetchedAt);
  if(at===null||at>itemCutoff||company.symbol&&company.symbol!==symbol){company={state:'insufficient',message:'公司资料获取时间未核验，不能混入当前视图'};excluded.company++;reasons.push('公司资料获取时间缺失或晚于判断时刻')}
 }
 bundle.company=company;
 const financial=plain(bundle.financial)?bundle.financial:{state:'unavailable',reports:[]};
 const reports=Array.isArray(financial.reports)?financial.reports:[];
 if(!Array.isArray(financial.reports)){financial.state='insufficient';reasons.push('财报列表缺失或格式无效')}
 financial.reports=[];
 for(const report of reports){
  const known=plain(report)?available(report,itemCutoff):null;
  if(!known||report.symbol&&report.symbol!==symbol||!day(report.reportDate)||report.reportDate>chinaDay(itemCutoff)||report.reportDate>report.noticeDate.slice(0,10)){excluded.reports++;continue}
  financial.reports.push({...report,...known});
 }
 if(excluded.reports){reasons.push('已排除披露或抓取时刻不能核验的财报');if(financial.state==='ok')financial.state=financial.reports.length?'partial':'insufficient'}
 if(financial.state==='ok'&&!financial.reports.length){financial.state='insufficient';reasons.push('未取得可核验财报')}
 bundle.financial=financial;
 const announcements=plain(bundle.announcements)?bundle.announcements:{state:'unavailable',items:[]};
 const items=Array.isArray(announcements.items)?announcements.items:[];
 if(!Array.isArray(announcements.items)){announcements.state='insufficient';reasons.push('公告列表缺失或格式无效')}
 announcements.items=[];
 for(const item of items){
  const known=plain(item)?available(item,itemCutoff):null,url=known?safeAnnouncementUrl(item.url||item.link,symbol):null;
  if(!known||item.symbol&&item.symbol!==symbol||!url||typeof item.id!=='string'||!item.id||item.id.length>200||typeof item.title!=='string'||!item.title.trim()||item.title.length>2000){excluded.announcements++;continue}
  announcements.items.push({...item,url,...known});
 }
 if(excluded.announcements){reasons.push('已排除时间未核验或链接不安全的公告');if(announcements.state==='ok')announcements.state=announcements.items.length?'partial':'insufficient'}
 bundle.announcements=announcements;
 const state=['company','financial','announcements'].every(k=>bundle[k]?.state==='ok')&&!Object.values(excluded).some(Boolean)?'ok':'partial';
 return {valid:true,bundle,state,excluded,reasons};
}
const result=(state,label,sourceKind='none',bundle=null,canAttach=false,excluded=zero(),reasons=[])=>({bundle,label,state,sourceKind,canAttach,excluded,reasons:[...new Set(reasons)]});
function savedList(record,now){
 const list=[];
 if(record?.original?.research)list.push({raw:record.original.research,at:record.createdAt,kind:'original',index:-1});
 for(const [index,event]of (Array.isArray(record?.events)?record.events:[]).entries())if(event?.snapshot?.research)list.push({raw:event.snapshot.research,at:event.at,kind:'appended',index});
 return list.filter(x=>stamp(x.at)!==null&&stamp(x.at)<=now).sort((a,b)=>stamp(b.at)-stamp(a.at)||b.index-a.index);
}
// observedAt, not noticeDate alone, is the earliest availability this client can prove.
export function selectResearchView({record=null,latest=null,later=false,now=new Date(),symbol}={}){
 const time=now instanceof Date&&finite(now.getTime())?now.getTime():null;
 const target=symbol||record?.symbol||record?.original?.symbol||latest?.symbol;
 if(time===null||!symbolOK(target)||record&&(!plain(record)||record.symbol&&record.symbol!==target||record.original?.symbol&&record.original.symbol!==target))return result('invalid','资料代码或判断时间未通过核验','none',null,false,zero(),['无法确定一致的证券代码和判断时刻']);
 if(record&&!later){
  if(!record.original?.research)return result('not_saved','当时未保存此类资料');
  const cutoff=stamp(record.createdAt);
  if(cutoff===null||cutoff>time)return result('invalid','原记录时间未通过核验','none',null,false,zero(),['原记录保存时间缺失、无效或晚于现在']);
  const checked=clean(record.original.research,target,cutoff);
  return checked.valid?result(checked.state,'当时保存的资料','original',checked.bundle,false,checked.excluded,checked.reasons):result('invalid','当时资料未通过核验','none',null,false,checked.excluded,checked.reasons);
 }
 const saved=record?savedList(record,time):[],warnings=[],priorExcluded=zero();
 if(latest){
  const checked=clean(latest,target,time);
  if(checked.valid){
   const matches=saved.filter(x=>x.raw?.bundleId===checked.bundle.bundleId).map(x=>clean(x.raw,target,stamp(x.at))).filter(x=>x.valid);
   const same=matches.some(x=>canonical(x.bundle)===canonical(checked.bundle)),conflict=matches.some(x=>canonical(x.bundle)!==canonical(checked.bundle));
   if(!conflict)return result(checked.state,same?'当前资料 · 此版本已留档':'当前资料 · 尚未留档',same?'current_saved':'current',checked.bundle,true,checked.excluded,checked.reasons);
   warnings.push('同一资料包编号存在不同内容，不能冒称同一已留档版本');priorExcluded.bundles++;
  }else{warnings.push(...checked.reasons);priorExcluded.bundles+=checked.excluded.bundles}
 }
 for(const candidate of saved){
  const checked=clean(candidate.raw,target,stamp(candidate.at));
  if(!checked.valid){priorExcluded.bundles+=checked.excluded.bundles;warnings.push(...checked.reasons);continue}
  const excluded={...checked.excluded,bundles:checked.excluded.bundles+priorExcluded.bundles};
  return result('partial','旧留档资料 · 非当前更新','saved_fallback',checked.bundle,false,excluded,[...warnings,...checked.reasons,'当前资料不可用，展示最后有效留档']);
 }
 return result(latest?'invalid':'unavailable',latest?'当前资料未通过核验':'当前资料尚不可用','none',null,false,priorExcluded,warnings);
}

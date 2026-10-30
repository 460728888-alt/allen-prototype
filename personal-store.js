const KEY='allen.personal.v1',LIMIT=8*1024*1024,BAD=new Set(['__proto__','constructor','prototype']);
const finite=v=>typeof v==='number'&&Number.isFinite(v),plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v)),fail=m=>{throw Error(m)},check=(v,m)=>{if(!v)fail(m)},str=(v,n=4000)=>typeof v==='string'&&v.length<=n,symbol=v=>typeof v==='string'&&/^\d{6}\.(SS|SZ)$/.test(v),id=v=>typeof v==='string'&&/^[A-Za-z0-9:_-]{1,100}$/.test(v),day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,stamp=v=>str(v,64)&&day(v.slice(0,10))&&v.includes('T')&&Number.isFinite(Date.parse(v));
function copy(v,depth=0,seen=new Set()){
 check(depth<=40,'数据嵌套过深');if(v===null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number'){check(finite(v),'数据含非有限数字');return v}
 check(Array.isArray(v)||plain(v),'只接受普通JSON数据');check(!seen.has(v),'数据不能循环引用');seen.add(v);const out=Array.isArray(v)?[]:{};
 for(const k of Object.keys(v)){check(!BAD.has(k),'数据含不允许的原型键');const d=Object.getOwnPropertyDescriptor(v,k);check(d&&!d.get&&!d.set,'数据不能包含访问器');if(Array.isArray(v))check(/^(0|[1-9]\d*)$/.test(k)&&Number(k)<v.length,'数组格式异常');out[k]=copy(v[k],depth+1,seen)}
 if(Array.isArray(v))check(Object.keys(v).length===v.length,'数组存在缺失项');seen.delete(v);return out;
}
function encode(v){const raw=JSON.stringify(copy(v));check(new TextEncoder().encode(raw).length<=LIMIT,'记录超过8MiB，请先导出备份并分批处理');return raw}
function parse(raw){check(typeof raw==='string'&&new TextEncoder().encode(raw).length<=LIMIT,'数据为空或超过8MiB');let v;try{v=JSON.parse(raw,(k,v)=>{check(!BAD.has(k),'原型键不允许');return v})}catch{fail('JSON格式损坏或含不允许的原型键，原记录未改动')}return copy(v)}
const same=(a,b)=>{const sort=v=>Array.isArray(v)?v.map(sort):plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;return JSON.stringify(sort(a))===JSON.stringify(sort(b))};
const statusOf=events=>events.some(e=>e.type==='closed')?'closed':events.some(e=>e.type==='invalidated')?'invalidated':'observing',empty=()=>({schema:1,updatedAt:null,watchlist:[],research:[],notes:[],portfolio:[],riskBudget:null}),TYPES=new Set(['note','observation','invalidated','closed']),EVENT_KEYS=new Set(['id','at','type','note','snapshot','dataThrough','reason','message']);
function validate(s){
 check(plain(s)&&s.schema===1&&s.riskBudget===null,'仅支持schema 1，风险预算必须待设置');check(Object.keys(s).every(k=>['schema','updatedAt','watchlist','research','notes','portfolio','riskBudget'].includes(k)),'备份含未知字段');check(s.updatedAt===null||s.updatedAt===undefined||stamp(s.updatedAt),'更新时间无效');
 for(const k of ['watchlist','research','notes','portfolio'])check(Array.isArray(s[k]),'备份缺少'+k);
 check(s.watchlist.every(symbol)&&new Set(s.watchlist).size===s.watchlist.length,'股票池代码无效或重复');
 const ids=new Set(),holdings=new Set(),reserve=v=>{check(id(v)&&!ids.has(v),'记录编号无效或重复');ids.add(v)};
 for(const n of s.notes){check(plain(n)&&Object.keys(n).every(k=>['id','symbol','text','createdAt'].includes(k))&&symbol(n.symbol)&&str(n.text)&&n.text.trim()&&stamp(n.createdAt),'笔记格式无效');reserve(n.id)}
 for(const h of s.portfolio){check(plain(h)&&Object.keys(h).every(k=>['symbol','name','quantity','cost'].includes(k))&&symbol(h.symbol)&&str(h.name,200)&&Number.isInteger(h.quantity)&&h.quantity>0&&finite(h.cost)&&h.cost>0,'持仓格式无效');check(!holdings.has(h.symbol),'持仓代码重复');holdings.add(h.symbol)}
 for(const r of s.research){
  check(plain(r)&&Object.keys(r).every(k=>['id','symbol','name','createdAt','dataThrough','strategyVersion','original','events','status'].includes(k))&&symbol(r.symbol)&&str(r.name,200)&&stamp(r.createdAt)&&day(r.dataThrough)&&str(r.strategyVersion,200)&&r.strategyVersion&&plain(r.original)&&Array.isArray(r.events),'研究记录格式无效');reserve(r.id);
  check(r.original.symbol===r.symbol&&r.original.dataThrough===r.dataThrough,'原始条件与研究记录不一致');const dates=new Set();
  for(const e of r.events){
   check(plain(e)&&Object.keys(e).every(k=>EVENT_KEYS.has(k))&&TYPES.has(e.type)&&stamp(e.at),'追加事件格式无效');reserve(e.id);
   if(e.note!==undefined)check(str(e.note)&&e.note.trim(),'追加笔记无效');if(e.type==='note')check(str(e.note)&&e.note.trim(),'笔记不能为空');
   for(const k of ['reason','message'])if(e[k]!==undefined)check(str(e[k]),'事件说明无效');
   if(e.dataThrough!==undefined)check(day(e.dataThrough),'事件数据日期无效');if(e.snapshot!==undefined)check(plain(e.snapshot)&&e.snapshot.symbol===r.symbol,'事件快照股票不一致');
   if(['observation','invalidated'].includes(e.type)){check(day(e.dataThrough)&&plain(e.snapshot)&&e.snapshot.dataThrough===e.dataThrough,'观察事件必须保留快照及截止日期');check(!dates.has(e.dataThrough),'同一研究同日观察重复');dates.add(e.dataThrough)}
  }
  check(r.status===statusOf(r.events),'研究状态与追加事件不一致');
 }
 return s;
}
export function createPersonalStore({storage,now=()=>new Date().toISOString(),uuid=()=>globalThis.crypto.randomUUID()}={}){
 if(storage===undefined)try{storage=globalThis.localStorage}catch{fail('浏览器本地存储不可用')}
 check(storage&&typeof storage.getItem==='function'&&typeof storage.setItem==='function','浏览器本地存储不可用');
 const at=()=>{const v=now();check(stamp(v),'当前保存时间无效');return v};
 function read(){let raw;try{raw=storage.getItem(KEY)}catch{fail('无法读取本地记录，请保留原浏览器数据')}return raw===null?empty():validate(parse(raw))}
 const newId=s=>{let value;try{value=uuid()}catch{fail('无法生成独立编号')}const used=[...s.research.map(r=>r.id),...s.notes.map(n=>n.id),...s.research.flatMap(r=>r.events.map(e=>e.id))];check(id(value)&&!used.includes(value),'无法生成唯一编号，请重试');return value};
 function change(edit){const s=read(),before=JSON.stringify(s),result=edit(s);validate(s);if(JSON.stringify(s)!==before){s.updatedAt=at();const raw=encode(s);try{storage.setItem(KEY,raw)}catch{fail('无法保存到本地：存储不可用或空间不足；原记录未覆盖')}}return copy(result)}
 const normalized=v=>{const x=typeof v==='string'?v:v?.symbol;check(typeof x==='string','股票代码缺失');const code=x.trim().toUpperCase();check(symbol(code),'请使用600036.SS格式的A股代码');return code};
 const find=(s,rid)=>{const r=s.research.find(x=>x.id===rid);check(r,'未找到研究记录');return r};
 function eventFor(s,r,input){const payload=copy(input);check(plain(payload)&&Object.keys(payload).every(k=>EVENT_KEYS.has(k)&&!['id','at'].includes(k)),'事件字段不允许修改编号或时间');check(TYPES.has(payload.type),'事件类型无效');check(r.status==='observing'||payload.type==='note'||(r.status==='invalidated'&&payload.type==='closed'),'已结束研究只能追加笔记');const event={id:newId(s),at:at(),...payload};r.events.push(event);r.status=statusOf(r.events);return r}
 return {
  read,
  addWatch(value){const code=normalized(value);return change(s=>{if(!s.watchlist.includes(code))s.watchlist.push(code);return s.watchlist})},
  removeWatch(value){const code=normalized(value);return change(s=>{s.watchlist=s.watchlist.filter(x=>x!==code);return s.watchlist})},
  addResearch(snapshot){const original=copy(snapshot);return change(s=>{check(plain(original)&&symbol(original.symbol)&&day(original.dataThrough),'研究需股票代码和有效数据截止日期');const version=original.strategyVersion||original.profile?.strategy?.version||original.levels?.version||'unversioned-observation',r={id:newId(s),symbol:original.symbol,name:original.name||original.symbol,createdAt:at(),dataThrough:original.dataThrough,strategyVersion:version,original,events:[],status:'observing'};s.research.push(r);return r})},
  appendEvent(rid,input){return change(s=>eventFor(s,find(s,rid),input))},
  addNote(value,text){const code=normalized(value);return change(s=>{check(str(text)&&text.trim(),'笔记不能为空或超过4000字');const n={id:newId(s),symbol:code,text:text.trim(),createdAt:at()};s.notes.push(n);return n})},
  setHolding(input){const h=copy(input);return change(s=>{h.symbol=normalized(h.symbol);h.name=h.name||h.symbol;check(Object.keys(h).every(k=>['symbol','name','quantity','cost'].includes(k)),'持仓字段无效');const i=s.portfolio.findIndex(x=>x.symbol===h.symbol);if(i<0)s.portfolio.push(h);else s.portfolio[i]=h;return h})},
  removeHolding(value){const code=normalized(value);return change(s=>{s.portfolio=s.portfolio.filter(h=>h.symbol!==code);return s.portfolio})},
  exportJSON(){return encode(read())},
  importJSON(raw,{mode='merge'}={}){
   check(mode==='merge','仅支持合并导入，不允许替换原数据');const incoming=validate(parse(raw));
   return change(s=>{
    const added={watchlistAdded:0,researchAdded:0,notesAdded:0,eventsAdded:0,holdingsAdded:0};
    for(const code of incoming.watchlist)if(!s.watchlist.includes(code)){s.watchlist.push(code);added.watchlistAdded++}
    for(const n of incoming.notes){const old=s.notes.find(x=>x.id===n.id);if(old)check(same(old,n),'笔记编号冲突，整批导入取消');else{s.notes.push(n);added.notesAdded++}}
    for(const h of incoming.portfolio){const old=s.portfolio.find(x=>x.symbol===h.symbol);if(old)check(same(old,h),'已有持仓不同，整批导入取消');else{s.portfolio.push(h);added.holdingsAdded++}}
    for(const r of incoming.research){
     const old=s.research.find(x=>x.id===r.id);if(!old){s.research.push(r);added.researchAdded++;continue}
     const core=x=>({id:x.id,symbol:x.symbol,name:x.name,createdAt:x.createdAt,dataThrough:x.dataThrough,strategyVersion:x.strategyVersion,original:x.original});
     check(same(core(old),core(r)),'原始研究条件冲突，整批导入取消');
     for(const e of r.events){const prev=old.events.find(x=>x.id===e.id);if(prev){check(same(prev,e),'事件编号冲突，整批导入取消');continue}
      const sameDate=['observation','invalidated'].includes(e.type)&&old.events.find(x=>['observation','invalidated'].includes(x.type)&&x.dataThrough===e.dataThrough);
      if(sameDate){const body=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['id','at'].includes(k)));check(same(body(sameDate),body(e)),'同日观察冲突，整批导入取消');continue}
      old.events.push(e);added.eventsAdded++;
     }old.status=statusOf(old.events);
    }
    return added;
   });
  },
  reconcile(market,{expectedThrough=market?.expectedThrough}={}){
   return change(s=>{const result={updated:0,invalidated:0,skipped:0},map=new Map((Array.isArray(market?.stocks)?market.stocks:[]).filter(x=>x&&symbol(x.symbol)).map(x=>[x.symbol,x]));
    for(const r of s.research){const current=map.get(r.symbol),d=current?.dataThrough||current?.data?.dataThrough,data=current?.data,stop=r.original.levels?.invalidation??r.original.levels?.stop,actions=data?.corporateActions;
     const comparable=day(data?.historyStart)&&data.historyStart<=r.dataThrough&&Array.isArray(actions)&&actions.every(a=>plain(a)&&day(a.date))&&!actions.some(a=>a.date>r.dataThrough&&a.date<=d);
     if(r.status!=='observing'||!day(expectedThrough)||d!==expectedThrough||d<r.dataThrough||data?.state!=='ok'||data.complete!==true||!finite(current?.price)||current.price<=0||!finite(stop)||stop<=0||!comparable||r.events.some(e=>['observation','invalidated'].includes(e.type)&&e.dataThrough===d)){result.skipped++;continue}
     const invalid=current.price<=stop;eventFor(s,r,{type:invalid?'invalidated':'observation',dataThrough:d,snapshot:copy({...current,dataThrough:d}),reason:invalid?'完整日线收盘触及原始失效价，原结构假设结束':'追加当前有效完整日线观察；原始条件不改'});result.updated++;if(invalid)result.invalidated++;
    }return result;
   });
  }
 };
}

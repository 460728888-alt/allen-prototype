const text=value=>typeof value==='string'?value.trim():'';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
const reasonsOf=failure=>{
 const message=text(failure?.message);
 return [...new Set((message?message.split(/[；;]/):[text(failure?.code)||'原因未提供']).map(text).filter(Boolean))];
};
export function buildDataHealth(status,stocks,{query='',reason='',page=1,pageSize=25}={}){
 const names=new Map();
 for(const stock of Array.isArray(stocks)?stocks:[]){const symbol=text(stock?.symbol);if(symbol&&!names.has(symbol))names.set(symbol,stock)}
 const bySymbol=new Map(),unattributedFailures=[];
 for(const failure of Array.isArray(status?.failures)?status.failures:[]){
  const symbol=text(failure?.symbol);if(!symbol){unattributedFailures.push(clone(failure));continue}
  const stock=names.get(symbol);let item=bySymbol.get(symbol);
  if(!item){item={symbol,name:text(stock?.name)||symbol,state:null,code:null,codes:new Set(),reasons:new Set(),attempts:[],attemptKeys:new Set(),canOpen:names.has(symbol)};bySymbol.set(symbol,item)}
  item.state=item.state||text(failure?.state)||null;item.code=item.code||text(failure?.code)||null;
  if(text(failure?.code))item.codes.add(text(failure.code));
  for(const value of reasonsOf(failure))item.reasons.add(value);
  const attempts=Array.isArray(failure?.attempts)?failure.attempts:typeof status?.generatedAt==='string'&&status.generatedAt===stock?.generatedAt&&Array.isArray(stock?.source?.attempts)?stock.source.attempts:[];
  for(const attempt of attempts){const key=JSON.stringify(attempt);if(!item.attemptKeys.has(key)){item.attemptKeys.add(key);item.attempts.push(clone(attempt))}}
 }
 const all=[...bySymbol.values()].sort((a,b)=>compare(a.symbol,b.symbol)),counts=new Map();
 for(const item of all)for(const value of item.reasons)counts.set(value,(counts.get(value)||0)+1);
 const groups=[...counts].map(([key,count])=>({key,label:key,count})).sort((a,b)=>b.count-a.count||compare(a.key,b.key));
 const needle=text(query).toLocaleLowerCase(),selected=text(reason);
 const matches=all.filter(item=>(!selected||item.reasons.has(selected))&&(!needle||[item.symbol,item.name,item.state,...item.codes,...item.reasons].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)));
 const size=Number.isInteger(pageSize)&&pageSize>0?pageSize:25,pages=Math.max(1,Math.ceil(matches.length/size)),current=Math.min(Number.isInteger(page)&&page>0?page:1,pages);
 const rows=matches.slice((current-1)*size,current*size).map(item=>({symbol:item.symbol,name:item.name,state:item.state,code:item.code,message:[...item.reasons].join('；'),canOpen:item.canOpen,attempts:item.attempts}));
 return {rows,total:all.length,filtered:matches.length,page:current,pages,groups,sourceFailures:clone(Array.isArray(status?.sourceFailures)?status.sourceFailures:[]),unattributedFailures};
}

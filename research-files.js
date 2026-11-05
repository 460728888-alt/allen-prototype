import fs from 'node:fs';
import path from 'node:path';
const symbol=s=>typeof s==='string'&&/^\d{6}\.(SS|SZ)$/.test(s);
const json=value=>JSON.stringify(value,(key,v)=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error('资料含非有限数值');return v},2)+'\n';
function atomic(directory,relative,value){
 const file=path.join(directory,relative);fs.mkdirSync(path.dirname(file),{recursive:true});
 const temporary=file+'.tmp-'+process.pid;
 fs.writeFileSync(temporary,json(value),{flag:'wx'});fs.renameSync(temporary,file);
}
export function saveResearchFiles(result,directory){
 if(result?.status?.schema!==1||typeof result.status.state!=='string')throw Error('资料状态格式无效');
 const bundles=result.bundles&&typeof result.bundles==='object'?result.bundles:{},values=Object.values(bundles);
 const counts={companies:values.filter(b=>b?.company?.state==='ok'||b?.company?.state==='cached').length,financial:values.filter(b=>Array.isArray(b?.financial?.reports)&&b.financial.reports.length>0).length,announcementItems:values.reduce((n,b)=>n+(Array.isArray(b?.announcements?.items)?b.announcements.items.length:0),0)};
 const usable=counts.companies>0||counts.financial>0||counts.announcementItems>0;
 if(usable){
  if(result.index?.schema!==1||!result.index.symbols||typeof result.index.symbols!=='object')throw Error('资料索引格式无效');
  for(const [code,entry]of Object.entries(result.index.symbols)){
   const b=bundles[code];
   if(!symbol(code)||entry?.path!=='data/research/'+code+'.json'||b?.schema!==1||b.symbol!==code||!b.bundleId||entry.bundleId!==b.bundleId)throw Error('资料包与索引不一致');
  }
  for(const [code,b]of Object.entries(bundles)){
   if(!symbol(code)||b?.symbol!==code||!result.index.symbols[code])throw Error('资料输出包含未知路径或证券');
   json(b);
  }
  json(result.index);
  for(const [code,b]of Object.entries(bundles))atomic(directory,'research/'+code+'.json',b);
  atomic(directory,'research-index.json',result.index);
 }
 const status={...result.status,preservedPrevious:!usable,storedCounts:counts};
 atomic(directory,'research-status.json',status);
 return {status,counts,wroteBundles:usable};
}

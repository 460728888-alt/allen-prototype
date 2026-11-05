import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildResearch} from '../research-build.js';
import {saveResearchFiles} from '../research-files.js';
if(process.env.DATABASE_URL)throw Error('公开研究资料构建禁止携带数据库配置');
const directory=fileURLToPath(new URL('../data/',import.meta.url)),read=file=>JSON.parse(fs.readFileSync(new URL('../data/'+file,import.meta.url),'utf8'));
let result;
try{
 const market=read('market.json'),previousBundles={};
 for(const s of Array.isArray(market.stocks)?market.stocks:[]){
  if(!/^\d{6}\.(SS|SZ)$/.test(s?.symbol||''))continue;
  try{const b=read('research/'+s.symbol+'.json');if(b?.symbol===s.symbol)previousBundles[s.symbol]=b}catch{}
 }
 result=await buildResearch({market,previousBundles,codeSourceCommit:process.env.GITHUB_SHA||null});
}catch(error){
 const generatedAt=new Date().toISOString();
 result={status:{schema:1,state:'failed',generatedAt,codeSourceCommit:process.env.GITHUB_SHA||null,coverage:null,failures:[{code:'build_failed',message:String(error.message).slice(0,240)}],message:'资料获取未完成；保留旧成功包，不表示没有财报或公告'},index:null,bundles:{}};
}
let saved;
try{saved=saveResearchFiles(result,directory)}catch(error){
 const generatedAt=new Date().toISOString();
 saved=saveResearchFiles({status:{schema:1,state:'failed',generatedAt,failures:[{code:'write_failed',message:String(error.message).slice(0,240)}],message:'资料文件核验失败，暂停使用'},index:null,bundles:{}},directory);
}
console.log('PUBLIC_RESEARCH_STATUS='+JSON.stringify(saved.status));
console.log('PUBLIC_RESEARCH_COUNTS='+JSON.stringify(saved.counts));
if(!saved.wroteBundles||process.env.RESEARCH_REQUIRE_CHANNELS==='true'&&!(saved.counts.companies>0&&saved.counts.financial>0&&saved.counts.announcementItems>0))process.exitCode=2;

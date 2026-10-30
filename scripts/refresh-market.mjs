import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMarketCalendar} from '../lib/market-calendar.js';
import {buildMarket} from '../market-build.js';
if(process.env.DATABASE_URL)throw Error('公开数据构建禁止携带数据库配置');
const directory=fileURLToPath(new URL('../data/',import.meta.url));fs.mkdirSync(directory,{recursive:true});
function write(relative,value){
 if(!/^(status|market|calendar)\.json$/.test(relative)&&!/^stocks\/\d{6}\.(SS|SZ)\.json$/.test(relative))throw Error('拒绝不受支持的输出路径');
 const file=path.join(directory,relative);fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.tmp-'+process.pid;fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(temporary,file);
}
const calendar=loadMarketCalendar();if(calendar)write('calendar.json',calendar);let result;
try{result=await buildMarket({calendar,codeSourceCommit:process.env.GITHUB_SHA||null})}
catch(error){result={status:{schema:1,state:'failed',attemptedAt:new Date().toISOString(),generatedAt:new Date().toISOString(),dataThrough:null,expectedThrough:null,codeSourceCommit:process.env.GITHUB_SHA||null,coverage:{targetRequested:1200,poolSize:null,requested:0,returned:0,usable:0,failed:0,stale:0,insufficient:0,observations:0,qualified:null,poolSource:'not_available',fallback:false,notRequested:null},failures:[{code:'build_failed',message:String(error.message).slice(0,240)}],sourceFailures:[],message:'数据构建失败，无法完成判断；旧成功快照未被替换'},market:null,details:{}}}
const usable=result.status.coverage.usable;
if(usable>0&&result.market){for(const [symbol,detail]of Object.entries(result.details))write('stocks/'+symbol+'.json',detail);write('market.json',result.market)}
write('status.json',result.status);console.log('PUBLIC_MARKET_STATUS='+JSON.stringify(result.status));if(!(usable>0))process.exitCode=2;

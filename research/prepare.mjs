import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {assertProtocol,buildSessions} from './dataset.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export function gitBlob(raw){return crypto.createHash('sha1').update('blob '+Buffer.byteLength(raw)+'\0').update(raw).digest('hex');}
export function selectProtocol(template,raw){
 if(gitBlob(raw)!==template.selection.poolGitBlob)throw Error('Frozen pool blob changed; do not silently reselect');
 const market=JSON.parse(raw),pool=market.stocks;
 if(pool?.length!==1200||new Set(pool.map(x=>x.symbol)).size!==1200)throw Error('Frozen 1200 stock snapshot required');
 if(template.coreSymbols?.length!==32||new Set(template.coreSymbols).size!==32)throw Error('Original 32 core must be retained');
 const core=new Set(template.coreSymbols),bySymbol=new Map(template.universe.map(x=>[x.symbol,x]));
 const selected=pool.filter(x=>!core.has(x.symbol)).map(x=>({symbol:x.symbol,name:x.name,key:hash(template.selection.seed+'|'+x.symbol)}))
 .sort((a,b)=>a.key.localeCompare(b.key)||a.symbol.localeCompare(b.symbol)).slice(0,208).map(({key,...x})=>x);
 const universe=[...template.coreSymbols.map(symbol=>bySymbol.get(symbol)||{symbol}),...selected].sort((a,b)=>a.symbol.localeCompare(b.symbol));
 const protocol={...template,universe,selection:{...template.selection,poolDataThrough:market.dataThrough,poolGeneratedAt:market.generatedAt,
  coreOutsidePool:template.coreSymbols.filter(symbol=>!pool.some(x=>x.symbol===symbol))}};
 assertProtocol(protocol);
 return protocol;
}
function main(){
 const root=new URL('./',import.meta.url),template=JSON.parse(fs.readFileSync(new URL('protocol-template.json',root),'utf8'));
 const raw=fs.readFileSync(new URL('../data/market.json',root),'utf8'),calendar=JSON.parse(fs.readFileSync(new URL('calendar.json',root),'utf8'));
 const protocol=selectProtocol(template,raw),sessions=buildSessions(calendar,protocol);
 if(JSON.stringify(sessions)!==JSON.stringify(calendar.sessions))throw Error('Calendar sessions differ from official closure definitions');
 if(sessions.filter(x=>x.startsWith('2024'))[60]!==protocol.shortWarmupFrom)throw Error('Short history warmup mismatch');
 fs.writeFileSync(new URL('protocol.json',root),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
 console.log('FROZEN_LONG_PROTOCOL '+JSON.stringify({id:protocol.id,core:protocol.coreSymbols,universe:protocol.universe.map(x=>x.symbol),
  poolGitBlob:protocol.selection.poolGitBlob,shortWarmupFrom:protocol.shortWarmupFrom,failedDownloadReplacement:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();

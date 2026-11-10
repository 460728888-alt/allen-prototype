import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(process.argv[2] || 'experiment-out');
if (!fs.existsSync(root)) process.exit(0);
const files=[];
function walk(dir) { for (const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
 const full=path.join(dir,e.name);if(e.isDirectory())walk(full);else if(e.name!=='SHA256SUMS')
 files.push(crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')+'  '+path.relative(root,full));
}}
walk(root);fs.writeFileSync(path.join(root,'SHA256SUMS'),files.join('\n')+'\n');
console.log('ARCHIVE_MANIFEST '+files.length+' files');
const reportPath=path.join(root,'training','report.json');
if(fs.existsSync(reportPath)) {
 const r=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 const summary={status:r.status,protocolId:r.protocolId,approved:r.approved,probabilitiesEnabled:r.probabilitiesEnabled,
 finalTestOpened:r.finalTestOpened,successfulCandidates:r.successfulCandidates,coverage:r.coverage,
 coreDevelopmentStockDays:r.coreDevelopmentStockDays,expandedDevelopmentStockDays:r.expandedDevelopmentStockDays,
 regimes:Object.fromEntries(Object.entries(r.regimes||{}).map(([regime,v])=>[regime,{
 counts:v.counts,models:Object.fromEntries(Object.entries(v.models||{}).map(([name,m])=>[name,{
 status:m.status,error:m.error,coreBrier:m.scopes?.core_common?.scores?.brier,
 coreAuc:m.scopes?.core_common?.scores?.rocAuc,coreSignals:m.scopes?.core_common?.selection?.signalStockDays}]))}]))};
 console.log('LONG_ARCHIVE_SUMMARY '+JSON.stringify(summary));
 fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY || path.join(root,'summary.md'),'## 长历史同样本开发比较\n\n此结果不是最终样本外考试，不启用线上概率。完整数据、模型和全部预测见90天临时artifact。\n\n```json\n'+JSON.stringify(summary,null,2)+'\n```\n');
}

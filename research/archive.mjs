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
  finalTestOpened:r.finalTestOpened,coverage:r.coverage,counts:r.counts,
  constantBrier:r.constantBaseline?.scores?.brier,models:Object.fromEntries(Object.entries(r.models||{}).map(([k,v])=>[k,{
   status:v.status,error:v.error,calibration:v.calibration,brier:v.scores?.brier,logLoss:v.scores?.logLoss,
   auc:v.scores?.rocAuc,signals:v.selection?.signalStockDays,
   cost30:v.selection?.costScenarios?.find(x=>x.roundTripBps===30)}]))};
 console.log('TRAINING_SUMMARY '+JSON.stringify(summary));
 fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY || path.join(root,'summary.md'),'## 隔离五日开发实验\n\n此结果不是最终样本外考试，不启用线上概率。完整数据、模型和全部预测见90天临时artifact。\n\n```json\n'+JSON.stringify(summary,null,2)+'\n```\n');
}

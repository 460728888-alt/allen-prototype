import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {saveResearchFiles} from './research-files.js';
const sym='600036.SS',bundle={schema:1,symbol:sym,bundleId:'test-bundle',company:{state:'ok'},financial:{state:'insufficient',reports:[]},announcements:{state:'partial',items:[]}};
const successful=()=>({status:{schema:1,state:'partial',generatedAt:'2026-11-04T08:00:00Z'},index:{schema:1,symbols:{[sym]:{path:'data/research/'+sym+'.json',bundleId:'test-bundle'}}},bundles:{[sym]:structuredClone(bundle)}});
function temp(fn){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'allen-research-'));try{return fn(directory)}finally{fs.rmSync(directory,{recursive:true,force:true})}}
test('failed research acquisition preserves prior successful public files and writes explicit failure status',()=>temp(directory=>{
 saveResearchFiles(successful(),directory);
 const originalIndex=fs.readFileSync(path.join(directory,'research-index.json'),'utf8'),originalBundle=fs.readFileSync(path.join(directory,'research',sym+'.json'),'utf8');
 const result=saveResearchFiles({status:{schema:1,state:'failed',message:'请求失败'},index:null,bundles:{}},directory);
 assert.equal(result.status.preservedPrevious,true);assert.equal(fs.readFileSync(path.join(directory,'research-index.json'),'utf8'),originalIndex);assert.equal(fs.readFileSync(path.join(directory,'research',sym+'.json'),'utf8'),originalBundle);
 assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'research-status.json'),'utf8')).state,'failed');
}));
test('version or path mismatch cannot replace a successful public research snapshot',()=>temp(directory=>{
 saveResearchFiles(successful(),directory);const before=fs.readFileSync(path.join(directory,'research-index.json'),'utf8');
 const invalid=successful();invalid.index.symbols[sym].bundleId='different';
 assert.throws(()=>saveResearchFiles(invalid,directory),/不一致/);assert.equal(fs.readFileSync(path.join(directory,'research-index.json'),'utf8'),before);
 const escaped=successful();escaped.index.symbols[sym].path='../private.json';assert.throws(()=>saveResearchFiles(escaped,directory),/不一致/);assert.equal(fs.existsSync(path.join(directory,'private.json')),false);
}));
test('new public files remain readable after reconstructing the writer and missing metrics do not become zero',()=>temp(directory=>{
 const result=successful();result.bundles[sym].financial={state:'ok',reports:[{metrics:{revenue:null,netProfit:-12,profitGrowth:0}}]};saveResearchFiles(result,directory);
 const restored=JSON.parse(fs.readFileSync(path.join(directory,'research',sym+'.json'),'utf8'));
 assert.equal(restored.financial.reports[0].metrics.revenue,null);assert.equal(restored.financial.reports[0].metrics.netProfit,-12);assert.equal(restored.financial.reports[0].metrics.profitGrowth,0);
 const later=successful();later.bundles[sym].bundleId='next';later.index.symbols[sym].bundleId='next';saveResearchFiles(later,directory);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'research',sym+'.json'),'utf8')).bundleId,'next');
}));

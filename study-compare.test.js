import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildStudyView} from './study-compare.js';
const actualReport=JSON.parse(fs.readFileSync(new URL('./data/history-study.json',import.meta.url),'utf8'));
const clone=v=>JSON.parse(JSON.stringify(v)),fixture=()=>clone(actualReport);
const ids=['all_readable','simple_trend','legacy_observation','legacy_with_prior_trend','price_trigger_only'];
const group=(report,id='legacy_observation')=>report.groups.find(g=>g.id===id);
test('frozen report is readable without becoming a live result or probability',()=>{
 const v=buildStudyView(actualReport);assert.equal(v.state,'ok');assert.equal(v.costBps,30);assert.deepEqual(v.groups.map(g=>g.id),ids);assert.equal(v.selected.id,'legacy_observation');assert.equal(v.winner,null);assert.equal(v.liveOutcomes,null);assert.equal(v.selected.positiveFraction,group(actualReport).grossPositivePriceFraction);assert.equal(v.selected.grossReturn,group(actualReport).dailyEqualWeightMeanPriceReturn);assert.equal(Object.hasOwn(v.selected,'probability'),false);assert.equal(Object.hasOwn(v.selected,'actualTradingReturn'),false);
});
test('input order and a higher positive fraction never choose a winner',()=>{
 const r=fixture();r.groups.reverse();r.winner='legacy_with_prior_trend';const v=buildStudyView(r,{groupId:'legacy_with_prior_trend'});assert.deepEqual(v.groups.map(g=>g.id),ids);assert.equal(v.selected.id,'legacy_with_prior_trend');assert.equal(v.winner,null);assert.equal(v.liveOutcomes,null);assert.ok(v.selected.positiveFraction>.59);assert.ok(v.selected.assumedReturn<0);
});
test('cost choice uses exact stored scenarios and never changes gross differences or quarters',()=>{
 const a=buildStudyView(actualReport,{costBps:0}),b=buildStudyView(actualReport,{costBps:30}),c=buildStudyView(actualReport,{costBps:60}),source=group(actualReport);
 for(const v of [a,b,c]){assert.equal(v.selected.assumedReturn,source.hypotheticalCostScenarios.find(s=>s.roundTripBps===v.costBps).dailyEqualWeightMeanAssumedReturn);assert.equal(v.selected.indexExcess,source.dailyEqualWeightMeanIndexExcess);assert.equal(v.selected.sampleExcess,source.dailyEqualWeightMeanSampleExcess);assert.equal(v.selected.executable,false);assert.equal(v.selected.grossReturn,a.selected.grossReturn);assert.deepEqual(v.selected.interval,a.selected.interval);assert.deepEqual(v.selected.quarters,a.selected.quarters)}
 assert.notEqual(b.selected.assumedReturn,source.dailyEqualWeightMeanPriceReturn-.003);
});
test('missing selected cost stays unknown and does not fall back to gross or zero',()=>{
 const r=fixture(),g=group(r);g.hypotheticalCostScenarios=g.hypotheticalCostScenarios.filter(s=>s.roundTripBps!==30);const v=buildStudyView(r);assert.equal(v.state,'partial');assert.equal(v.selected.assumedReturn,null);assert.equal(v.selected.executable,null);g.hypotheticalCostScenarios.find(s=>s.roundTripBps===0).dailyEqualWeightMeanAssumedReturn=0;assert.equal(buildStudyView(r,{costBps:0}).selected.assumedReturn,0);
});
test('zero stays zero while missing and malformed values remain unknown',()=>{
 const r=fixture(),g=group(r);g.grossPositivePriceFraction=0;g.dailyEqualWeightMeanPriceReturn=0;g.dailyEqualWeightMeanIndexExcess=null;g.dailyEqualWeightMeanSampleExcess='0';g.labelMissing=null;g.distinctSymbols=-1;
 const v=buildStudyView(r);assert.equal(v.selected.positiveFraction,0);assert.equal(v.selected.grossReturn,0);assert.equal(v.selected.indexExcess,null);assert.equal(v.selected.sampleExcess,null);assert.equal(v.selected.labelMissing,null);assert.equal(v.selected.distinctSymbols,null);g.grossPositivePriceFraction=1.01;g.dailyEqualWeightMeanPriceReturn=Infinity;assert.equal(buildStudyView(r).selected.positiveFraction,null);assert.equal(buildStudyView(r).selected.grossReturn,null);
});
test('only reconstructed unapproved summaries with probabilities disabled are accepted',()=>{
 for(const patch of [{approved:true},{approved:undefined},{provenance:'live'},{probabilitiesEnabled:true},{probabilitiesEnabled:undefined},{groups:[]}]){const v=buildStudyView({...fixture(),...patch});assert.equal(v.state,'invalid');assert.deepEqual(v.groups,[]);assert.equal(v.winner,null);assert.equal(v.liveOutcomes,null)}
 for(const costBps of [15,45,'30',null])assert.equal(buildStudyView(actualReport,{costBps}).state,'invalid');assert.equal(buildStudyView(actualReport,{groupId:'unknown'}).state,'invalid');
});
test('duplicate and unknown groups cannot be silently selected or hidden',()=>{
 const duplicate=fixture();duplicate.groups.push(clone(group(duplicate)));assert.equal(buildStudyView(duplicate).state,'invalid');const unknown=fixture();unknown.groups.push({...clone(group(unknown)),id:'new_unapproved_strategy'});assert.equal(buildStudyView(unknown).state,'invalid');
});
test('ambiguous costs or executable scenarios cannot masquerade as assumed costs',()=>{
 const duplicate=fixture();group(duplicate).hypotheticalCostScenarios.push(clone(group(duplicate).hypotheticalCostScenarios[0]));assert.equal(buildStudyView(duplicate).state,'invalid');
 for(const executable of [true,undefined,'false']){const r=fixture();group(r).hypotheticalCostScenarios[0].executable=executable;assert.equal(buildStudyView(r).state,'invalid')}
});
test('interval signs use unrounded values and invalid bounds remain unknown',()=>{
 const r=fixture(),s=group(r).uncertainty.sampleExcess;s.low=-.00001;s.high=.00001;assert.deepEqual(buildStudyView(r).selected.interval,{low:-.00001,high:.00001,crossesZero:true,replicates:s.replicates});s.low=1e-12;s.high=2e-12;assert.equal(buildStudyView(r).selected.interval.crossesZero,false);s.low=.1;s.high=-.1;assert.equal(buildStudyView(r).selected.interval.low,null);assert.equal(buildStudyView(r).selected.interval.high,null);assert.equal(buildStudyView(r).selected.interval.crossesZero,null);s.low=null;s.high=.1;assert.equal(buildStudyView(r).selected.interval.crossesZero,null);s.state='unknown_method';assert.deepEqual(buildStudyView(r).selected.interval,{low:null,high:null,crossesZero:null,replicates:null});
});
test('quarter order is fixed and missing quarters stay unknown',()=>{
 const r=fixture(),g=group(r);g.quarters.reverse();g.quarters=g.quarters.filter(q=>q.quarter!==2);const v=buildStudyView(r);assert.equal(v.state,'partial');assert.deepEqual(v.selected.quarters.map(q=>q.quarter),[1,2,3,4]);assert.deepEqual(v.selected.quarters[1],{quarter:2,dates:null,grossReturn:null,sampleExcess:null});assert.equal(v.selected.quarters[0].grossReturn,g.quarters.find(q=>q.quarter===1).meanPriceReturn);const bad=fixture();group(bad).quarters.push(clone(group(bad).quarters[0]));assert.equal(buildStudyView(bad).state,'invalid');
});
test('coverage copies facts without inventing missing ratios or group rows',()=>{
 const r=fixture();r.coverage.priceLabelCoverage=null;r.coverage.failedStocks=0;r.coverage.benchmarkAvailable=null;r.coverage.exclusionReasons.syntheticUnknown=null;const c=buildStudyView(r).coverage;assert.equal(c.priceLabelCoverage,null);assert.equal(c.failedStocks,0);assert.equal(c.benchmarkAvailable,null);assert.equal(c.exclusionReasons.syntheticUnknown,null);delete r.coverage;assert.equal(buildStudyView(r).coverage,null);
 const partial=fixture();partial.groups=partial.groups.filter(g=>g.id!=='simple_trend');const v=buildStudyView(partial);assert.equal(v.groups[1].available,false);assert.equal(v.groups[1].grossReturn,null);assert.equal(v.groups[1].labelledStockDays,null);
});
test('frozen report remains byte equivalent when changing views and output values',()=>{
 const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v},r=freeze(fixture()),before=JSON.stringify(r),v=buildStudyView(r,{costBps:60});v.selected.grossReturn=99;v.selected.interval.low=99;v.selected.quarters[0].grossReturn=99;v.coverage.exclusionReasons.synthetic=12;assert.equal(JSON.stringify(r),before);
});
test('quarters without any dates are unknown instead of a zero return',()=>{
 const r=fixture(),q=group(r).quarters[0];q.dates=0;q.meanPriceReturn=0;q.meanSampleExcess=0;const v=buildStudyView(r);assert.equal(v.state,'partial');assert.equal(v.selected.quarters[0].dates,0);assert.equal(v.selected.quarters[0].grossReturn,null);assert.equal(v.selected.quarters[0].sampleExcess,null);
});

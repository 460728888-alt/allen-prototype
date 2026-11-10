import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectProtocol,gitBlob} from './prepare.mjs';
const p=JSON.parse(fs.readFileSync(new URL('./protocol.json',import.meta.url),'utf8'));
test('frozen pool hash and original core are enforced before historical requests',()=>{
 const raw=fs.readFileSync(new URL('../data/market.json',import.meta.url),'utf8');
 assert.equal(gitBlob(raw),p.selection.poolGitBlob);
 assert.deepEqual(selectProtocol({...p,universe:p.universe.filter(x=>p.coreSymbols.includes(x.symbol))},raw).universe,p.universe);
 assert.equal(p.universe.length,240);assert(p.coreSymbols.every(s=>p.universe.some(x=>x.symbol===s)));
 assert.throws(()=>selectProtocol(p,raw+' '),/blob changed/);
});

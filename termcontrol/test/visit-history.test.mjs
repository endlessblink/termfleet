import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {VisitHistory} from '../bridge/visits.mjs';
test('explicit owner visits preserve A B A order across devices/restart; output is not use',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-visits-'));try{const file=path.join(dir,'visits.json'),a=new VisitHistory(file),b=new VisitHistory(file);
 assert.deepEqual(a.read('owner'),{});a.record('owner','A',1000);b.record('owner','B',2000);a.record('owner','A',3000);
 assert.deepEqual(b.read('owner'),{A:3000,B:2000});const before=fs.readFileSync(file,'utf8');const background={id:'B',updatedAt:999999,lastActiveAt:999999};assert.equal(background.id,'B');assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.deepEqual(new VisitHistory(file).read('owner'),{A:3000,B:2000});assert.deepEqual(b.read('other-owner'),{});assert.equal(a.record('owner','B',3000),3001,'same-millisecond and backward clocks retain explicit order');
 fs.writeFileSync(file,'broken');assert.throws(()=>a.record('owner','A',4000),/could not be read/);assert.equal(fs.readFileSync(file,'utf8'),'broken','never reset unknown history');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

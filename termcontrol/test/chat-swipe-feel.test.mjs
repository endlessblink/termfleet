import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('native touch releases without a network pause or loading flash and respects flick momentum',()=>{
 const audit=fileURLToPath(new URL('./helpers/chat-swipe-motion-audit.mjs',import.meta.url)),app=fileURLToPath(new URL('../app/index.html',import.meta.url));
 const out=process.env.TC_SWIPE_AUDIT_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'tc-swipe-feel-'));
 execFileSync(process.execPath,[audit,app,out],{timeout:60000,stdio:['ignore','pipe','pipe']});
 const [commit,short,flick,recycled]=JSON.parse(fs.readFileSync(path.join(out,'summary.json'),'utf8'));
 assert.ok(Number.isFinite(commit.releaseMotionDelay) && commit.releaseMotionDelay<80,`release froze for ${Math.round(commit.releaseMotionDelay)}ms`);
 assert.equal(commit.spinnerFrames,0,`${commit.spinnerFrames} exposed loading frames interrupt the handoff`);
 assert.equal(commit.finalHash,'#b');assert.equal(short.finalHash,'#a');assert.equal(flick.finalHash,'#b','a deliberate native flick should carry to the adjacent chat');
 assert.equal(recycled.finalHash,'#a','recycled preview data cannot change the recipient after an earlier inventory check');
});

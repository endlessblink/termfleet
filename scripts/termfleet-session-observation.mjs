#!/usr/bin/env node
import fs from 'node:fs';
import {publishSessionObservation} from './lib/session-event-journal.mjs';
// Internal native publisher only. No HTTP route, provider execution or recovery.
const raw=fs.readFileSync(0,'utf8');
if(Buffer.byteLength(raw)>16384) throw new Error('observation packet too large');
const packet=JSON.parse(raw);
const head=await publishSessionObservation(packet);
if(!head) {process.stdout.write('{"accepted":false}\n');process.exitCode=3;}
else process.stdout.write(JSON.stringify({accepted:true,identity:head.identity,observationSeq:head.state.observationSeq})+'\n');

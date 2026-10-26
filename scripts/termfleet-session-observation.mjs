#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {TextDecoder} from 'node:util';
import {publishSessionObservation,recoverSessionSourcePending,snapshotSessionSourceJournals} from './lib/session-event-journal.mjs';
// Existing internal native pipe. Recovery journals OBSERVED retained originals;
// it cannot approve, acknowledge/forward input, launch a provider or spend.
const bytes=fs.readFileSync(0);
const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
if(packet.operation==='snapshot-session-source-journals'){
 if(bytes.length>16384)throw new Error('snapshot control packet too large');
 if(JSON.stringify(Object.keys(packet).sort())!==JSON.stringify(['operation','paneId','provider'])||typeof packet.paneId!=='string'||!packet.paneId||!['claude','codex'].includes(packet.provider))
  throw new Error('invalid observed snapshot scope');
 process.stdout.write(JSON.stringify(snapshotSessionSourceJournals(packet))+'\n');
}else if(packet.operation==='recover-session-source-pending'){
 if(bytes.length>16384)throw new Error('recovery control packet too large');
 const keys=Object.keys(packet).sort();
 if(JSON.stringify(keys)!==JSON.stringify(['dir','operation','paneId','provider'])||
  !path.isAbsolute(packet.dir??'')||typeof packet.paneId!=='string'||!packet.paneId||
  !['codex','claude','opencode'].includes(packet.provider))throw new Error('invalid private observed recovery scope');
 const result=await recoverSessionSourcePending(packet);
 process.stdout.write(JSON.stringify({version:1,kind:'observed-source-recovery',paneId:packet.paneId,provider:packet.provider,result})+'\n');
 if(!result.ok)process.exitCode=3;
}else{
 const head=await publishSessionObservation(packet);
 if(!head){process.stdout.write('{"accepted":false}\n');process.exitCode=3;}
 else if(head.captureReceipt?.admitted===false){process.stdout.write(JSON.stringify({accepted:false,captureReceipt:head.captureReceipt})+'\n');process.exitCode=3;}
 else process.stdout.write(JSON.stringify({accepted:true,identity:head.identity,observationSeq:head.state.observationSeq})+'\n');
}

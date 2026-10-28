#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import {inspectPaneSend} from '../termcontrol/bridge/send-once.mjs';
// Inspection only. No unlock, resend, terminal input or provider operation.
const args=process.argv.slice(2),pane=args[0];
if(args.length!==1||!pane||pane.length>1024){
 console.error('Usage: node scripts/termfleet-send-inspect.mjs <terminal-id>');process.exitCode=2;
}else{
 const dir=path.join(process.env.TC_CONFIG_DIR||path.join(os.homedir(),'.config','termcontrol'),'send-receipts');
 console.log(JSON.stringify({pane,...inspectPaneSend(dir,pane),recovery:'Inspection only. An active or uncertain lock is never cleared by time or PID absence. Owner-authorized maintenance must quiesce every sender, inspect and reconcile the actual terminal input, and verify this exact lock before release. Creating another draft cannot unlock it.'},null,2));
}

#!/usr/bin/env node
// Rust chooses this bundled static script and the resolved journal job. Nothing
// here creates a broker, keys, access grants, new process or external endpoint.
import {runDaemonBrokerOperation,resolvePrivateLaunchJob} from './lib/daemon-broker-operation.mjs';
import {jsonLinePipe} from './lib/daemon-broker-stdio.mjs';
const pipe=jsonLinePipe();
try{
  const start=pipe.read();
  const result=runDaemonBrokerOperation(start,{resolveJob:resolvePrivateLaunchJob,
    exchange:packet=>{pipe.write(packet);return pipe.read();},emit:packet=>pipe.write(packet)});
  if(!result.ok)process.exitCode=2;
}catch{
  // A failed/truncated pipe is never success and never triggers another call.
  process.exitCode=2;
}

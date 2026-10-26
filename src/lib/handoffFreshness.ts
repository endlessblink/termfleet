import { ownerCheckpoint, observedSourceReady, observedSourceCheckpoint } from '../../scripts/lib/handoff-records.mjs';
export interface HandoffDescriptor { path: string; sha256: string; generation: string }
export type HandoffCheck = {ok:true;sourceSession?:string} | {ok:false;reason:string};
type Read = (path:string) => Promise<string>;
type Observe = (scope:{paneId:string;provider:string}) => Promise<unknown>;
export async function checkHandoffFreshness(descriptor:HandoffDescriptor, provider:string, parentPaneId:string|undefined, read:Read, observe?:Observe):Promise<HandoffCheck> {
  const hash=async (text:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  try {
    const raw=await read(descriptor.path);
    if(await hash(raw)!==descriptor.sha256)return {ok:false,reason:'manifest-digest-mismatch'};
    const m=JSON.parse(raw);
    if(m.version!==1 || m.generation!==descriptor.generation || m.provider!==provider || m.parentPaneId!==(parentPaneId ?? null))return {ok:false,reason:'handoff-binding-mismatch'};
    if(!m.source)return {ok:false,reason:'missing-source'};
    if(m.disclosure?.parseIssues?.length)return {ok:false,reason:'incomplete-source-records'};
    const dir=descriptor.path.slice(0,descriptor.path.lastIndexOf('/'));
    const control=JSON.parse(await read(`${dir}/control.json`));
    if(control.generation!==m.generation)return {ok:false,reason:'control-generation-mismatch'};
    if(control.cancelled)return {ok:false,reason:'handoff-cancelled'};
    for(const f of m.files) {
      if(!/^[a-z0-9-]+\.(md|json|jsonl)$/.test(f.name))return {ok:false,reason:'bad-capsule-file'};
      const text=await read(`${dir}/${f.name}`);
      if(await hash(text)!==f.sha256 || new TextEncoder().encode(text).byteLength!==f.bytes)return {ok:false,reason:'snapshot-digest-mismatch'};
    }
    for (const source of m.sources ?? [m.source]) {
      const current=await read(source.path);
      if(await hash(ownerCheckpoint(provider,current))!==source.ownerSha256)return {ok:false,reason:'owner-records-changed'};
    }
    if(!Array.isArray(m.observedSources)||!m.observedSources.length||!observe)return {ok:false,reason:'missing-observed-source-frontier'};
    if(!m.observedSources.some((c:{scope?:{paneId:string;provider:string;sessionId:string}})=>c.scope?.paneId===parentPaneId&&c.scope?.provider===provider&&c.scope?.sessionId===m.source.sessionId))
      return {ok:false,reason:'observed-source-binding-mismatch'};
    for(const capture of m.observedSources) {
      const snapshot=await observe(capture.scope);
      if(!observedSourceReady(snapshot,capture.scope))return {ok:false,reason:'incomplete-observed-source'};
      if(await hash(observedSourceCheckpoint(snapshot))!==capture.checkpoint)return {ok:false,reason:'observed-source-frontier-changed'};
    }
    const finalControl=JSON.parse(await read(`${dir}/control.json`));
    if(finalControl.cancelled)return {ok:false,reason:'handoff-cancelled'};
    return {ok:true,sourceSession:m.source.sessionId};
  } catch {return {ok:false,reason:'handoff-source-unavailable'};}
}

/** The old pane is archived only after start and the final source fence both succeed. */
export async function finishHandoff(start:()=>Promise<void>, fence:()=>Promise<HandoffCheck>, archive:()=>void):Promise<HandoffCheck> {
  try {await start();} catch {return {ok:false,reason:'start-failed'};}
  const checked=await fence();
  if(!checked.ok)return checked;
  archive();return {ok:true};
}

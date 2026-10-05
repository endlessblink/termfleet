import "./NewAgentTerminalDialog.css";
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { checkAgentProvider } from '../lib/agentProviders';
import { agentFolderPath, agentProjectGroup, newAgentTerminalPosition, prepareAgentFolder } from '../lib/newAgentTerminal';
import { resolveWorkstreamOpsContext } from '../lib/workstreamOpsContext';
import { createAgentWorkstream, createAgentWorkstreamRunId, useWorkspaceStore } from '../stores/workspace';
import type { AgentProvider, WorkstreamIsolationMode, WorkstreamLaunchProfile } from '../lib/types';
import { focusTerminal } from '../lib/terminalNavigationActions';

export function NewAgentTerminalDialog({onClose}:{onClose:()=>void}) {
 const groups=useWorkspaceStore(state=>state.groups);
 const [provider,setProvider]=useState<AgentProvider>('codex');
 const [path,setPath]=useState(()=>useWorkspaceStore.getState().projectRoot??'');
 const [createFolder,setCreateFolder]=useState(false);
 const [name,setName]=useState('');
 const [mission,setMission]=useState('');
 const [isolation,setIsolation]=useState<WorkstreamIsolationMode>('shared-worktree');
 const [profile,setProfile]=useState<WorkstreamLaunchProfile>('terminal');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const formRef=useRef<HTMLFormElement>(null);
 const submitting=useRef(false);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  formRef.current?.querySelector<HTMLElement>('select')?.focus();
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&!submitting.current){event.preventDefault();event.stopImmediatePropagation();onClose();}
   if(event.key==='Tab'){
    const items=Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')??[]);
    const index=items.indexOf(document.activeElement as HTMLElement);
    if(items.length && (index<0 || event.shiftKey&&index===0 || !event.shiftKey&&index===items.length-1)){
     event.preventDefault();items[event.shiftKey?items.length-1:0].focus();
    }
   }
  };
  window.addEventListener('keydown',onKey,true);
  return()=>{window.removeEventListener('keydown',onKey,true);previous?.focus();};
 },[onClose]);
 const browse=async()=>{
  try {const selected=await invoke<string|null>('fs_pick_project_folder',{currentPath:path||null});if(selected)setPath(selected);}catch(error){setError(String(error));}
 };
 const submit=async()=>{
  if(submitting.current)return;
  submitting.current=true;setBusy(true);setError('');
  try {
   if(!mission.trim())throw new Error('Describe what this agent should work on.');
   agentFolderPath({path,createFolder,name});
   if (createFolder && isolation === 'dedicated-worktree') throw new Error('Start a new folder in this project first. A separate worktree requires an existing Git repository.');
   const availability=await checkAgentProvider(provider);
   if(!availability.available)throw new Error(availability.message);
   const folder=await prepareAgentFolder({path,createFolder,name},{list:path=>invoke('fs_list_dir',{path}),create:path=>invoke('fs_create',{path,isDir:true})});
   const createdAt=Date.now(),runId=createAgentWorkstreamRunId(provider,createdAt);
   const selectedContext=await resolveWorkstreamOpsContext(folder,'shared-worktree',runId,createdAt);
   const projectFolder=selectedContext.cwd??folder;
   const context=isolation==='dedicated-worktree' ? await resolveWorkstreamOpsContext(projectFolder,isolation,runId,createdAt) : selectedContext;
   if (isolation==='dedicated-worktree' && context.isolationStatus!=='ready') throw new Error(context.isolationNote??'The separate Git worktree could not be prepared.');
   const store=useWorkspaceStore.getState();
   // Resolve against the chosen folder after the awaits, never a saved active filter.
   const group=agentProjectGroup(projectFolder,store.groups,createFolder);
   const groupId=group?.id??store.addGroup(projectFolder.split('/').filter(Boolean).pop()??'Project',undefined,projectFolder);
   const current=useWorkspaceStore.getState();
   const placement=newAgentTerminalPosition(current.canvasState.nodes,current.tabs,groupId);
   const id=createAgentWorkstream(provider,mission.trim(),availability,context,profile,{groupId,projectCwd:group?.projectRoot??projectFolder,placement});
   current.setWorkspaceMode('canvas');
   onClose();if(id)focusTerminal(id);
  }catch(error){setError(error instanceof Error?error.message:String(error));}
  finally{submitting.current=false;setBusy(false);}
 };
 return <div className="new-agent-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <form ref={formRef} className="new-agent-dialog" role="dialog" aria-modal="true" aria-labelledby="new-agent-title" onSubmit={event=>{event.preventDefault();void submit();}}>
   <h2 id="new-agent-title">New agent terminal</h2>
   <p>Choose where this agent will work. Its terminal joins that project on the map.</p>
   <fieldset disabled={busy}>
    <label>Agent<select value={provider} onChange={event=>setProvider(event.target.value as AgentProvider)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option><option value="shell">Shell</option></select></label>
    <label>Known project<select value={groups.find(group=>group.projectRoot===path)?.id??''} onChange={event=>{const group=groups.find(group=>group.id===event.target.value);if(group?.projectRoot){setPath(group.projectRoot);setCreateFolder(false);}}}><option value="">Choose a folder below</option>{groups.filter(group=>group.projectRoot).map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <label className="new-agent-toggle"><input type="checkbox" checked={createFolder} onChange={event=>setCreateFolder(event.target.checked)}/>Create a new project folder</label>
    <label>{createFolder?'Parent folder':'Project folder'}<span className="new-agent-path"><input aria-label={createFolder?"Parent folder":"Project folder"} required value={path} onChange={event=>setPath(event.target.value)} placeholder="/path/to/project"/><button type="button" onClick={()=>void browse()}>Browse</button></span></label>
    {createFolder&&<label>New folder name<input required value={name} onChange={event=>setName(event.target.value)} placeholder="my-project"/></label>}
    <label>Work to start<input required value={mission} onChange={event=>setMission(event.target.value)} placeholder="What should this agent work on?"/></label>
    <label>Workspace<select value={isolation} onChange={event=>setIsolation(event.target.value as WorkstreamIsolationMode)}><option value="shared-worktree">Use this project</option><option value="dedicated-worktree">Create a separate Git worktree</option></select></label>
    <label>Launch<select value={profile} onChange={event=>setProfile(event.target.value as WorkstreamLaunchProfile)}><option value="terminal">Interactive terminal</option><option value="headless">Headless</option></select></label>
   </fieldset>
   {error&&<p role="alert" className="new-agent-error">{error}</p>}
   <div className="new-agent-buttons"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy?'Opening…':'Open terminal'}</button></div>
  </form>
 </div>;
}

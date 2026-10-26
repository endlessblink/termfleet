import "./NewAgentTerminalDialog.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { checkAgentProvider, type AgentProviderAvailability } from '../lib/agentProviders';
import { agentFolderPath, agentProjectGroup, newAgentTerminalPosition, prepareAgentFolder } from '../lib/newAgentTerminal';
import { resolveWorkstreamOpsContext } from '../lib/workstreamOpsContext';
import { createAgentWorkstream, createAgentWorkstreamRunId, createDefaultTab, useWorkspaceStore } from '../stores/workspace';
import { childStartupCommand } from '../lib/childTerminals';
import type { AgentProvider, WorkstreamIsolationMode, WorkstreamLaunchProfile } from '../lib/types';
import { focusTerminal } from '../lib/terminalNavigationActions';
import { ClaudeCodeMark, CodexMark, OpenCodeMark, ShellPromptMark } from './AgentProviderIdentity';

const AGENTS:Array<{id:AgentProvider;name:string;line:string;mark:ReactNode}>=[
 {id:'claude',name:'Claude',line:'Anthropic’s coding agent',mark:<ClaudeCodeMark size={26}/>},
 {id:'codex',name:'Codex',line:'OpenAI’s coding agent',mark:<CodexMark size={26}/>},
 {id:'opencode',name:'OpenCode',line:'Open-source agent, any model',mark:<OpenCodeMark size={26}/>},
 {id:'shell',name:'Shell',line:'A plain terminal, no agent',mark:<ShellPromptMark size={26}/>},
];
const STEPS=['Agent','Project','Task'] as const;
const LAST_PROVIDER_KEY='termfleet.newAgent.lastProvider';

function rememberedProvider():AgentProvider {
 try {const saved=localStorage.getItem(LAST_PROVIDER_KEY);if(AGENTS.some(agent=>agent.id===saved))return saved as AgentProvider;} catch { /* Private storage falls back to Claude. */ }
 return 'claude';
}
const tail=(path:string)=>path.split('/').filter(Boolean).slice(-3).join('/');

export function NewAgentTerminalDialog({onClose}:{onClose:()=>void}) {
 const groups=useWorkspaceStore(state=>state.groups);
 const projects=useMemo(()=>groups.filter(group=>group.projectRoot),[groups]);
 const [step,setStep]=useState(0);
 const [provider,setProvider]=useState<AgentProvider>(rememberedProvider);
 const [availability,setAvailability]=useState<Partial<Record<AgentProvider,AgentProviderAvailability>>>({});
 const [path,setPath]=useState(()=>useWorkspaceStore.getState().projectRoot??'');
 const [createFolder,setCreateFolder]=useState(false);
 const [filter,setFilter]=useState('');
 // Project folders on disk that are not on the map yet, so every project can be found by name.
 const [folders,setFolders]=useState<string[]>([]);
 const [name,setName]=useState('');
 const [mission,setMission]=useState('');
 const [isolation,setIsolation]=useState<WorkstreamIsolationMode>('shared-worktree');
 const [profile,setProfile]=useState<WorkstreamLaunchProfile>('terminal');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const formRef=useRef<HTMLFormElement>(null);
 const bodyRef=useRef<HTMLFieldSetElement>(null);
 const submitting=useRef(false);
 const agent=AGENTS.find(item=>item.id===provider)!;
 const chosenProject=projects.find(group=>group.projectRoot===path);
 const projectName=createFolder?(name.trim()||'new project'):(chosenProject?.name??(path?path.split('/').filter(Boolean).pop()??'/':''));

 useEffect(()=>{
  let live=true;
  for(const item of AGENTS)void checkAgentProvider(item.id).then(result=>{if(live)setAvailability(current=>({...current,[item.id]:result}));}).catch(()=>{});
  return()=>{live=false;};
 },[]);
 useEffect(()=>{
  let live=true;
  void invoke<string[]>('fs_find_project_folders',{hints:projects.map(group=>group.projectRoot!)}).then(found=>{if(live)setFolders(found);}).catch(()=>{});
  return()=>{live=false;};
  // Scan once per dialog; the map's projects only seed where to look.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&!submitting.current){event.preventDefault();event.stopImmediatePropagation();onClose();}
   if(event.key==='Tab'){
    const items=Array.from(formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=radio]),input[type=radio]:checked:not(:disabled),select:not(:disabled),textarea:not(:disabled)')??[]);
    const index=items.indexOf(document.activeElement as HTMLElement);
    if(items.length && (index<0 || event.shiftKey&&index===0 || !event.shiftKey&&index===items.length-1)){
     event.preventDefault();items[event.shiftKey?items.length-1:0].focus();
    }
   }
  };
  window.addEventListener('keydown',onKey,true);
  return()=>{window.removeEventListener('keydown',onKey,true);previous?.focus();};
 },[onClose]);
 // Each step lands the keyboard on its first decision, so Enter keeps moving forward.
 useEffect(()=>{
  const target=bodyRef.current?.querySelector<HTMLElement>('[data-autofocus]')??bodyRef.current?.querySelector<HTMLElement>('input:checked,input,textarea,button');
  target?.focus({preventScroll:true});
 },[step,createFolder]);

 const browse=async()=>{
  try {const selected=await invoke<string|null>('fs_pick_project_folder',{currentPath:path||null});if(selected)setPath(selected);}catch(error){setError(String(error));}
 };
 const stepError=(index:number):string=>{
  if(index===0){const status=availability[provider];return status&&!status.available?status.message:'';}
  if(index===1){
   try {agentFolderPath({path,createFolder,name});} catch(error){return error instanceof Error?error.message:String(error);}
   return '';
  }
  return mission.trim()?'':'Describe what this agent should work on.';
 };
 const goTo=(target:number)=>{
  for(let index=0;index<target;index+=1){const problem=stepError(index);if(problem){setStep(index);setError(problem);return;}}
  setError('');setStep(target);
 };
 const submit=async()=>{
  if(step<STEPS.length-1){goTo(step+1);return;}
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
   try {localStorage.setItem(LAST_PROVIDER_KEY,provider);} catch { /* Remembering the agent is a convenience only. */ }
   if(profile==='terminal'){
    // An interactive agent is an ordinary terminal card like every other one, started
    // with the task as its first chat message (not an agent-run workstream card).
    // The session starts in the daemon BEFORE the card exists, so the card attaches to
    // the agent instead of mounting a plain shell first.
    const cwd=context.cwd??projectFolder;
    const tab=createDefaultTab({title:`${agent.name}: ${mission.trim()}`.slice(0,120),initialCwd:cwd,projectCwd:group?.projectRoot??projectFolder,groupId});
    const cols=Math.max(40,Math.floor((1180-80)/7.9)),rows=Math.max(12,Math.floor((720-260)/17));
    await invoke('daemon_ensure_session',{id:`terminal-${tab.id}-${tab.activePaneId}`,cwd,command:childStartupCommand(provider,mission.trim()),cols,rows});
    const latest=useWorkspaceStore.getState();
    latest.addTab(tab,placement);
    const after=useWorkspaceStore.getState();
    if(!after.tabs.some(candidate=>candidate.id===tab.id))throw new Error('The terminal could not be opened.');
    after.updateCanvasNode(`terminal-map-${tab.id}`,placement,'workspace-update');
    after.setWorkspaceMode('canvas');
    onClose();focusTerminal(tab.id);
    return;
   }
   const id=createAgentWorkstream(provider,mission.trim(),availability,context,profile,{groupId,projectCwd:group?.projectRoot??projectFolder,placement});
   current.setWorkspaceMode('canvas');
   onClose();if(id)focusTerminal(id);
  }catch(error){setError(error instanceof Error?error.message:String(error));}
  finally{submitting.current=false;setBusy(false);}
 };

 const summaries=[agent.name,projectName||'Choose a folder',mission.trim()?'Ready':''];
 const onMap=new Set(projects.map(group=>group.projectRoot));
 const choices=[...projects.map(group=>({id:group.id,name:group.name,root:group.projectRoot!,color:group.color})),
  ...folders.filter(folder=>!onMap.has(folder)).map(folder=>({id:`folder:${folder}`,name:folder.split('/').filter(Boolean).pop()??folder,root:folder,color:'var(--text-tertiary)'}))];
 const visibleProjects=choices.filter(choice=>!filter.trim()||`${choice.name} ${choice.root}`.toLowerCase().includes(filter.trim().toLowerCase()));
 const segmented=(label:string,value:string,options:Array<[string,string]>,onChange:(value:string)=>void,disabled?:(value:string)=>boolean)=>
  <div className="new-agent-segmented" role="radiogroup" aria-label={label}>
   {options.map(([id,text])=><label key={id} data-checked={value===id||undefined} data-disabled={disabled?.(id)||undefined}>
    <input type="radio" name={label} value={id} checked={value===id} disabled={disabled?.(id)} onChange={()=>onChange(id)}/>{text}
   </label>)}
  </div>;

 return <div className="new-agent-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <form ref={formRef} className="new-agent-dialog" role="dialog" aria-modal="true" aria-labelledby="new-agent-title" onSubmit={event=>{event.preventDefault();void submit();}}>
   <header className="new-agent-head">
    <h2 id="new-agent-title">New agent</h2>
    <ol className="new-agent-steps" aria-label="Steps">
     {STEPS.map((label,index)=><li key={label} data-state={index===step?'current':index<step?'done':'todo'}>
      <button type="button" disabled={busy} aria-current={index===step?'step':undefined} onClick={()=>goTo(index)}>
       <span className="new-agent-step-label">{label}</span>
       <span className="new-agent-step-value">{index<=step||index===0?summaries[index]:' '}</span>
      </button>
     </li>)}
    </ol>
   </header>
   <fieldset disabled={busy} className="new-agent-body" ref={bodyRef}>
    <div key={step} className="new-agent-pane">
    {step===0&&<>
     <p className="new-agent-lede">Who should do the work?</p>
     <div className="new-agent-agents" role="radiogroup" aria-label="Agent">
      {AGENTS.map(item=>{const status=availability[item.id];const missing=status&&!status.available;return <label key={item.id} className="new-agent-agent" data-provider={item.id} data-checked={provider===item.id||undefined} data-missing={missing||undefined}>
       <input type="radio" name="agent" value={item.id} checked={provider===item.id} onChange={()=>{setProvider(item.id);setError('');}} onDoubleClick={()=>goTo(1)} aria-describedby={`agent-line-${item.id}`}/>
       <span className="new-agent-mark" aria-hidden="true">{item.mark}</span>
       <span className="new-agent-agent-text"><span className="new-agent-agent-name">{item.name}</span><span id={`agent-line-${item.id}`} className="new-agent-agent-line">{item.line}</span></span>
       <span className="new-agent-availability" data-state={!status?'checking':missing?'missing':'ready'}>{!status?'Checking':missing?'Not installed':'Ready'}</span>
      </label>;})}
     </div>
    </>}
    {step===1&&<>
     {segmented('Project type',createFolder?'new':'existing',[['existing','Existing project'],['new','New project']],value=>{setCreateFolder(value==='new');setError('');})}
     {!createFolder&&<div className="new-agent-projects">
      {choices.length>6&&<input className="new-agent-filter" aria-label="Find a project" placeholder="Find a project" value={filter} onChange={event=>setFilter(event.target.value)}/>}
      <div className="new-agent-project-list" role="radiogroup" aria-label="Project">
       {visibleProjects.map(choice=><label key={choice.id} className="new-agent-project" data-checked={path===choice.root||undefined}>
        <input type="radio" name="project" value={choice.id} checked={path===choice.root} onChange={()=>{setPath(choice.root);setError('');}} onDoubleClick={()=>goTo(2)}/>
        <span className="new-agent-project-dot" style={{background:choice.color}} aria-hidden="true"/>
        <span className="new-agent-project-name">{choice.name}</span>
        <span className="new-agent-project-path">{tail(choice.root)}</span>
       </label>)}
       {!visibleProjects.length&&<p className="new-agent-empty">{choices.length?'No project matches. Pick its folder below.':'Projects you open on the map appear here. Pick a folder below to start.'}</p>}
      </div>
      <label className="new-agent-field">Project folder<span className="new-agent-path"><input aria-label="Project folder" value={path} onChange={event=>setPath(event.target.value)} placeholder="/path/to/project"/><button type="button" onClick={()=>void browse()}>Browse</button></span></label>
     </div>}
     {createFolder&&<div className="new-agent-new">
      <label className="new-agent-field">New folder name<input data-autofocus value={name} onChange={event=>setName(event.target.value)} placeholder="my-project"/></label>
      <label className="new-agent-field">Parent folder<span className="new-agent-path"><input aria-label="Parent folder" value={path} onChange={event=>setPath(event.target.value)} placeholder="/path/to/projects"/><button type="button" onClick={()=>void browse()}>Browse</button></span></label>
      <p className="new-agent-preview">Creates <span>{path&&name.trim()?`${path.replace(/\/$/,'')}/${name.trim()}`:'a new folder when the agent starts'}</span></p>
     </div>}
    </>}
    {step===2&&<>
     <p className="new-agent-context"><span className="new-agent-mark small" data-provider={provider} aria-hidden="true">{agent.mark}</span>{agent.name}<span className="new-agent-context-in">in</span>{projectName}</p>
     <label className="new-agent-field">Work to start<textarea data-autofocus rows={4} value={mission} onChange={event=>setMission(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void submit();}}} placeholder="What should this agent work on?"/></label>
     <div className="new-agent-options">
      <div className="new-agent-option"><span>Workspace</span>{segmented('Workspace',isolation,[['shared-worktree','This project folder'],['dedicated-worktree','Separate Git worktree']],value=>setIsolation(value as WorkstreamIsolationMode),value=>createFolder&&value==='dedicated-worktree')}</div>
      <div className="new-agent-option"><span>Runs as</span>{segmented('Launch',profile,[['terminal','Interactive terminal'],['headless','Headless']],value=>setProfile(value as WorkstreamLaunchProfile))}</div>
     </div>
    </>}
    </div>
   </fieldset>
   {error&&<p role="alert" className="new-agent-error">{error}</p>}
   <footer className="new-agent-buttons">
    {step>0?<button type="button" className="new-agent-back" disabled={busy} onClick={()=>{setError('');setStep(step-1);}}>Back</button>:<span/>}
    <span className="new-agent-actions">
     <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
     <button type="submit" className="new-agent-primary" disabled={busy}>{step<STEPS.length-1?'Continue':busy?'Starting…':provider==='shell'?'Open terminal':`Start ${agent.name}`}</button>
    </span>
   </footer>
  </form>
 </div>;
}

import fs from 'node:fs';import path from 'node:path';
import { PATHS } from './paths.mjs';
export const PROJECT_PROVIDERS=[{id:'claude',name:'Claude'},{id:'codex',name:'Codex'},{id:'opencode',name:'OpenCode'}];
const normalized=root=>typeof root==='string' && path.isAbsolute(root) && !root.includes('\0')?path.resolve(root):null;
export function projectCatalog(workspace){
 return (workspace?.groups || []).filter(group=>group?.id && normalized(group.projectRoot)).map(group=>({id:group.id,name:group.name || group.id,cwd:normalized(group.projectRoot)}));
}
export function resolveProject(workspace,id){
 if(typeof id!=='string' || !id.trim())throw new Error('Choose a saved project. Refresh the list if it changed.');
 const matches=projectCatalog(workspace).filter(group=>group.id===id);if(matches.length!==1)throw new Error('That project is no longer available. Refresh the list.');
 const project=matches[0];
 if(projectCatalog(workspace).filter(group=>group.cwd===project.cwd).length!==1)throw new Error('That project folder has ambiguous map ownership. Review its projects in TermFleet.');
 try{if(!fs.statSync(project.cwd).isDirectory())throw new Error('not directory');}catch{throw new Error('That project folder is no longer available.');}
 return project;
}
export function projectLaunchArgs(project,provider,taskFile){
 if(!PROJECT_PROVIDERS.some(p=>p.id===provider))throw new Error('Choose an available agent provider.');
 return ['spawn','--provider',provider,'--cwd',project.cwd,'--task-file',taskFile,'--title',`${project.name} · new ${provider}`,'--project-id',project.id,'--no-start-app'];
}
export function legacyProjectChoice(panes,workspace,project){
 const matches=panes.filter(pane=>pane.project===project && pane.cwd && pane.alive!==false);
 if(!matches.length || new Set(matches.map(pane=>pane.cwd)).size!==1 || new Set(matches.map(pane=>pane.mapGroupId)).size!==1 || !matches[0].mapGroupId)throw new Error('That project changed. Refresh and review its current group.');
 const selected=matches[0],catalog=projectCatalog(workspace),saved=catalog.filter(group=>group.id===selected.mapGroupId);
 if(saved.length!==1 || saved[0].cwd!==path.resolve(selected.cwd))throw new Error('That project folder no longer matches its saved map owner.');
 if(catalog.filter(group=>group.cwd===saved[0].cwd).length!==1)throw new Error('That project folder has ambiguous map ownership. Review its projects in TermFleet.');
 return selected;
}
export function projectLaunchReady(file,now=Date.now()){
 try{const capability=JSON.parse(fs.readFileSync(file,'utf8'));return capability.version===2 && Number.isFinite(capability.updatedAt) && now-capability.updatedAt>=0 && now-capability.updatedAt<8000;}catch{return false;}
}
export function projectLaunchCapabilityPath(){return path.join(path.dirname(PATHS.workspace),'child-requests','.project-launch');}

import type { CanvasNode, Group, Tab } from './types';
import { normalizeCwdForSidecar } from './agentStatusSidecar';
export interface AgentFolderRequest { path:string; createFolder:boolean; name:string; }
export interface FolderPorts {
 list(path:string):Promise<Array<{name:string}>>;
 create(path:string):Promise<void>;
}
export function agentFolderPath(request:AgentFolderRequest):string {
 if (/[\x00-\x1f]/.test(request.path+(request.createFolder ? request.name : ""))) throw new Error("Folder paths cannot contain control characters.");
 const path=normalizeCwdForSidecar(request.path.trim());
 if (!path.startsWith('/')||/[\x00-\x1f]/.test(path)) throw new Error('Choose an absolute folder path.');
 if (!request.createFolder) return path;
 const name=request.name.trim();
 if (!name || name==='.' || name==='..' || /[\\/\x00-\x1f]/.test(name)) throw new Error('Enter a single folder name without slashes.');
 return `${path==='/'?'':path}/${name}`;
}
/** No writes on dialog open/cancel; all filesystem work occurs on explicit submit. */
export async function prepareAgentFolder(request:AgentFolderRequest,ports:FolderPorts):Promise<string> {
 const path=agentFolderPath(request);
 const entries=await ports.list(normalizeCwdForSidecar(request.path.trim()));
 if (request.createFolder) {
  if (entries.some(entry=>entry.name===request.name.trim())) throw new Error('That folder name already exists. Choose it as an existing folder instead.');
  await ports.create(path);
  await ports.list(path);
 }
 return path;
}
export function agentProjectGroup(path:string,groups:Group[],newProject=false):Group|undefined {
 const root=normalizeCwdForSidecar(path);
 return groups.filter(group=>{
  const p=normalizeCwdForSidecar(group.projectRoot);
  return p && (p===root || (!newProject&&p!=='/'&&root.startsWith(`${p}/`)));
 }).sort((a,b)=>(b.projectRoot?.length??0)-(a.projectRoot?.length??0))[0];
}
/** Place only the new node; existing maps and the operator's manual order stay put. */
export function newAgentTerminalPosition(nodes:CanvasNode[],tabs:Tab[],groupId:string|null,size={width:1180,height:720}) {
 const gap=48;
 const terminalNodes=nodes.filter(node=>node.type==='terminal');
 const same=new Set(tabs.filter(tab=>groupId!==null&&tab.groupId===groupId).map(tab=>tab.id));
 const siblings=terminalNodes.filter(node=>node.terminalTabId&&same.has(node.terminalTabId));
 const x=siblings.length ? Math.min(...siblings.map(node=>node.x)) : terminalNodes.length ? Math.max(...terminalNodes.map(node=>node.x+node.width))+gap : 0;
 let y=siblings.length ? Math.max(...siblings.map(node=>node.y+node.height))+gap : terminalNodes.length ? Math.min(...terminalNodes.map(node=>node.y)) : 0;
 // Obstructions from another group or notes cannot cause overlap at the new slot.
 for (let attempts=0;attempts<=nodes.length;attempts++) {
  const collisions=nodes.filter(node=>x<node.x+node.width+gap&&x+size.width+gap>node.x&&y<node.y+node.height+gap&&y+size.height+gap>node.y);
  if (!collisions.length) break;
  y=Math.max(...collisions.map(node=>node.y+node.height))+gap;
 }
 return {x,y};
}

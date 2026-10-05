import {test,expect} from '@playwright/test';
import {agentFolderPath,prepareAgentFolder,agentProjectGroup,newAgentTerminalPosition} from '../src/lib/newAgentTerminal';
import type {Tab,CanvasNode,Group} from '../src/lib/types';
const request={path:'/fixture/projects',name:'new-project',createFolder:true};
test('new folders validate one name and perform writes only during prepare',async()=>{
 for(const name of ['', '..', '.', 'a/b', 'a\\b', 'a\n']) expect(()=>agentFolderPath({...request,name})).toThrow();
 expect(agentFolderPath(request)).toBe('/fixture/projects/new-project');
 let writes=0;const reads:string[]=[];
 const ports={list:async(path:string)=>{reads.push(path);return [];},create:async()=>{writes++;}};
 expect(writes).toBe(0);
 expect(await prepareAgentFolder(request,ports)).toBe('/fixture/projects/new-project');
 expect(writes).toBe(1);expect(reads).toEqual(['/fixture/projects','/fixture/projects/new-project']);
});
test('existing folder selection does not create anything; collisions and errors stay visible',async()=>{
 const create=async()=>{throw new Error('Should not write');};
 expect(await prepareAgentFolder({...request,createFolder:false},{list:async()=>[],create})).toBe('/fixture/projects');
 await expect(prepareAgentFolder(request,{list:async()=>[{name:'new-project'}],create})).rejects.toThrow('already exists');
 await expect(prepareAgentFolder(request,{list:async()=>{throw new Error('Parent unreadable');},create})).rejects.toThrow('Parent unreadable');
 await expect(prepareAgentFolder(request,{list:async()=>[],create:async()=>{throw new Error('Permission denied');}})).rejects.toThrow('Permission denied');
});
test('explicit selected folder wins over stale project selection and longest root wins',()=>{
 const groups=[{id:'a',projectRoot:'/fixture'},{id:'b',projectRoot:'/fixture/project'}] as Group[];
 expect(agentProjectGroup('/fixture/project/subfolder',groups)?.id).toBe('b');
 expect(agentProjectGroup('/fixture/project2',groups)?.id).toBe('a');
 expect(agentProjectGroup('/other',groups)).toBeUndefined();
 expect(agentProjectGroup('/fixture/project/new-project',groups,true)).toBeUndefined();
});
const node=(id:string,x:number,y:number,width=1180,height=720)=>({id,type:'terminal',terminalTabId:id,x,y,width,height}) as CanvasNode;
test('project terminals stack beneath siblings without moving existing nodes',()=>{
 const nodes=[node('a',0,0),node('b',0,768),node('other',1300,0)];
 const original=JSON.stringify(nodes);const tabs=[{id:'a',groupId:'p'},{id:'b',groupId:'p'},{id:'other',groupId:'q'}] as Tab[];
 expect(newAgentTerminalPosition(nodes,tabs,'p')).toEqual({x:0,y:1536});
 expect(JSON.stringify(nodes)).toBe(original);
 expect(newAgentTerminalPosition(nodes,tabs,'new')).toEqual({x:2528,y:0});
 expect(newAgentTerminalPosition(nodes,tabs,null)).toEqual({x:2528,y:0});
 expect(newAgentTerminalPosition([],[],null)).toEqual({x:0,y:0});
});
test('new bottom slot avoids an unrelated obstruction, including custom-sized nodes',()=>{
 const nodes=[node('a',0,0,1400,1000),node('other',0,1048)];
 expect(newAgentTerminalPosition(nodes,[{id:'a',groupId:'p'},{id:'other',groupId:'q'}] as Tab[],'p')).toEqual({x:0,y:1816});
});

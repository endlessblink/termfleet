export type StackState='producing'|'working'|'needs-you'|'idle'|'exited';
export type StackMember='builder'|'editor'|'designer'|'planner'|'researcher'|'communicator'|'writer'|'operator'|'coordinator'|'maker'|'strategist'|'explorer';
export interface AvatarOptions { id?:string; member?:StackMember; state?:StackState; projectColor?:string|null; size?:number; label?:string; compact?:'auto'|boolean; decorative?:boolean; theme?:'inherit'|'light'|'dark'; }
export type AvatarPatch=Omit<AvatarOptions,'id'|'member'>;
export function create(options?:AvatarOptions):SVGSVGElement;
export function update(svg:SVGSVGElement,patch?:AvatarPatch):SVGSVGElement;
export function toString(options?:AvatarOptions):string;
export function projectColorForId(projectId:string):string;
export const memberIds:readonly StackMember[];
export const memberMeta:readonly {readonly id:StackMember;readonly name:string}[];
export const states:readonly StackState[];
export const stateNames:Readonly<Record<StackState,string>>;
export const palette:Readonly<Record<'sage'|'blue'|'lilac'|'teal'|'ochre',string>>;
export const version:string;
declare const StackAvatars:{create:typeof create;update:typeof update;toString:typeof toString;memberIds:typeof memberIds;memberMeta:typeof memberMeta;states:typeof states;stateNames:typeof stateNames;palette:typeof palette;projectColorForId:typeof projectColorForId;version:typeof version};
export default StackAvatars;
export as namespace StackAvatars;

(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StackAvatars=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const MEMBERS=__MEMBERS__;
const states=Object.freeze(['producing','working','needs-you','idle','exited']);
const stateNames=Object.freeze({'producing':'Producing output','working':'Working','needs-you':'Needs you','idle':'Idle','exited':'Exited'});
const palette=Object.freeze({sage:'#97ad9a',blue:'#8ca9c4',lilac:'#afa0c6',teal:'#80b5af',ochre:'#c6b777'});
const map=new Map(MEMBERS.map(m=>[m.id,m]));
const memberIds=Object.freeze(MEMBERS.map(m=>m.id));
const memberMeta=Object.freeze(MEMBERS.map(m=>Object.freeze({id:m.id,name:m.name})));
const registry=new WeakMap();
const allowed=new Set(['id','member','state','projectColor','size','label','compact','decorative','theme']);
const defaults=Object.freeze({id:'anonymous',member:'builder',state:'idle',projectColor:null,size:48,label:'',compact:'auto',decorative:false,theme:'inherit'});
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function projectColorForId(id){if(typeof id!=='string'||!id)throw new TypeError('project id must be a nonempty string');const colors=Object.values(palette);return colors[hash(id)%colors.length];}
function escape(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function normalize(input,previous){
 if(input===undefined)input={};
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('options must be an object');
 for(const key of Object.keys(input))if(!allowed.has(key))throw new TypeError('Unknown option: '+key);
 const o=Object.assign({},previous||defaults,input);
 if(typeof o.id!=='string'||!o.id||o.id.length>128)throw new TypeError('id must be a nonempty string of at most 128 characters');
 if(typeof o.member!=='string'||!map.has(o.member))throw new RangeError('Unknown member');
 if(typeof o.state!=='string'||!states.includes(o.state))throw new RangeError('Unknown state');
 if(typeof o.size!=='number'||!Number.isFinite(o.size)||o.size<12||o.size>256)throw new RangeError('size must be a finite number from 12 to 256');
 if(typeof o.label!=='string'||o.label.length>200)throw new TypeError('label must be a string of at most 200 characters');
 if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(o.label)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(o.label))throw new TypeError('label contains XML-invalid characters');
 if(o.compact!=='auto'&&typeof o.compact!=='boolean')throw new TypeError('compact must be auto or boolean');
 if(typeof o.decorative!=='boolean')throw new TypeError('decorative must be boolean');
 if(!['inherit','light','dark'].includes(o.theme))throw new RangeError('theme must be inherit, light or dark');
 if(o.projectColor!==null){
  if(typeof o.projectColor!=='string'||!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(o.projectColor))throw new TypeError('projectColor must be a hex color or null');
  const c=o.projectColor.toLowerCase();o.projectColor=c.length===4?'#'+c.slice(1).split('').map(x=>x+x).join(''):c;
  if(o.projectColor==='#d97757')throw new RangeError('Terracotta is reserved for Needs you, not project identity');
 }
 if(previous&&(o.id!==previous.id||o.member!==previous.member))throw new TypeError('id and member are immutable; create a new avatar for a new identity');
 return Object.freeze(o);
}
function detail(o){return (o.compact===true||(o.compact==='auto'&&o.size<=36))?'compact':'full';}
function label(o){return (o.label||map.get(o.member).name)+': '+stateNames[o.state];}
function eyes(m,state){
 const [x,y,w,h]=m.face;const a=x+w*.30,b=x+w*.72,ey=y+h*.49;const ew=Math.max(3.4,w*.19),eh=Math.max(2.5,h*.17);
 const num=n=>Number(n.toFixed(2));
 const pill=(cx)=>`M${num(cx-ew/2)} ${num(ey)}H${num(cx+ew/2)}Q${num(cx+ew/2)} ${num(ey+eh)} ${num(cx)} ${num(ey+eh)}Q${num(cx-ew/2)} ${num(ey+eh)} ${num(cx-ew/2)} ${num(ey)}Z`;
 let gaze;
 if(state==='idle'||state==='exited')gaze=`<path class="stack-feature-line" d="M${num(a-ew/2)} ${num(ey+1)}Q${num(a)} ${num(ey+3)} ${num(a+ew/2)} ${num(ey+1)}M${num(b-ew/2)} ${num(ey+1)}Q${num(b)} ${num(ey+3)} ${num(b+ew/2)} ${num(ey+1)}"/>`;
 else if(state==='needs-you')gaze=`<path class="stack-feature" d="${pill(a)}${pill(b)}"/><path class="stack-feature-line" d="M${num(b-ew/2)} ${num(ey-3)}Q${num(b)} ${num(ey-5)} ${num(b+ew/2)} ${num(ey-3)}"/>`;
 else gaze=`<path class="stack-feature" d="${pill(a)}${pill(b)}"/>`;
 const mx=x+w*.52,my=y+h*.79,mw=Math.max(4,w*.25);
 gaze+=`<path class="stack-feature-line stack-mouth" d="M${num(mx-mw/2)} ${num(my)}${state==='exited'?`H${num(mx+mw/2)}`:`Q${num(mx)} ${num(my+2.8)} ${num(mx+mw/2)} ${num(my)}`}"/>`;
 return `<g class="stack-face stack-face--${state}">${gaze}</g>`;
}
function content(o){const m=map.get(o.member);return `<title>${escape(label(o))}</title><g class="stack-character"><g class="stack-body">${m.anatomy}${states.map(s=>eyes(m,s)).join('')}</g></g><g class="stack-status" aria-hidden="true"><circle class="stack-status-bg" cx="56" cy="56" r="8"/><g class="stack-mark stack-mark--producing"><path class="stack-tick stack-tick--one" d="M51 59V55"/><path class="stack-tick stack-tick--two" d="M56 59V52"/><path class="stack-tick stack-tick--three" d="M61 59V54"/></g><g class="stack-mark stack-mark--working"><path class="stack-orbit" d="M59.5 51.5A5.7 5.7 0 1 0 61.4 57"/></g><g class="stack-mark stack-mark--needs-you"><path d="M56 51V56M56 60V60.1"/></g><g class="stack-mark stack-mark--idle"><path d="M52 56H60"/></g><g class="stack-mark stack-mark--exited"><path d="M53 53 59 59M59 53 53 59"/></g></g>`;}
function style(o){const m=map.get(o.member);return `--stack-crop-transform:${m.crop};--stack-phase:-${hash(o.id)%1200}ms`+(o.projectColor?`;--stack-project-color:${o.projectColor}`:'');}
function serialize(o){return `<svg xmlns="http://www.w3.org/2000/svg" class="stack-avatar" width="${o.size}" height="${o.size}" viewBox="0 0 64 64" data-member="${o.member}" data-state="${o.state}" data-detail="${detail(o)}" data-theme="${o.theme}" style="${style(o)}" ${o.decorative?'aria-hidden="true"':`role="img" aria-label="${escape(label(o))}"`}>${content(o)}</svg>`;}
function set(svg,name,value){if(svg.getAttribute(name)!==String(value))svg.setAttribute(name,String(value));}
function apply(svg,o,prev){
 set(svg,'data-state',o.state);set(svg,'data-detail',detail(o));set(svg,'data-theme',o.theme);set(svg,'width',o.size);set(svg,'height',o.size);
 if(!prev||o.projectColor!==prev.projectColor){if(o.projectColor===null)svg.style.removeProperty('--stack-project-color');else svg.style.setProperty('--stack-project-color',o.projectColor);}
 if(o.decorative){set(svg,'aria-hidden','true');svg.removeAttribute('role');svg.removeAttribute('aria-label');}else{svg.removeAttribute('aria-hidden');set(svg,'role','img');set(svg,'aria-label',label(o));}
 if(!prev||label(o)!==label(prev)){const title=svg.querySelector('title');if(title)title.textContent=label(o);}
}
function create(input){const o=normalize(input);if(typeof document==='undefined')throw new Error('create requires a DOM; use toString on the server');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');set(svg,'class','stack-avatar');set(svg,'viewBox','0 0 64 64');set(svg,'data-member',o.member);svg.innerHTML=content(o);svg.style.setProperty('--stack-crop-transform',map.get(o.member).crop);svg.style.setProperty('--stack-phase',`-${hash(o.id)%1200}ms`);apply(svg,o);registry.set(svg,o);return svg;}
function update(svg,patch){const old=registry.get(svg);if(!old)throw new TypeError('update requires an SVG returned by create');const o=normalize(patch,old);if(Object.keys(o).every(k=>o[k]===old[k]))return svg;apply(svg,o,old);registry.set(svg,o);return svg;}
function toString(options){return serialize(normalize(options));}
return Object.freeze({create,update,toString,memberIds,memberMeta,states,stateNames,palette,projectColorForId,version:'0.1.0-preview'});
});

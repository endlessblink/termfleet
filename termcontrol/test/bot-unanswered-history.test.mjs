import test from 'node:test';
import assert from 'node:assert/strict';
import { Bots } from '../bridge/bots.mjs';

const q=(id,text)=>({id,role:'bot',text:'',question:{text,options:['Yes','No']}});
const tail=()=>Array.from({length:310},(_,i)=>({id:'later-'+i,role:'bot',text:'Progress '+i}));
function view(messages){return Bots.prototype.view.call({read:()=>({}),messages:()=>messages,running:new Set(),queues:new Map(),summary:()=>({})},'fixture').messages;}
test('history window preserves original open questions, not resolved, withdrawn or repeated cards',()=>{
 const rows=[q('open','Which independent scope should continue?'),
 q('answered','May I publish the separate artifact?'),{id:'answer',role:'operator',answerTo:'answered',text:'Yes'},
 q('consumed','May I remove the obsolete artifact?'),{id:'deleted-consumed',role:'operator',answerTo:'consumed',text:'Yes',deleted:{cancelled:false}},
 q('withdrawn','Which palette should be selected?'),{id:'withdraw',role:'bot',text:'Ignore the question above.'},
 q('cancelled','May I start the independent check?'),{id:'deleted-cancelled',role:'operator',answerTo:'cancelled',text:'Yes',deleted:{cancelled:true}},q('repeat-old','Select a reporting timezone for tomorrow?'),q('repeat-new','Select a reporting timezone for tomorrow?'),...tail()];
 // Withdrawal only reaches back to the most recent operator reply, so preserve a separate older question.
 const result=view(rows);
 assert.ok(result.some(m=>m.id==='open'),'old original open question is returned');
 assert.ok(result.some(m=>m.id==='cancelled'&&!m.withdrawn),'cancelled answer allows original question to remain open');
 for(const id of ['answered','consumed','withdrawn','repeat-old'])assert.equal(result.some(m=>m.id===id),false,id+' must not reopen');
 assert.equal(result.filter(m=>m.id==='open').length,1);
 assert.equal(result.filter(m=>m.id==='repeat-new').length,1,'only current original repeated-question identity is retained');
});
test('trimming history cannot remove the operator barrier before a later withdrawal',()=>{
 const rows=[q('old-open','Which independent branch should remain?'),{id:'barrier',role:'operator',text:'An unrelated update'},...tail(),{id:'late-withdrawal',role:'bot',text:'Ignore the question above.'}];
 assert.equal(view(rows).find(m=>m.id==='old-open')?.withdrawn,undefined);
});
test('long answered history does not copy every full remaining suffix',()=>{
 let copied=0;const rows=Array.from({length:2000},(_,i)=>i%2?q('q'+i,'Question '+i):{id:'operator'+i,role:'operator',text:'Barrier'});
 rows.slice=function(...args){const out=Array.prototype.slice.apply(this,args);copied+=out.length;return out;};
 view(rows);assert.ok(copied<10000,'full-history classification copied '+copied+' entries');
});

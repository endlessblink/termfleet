import test from 'node:test';
import assert from 'node:assert/strict';
import { botAttention } from '../app/bot-attention.mjs';

test('real reconciled question shows exact text and original target',()=>{
  const result=botAttention({state:'idle'},{questions:[{id:'q-original',kind:'bot',text:'Which version do you want?'}]});
  assert.equal(result.kind,'question');assert.deepEqual(result.text,['Which version do you want?','Which version do you want?']);assert.deepEqual(result.target,{id:'q-original',kind:'bot'});
  assert.deepEqual(botAttention({state:'working'},{questions:[{id:'terminal-original',kind:'terminal',text:'Allow edit?'}]}).target,{id:'terminal-original',kind:'terminal'});
});
test('answered, dismissed and ready history alone cannot create attention',()=>{
  for(const state of ['idle','pending','ready'])assert.equal(botAttention({state,requirements:[{status:'ready'}]},{questions:[],messages:[{id:'old',role:'needs-you',text:'Old request',at:1},{id:'q',role:'bot',question:{text:'Old?'},questionResolution:{state:'dismissed'}}],full:true}),null);
});
test('exact helper lifecycle failure is verification status, never an owner question',()=>{
  const reason='Codex lifecycle record exceeds the safe read bound.';
  const result=botAttention({state:'needs-you',blocked:null,helperDelivery:{unresolved:0,sources:[reason]}},{questions:[],messages:[],full:true});
  assert.equal(result.kind,'status');assert.equal(result.label[0],'Update not verified');assert.equal(result.target,null);assert.ok(result.details.includes(reason));assert.doesNotMatch(result.text[0],/answer|approval/i);
});
test('unresolved helper update without technical source is still status',()=>{
  assert.equal(botAttention({state:'needs-you',helperDelivery:{unresolved:2,sources:[]}}).label[0],'Update not verified');
});
test('blocked ask uses only matching current needs-you message, never historic target',()=>{
  const bot={state:'needs-you',blocked:{ask:'Please choose the folder.',at:20}};
  let result=botAttention(bot,{messages:[{id:'old',role:'needs-you',text:'Please choose the folder.',at:10}],full:true});
  assert.equal(result.kind,'blocked');assert.equal(result.label[0],'Needs you');assert.equal(result.target,null);assert.ok(result.details.length);
  result=botAttention(bot,{messages:[{id:'old',role:'needs-you',text:'Please choose the folder.',at:10},{id:'current',role:'needs-you',text:'Please choose the folder.',at:20}]});
  assert.deepEqual(result.target,{id:'current',kind:'blocked'});assert.equal(result.text[0],bot.blocked.ask);
});
test('missing helper question explicitly says it is unavailable',()=>{
  const result=botAttention({state:'needs-you',helpersAsking:1});assert.equal(result.label[0],'Question unavailable');assert.equal(result.kind,'status');assert.equal(result.target,null);assert.match(result.text[0],/not attached/i);
});
test('bare stale needs-you does not invent an answer or question',()=>{
  const result=botAttention({state:'needs-you'},{messages:[],questions:[],full:true});assert.equal(result.label[0],'Status needs checking');assert.equal(result.kind,'status');assert.equal(result.target,null);assert.ok(result.details.length);
});
test('working alone and historical blocked ask do not create a blocking badge',()=>{
  assert.equal(botAttention({state:'working'}),null);assert.equal(botAttention({state:'working',blocked:{ask:'Old ask',at:1}},{messages:[{id:'old',role:'needs-you',text:'Old ask',at:1}]}),null);
});
test('missing, whitespace and malformed strings are handled without invented text',()=>{
  assert.equal(botAttention(null),null);assert.equal(botAttention({state:'idle'},{questions:[{id:'q',kind:'bot',text:'   '}]}),null);
  assert.equal(botAttention({state:'idle',helperDelivery:{sources:[null,{},' ']}}),null);
  const result=botAttention({state:'needs-you',blocked:{ask:' '}});assert.equal(result.kind,'status');assert.notEqual(result.kind,'blocked');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { closedChatGroups,setChatGroupClosed,attentionStatusKey,dismissedAttention,dismissAttention,resetDismissedAttention } from '../app/chat-view-state.mjs';
const A='aaaaaaaaaaaa',B='bbbbbbbbbbbb';
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};}
const status={kind:'status',label:['Update not verified','עדכון לא אומת'],text:['Cannot check update','לא ניתן לבדוק'],details:['Safe read bound exceeded.']};
const bot={id:A,helperDelivery:{unresolved:1,sources:['Safe read bound exceeded.'],resultId:'result-one',updatedAt:10}};
test('group close and reopen preserve exact IDs across reload',()=>{
  const s=storage();assert.equal(setChatGroupClosed(s,A,true),true);setChatGroupClosed(s,B,true);setChatGroupClosed(s,A,true);
  assert.deepEqual(closedChatGroups({...s}),[A,B]);assert.equal(setChatGroupClosed(s,A,false),true);assert.deepEqual(closedChatGroups(s),[B]);assert.throws(()=>setChatGroupClosed(s,'../invalid',true));
});
test('malformed saved IDs and unavailable reads cannot create closed groups',()=>{
  const s=storage();setChatGroupClosed(s,A,true);const key=[...s.data.keys()][0];s.setItem(key,JSON.stringify([A,'invalid',null,A,B]));assert.deepEqual(closedChatGroups(s),[A,B]);
  s.setItem(key,'broken json');assert.deepEqual(closedChatGroups(s),[]);assert.deepEqual(closedChatGroups(null),[]);assert.deepEqual(closedChatGroups({getItem(){throw Error('Denied');}}),[]);
});
test('status dismissal survives reload but new result or source recurs',()=>{
  const s=storage(),key=attentionStatusKey(bot,status);assert.ok(key);dismissAttention(s,A,key);assert.equal(dismissedAttention({...s},A,key),true);
  assert.equal(attentionStatusKey({...bot,activity:'Working',unread:9,lastAt:999},status),key);
  for(const helperDelivery of [{...bot.helperDelivery,resultId:'result-two'},{...bot.helperDelivery,updatedAt:11},{...bot.helperDelivery,sources:['A different failure.']}])assert.equal(dismissedAttention(s,A,attentionStatusKey({...bot,helperDelivery},status)),false);
});
test('fingerprint is stable for object key order and changes with current status text',()=>{
  const key=attentionStatusKey(bot,status);assert.equal(attentionStatusKey({helperDelivery:{updatedAt:10,resultId:'result-one',sources:['Safe read bound exceeded.'],unresolved:1},id:A},status),key);
  assert.notEqual(attentionStatusKey(bot,{...status,details:['New failure.']}),key);
});
test('resolved status resets prior dismissal and leaves other bot untouched',()=>{
  const s=storage(),key=attentionStatusKey(bot,status);dismissAttention(s,A,key);dismissAttention(s,B,key);resetDismissedAttention(s,A);
  assert.equal(dismissedAttention(s,A,key),false);assert.equal(dismissedAttention(s,B,key),true);resetDismissedAttention(s,B);assert.equal(dismissedAttention(s,B,key),false);
});
test('real questions and approvals have no dismissal key',()=>{
  for(const kind of ['question','blocked'])assert.equal(attentionStatusKey(bot,{...status,kind}),null);
  assert.equal(attentionStatusKey(bot,null),null);assert.equal(dismissedAttention(storage(),A,null),false);assert.throws(()=>dismissAttention(storage(),A,null));
});
test('failed persistence is reported rather than claiming success',()=>{
  const s={getItem:()=>null,setItem(){throw Error('Quota exceeded');},removeItem(){throw Error('Denied');}},key=attentionStatusKey(bot,status);
  assert.throws(()=>setChatGroupClosed(s,A,true),/Quota/);assert.throws(()=>dismissAttention(s,A,key),/Quota/);assert.throws(()=>resetDismissedAttention(s,A),/Denied/);
  assert.throws(()=>setChatGroupClosed(null,A,true));assert.equal(dismissedAttention(null,A,key),false);
  const unreadable={getItem(){throw Error('Read denied');},setItem(){assert.fail('Must not overwrite unknown preferences');},removeItem(){assert.fail('Must not remove unknown preferences');}};
  assert.throws(()=>setChatGroupClosed(unreadable,A,true),/Read denied/);assert.throws(()=>dismissAttention(unreadable,A,key),/Read denied/);assert.throws(()=>resetDismissedAttention(unreadable,A),/Read denied/);
});

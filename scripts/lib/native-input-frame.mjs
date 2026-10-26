// Validate a complete frame already attested by the existing ingress authority.
// This module neither authenticates a human nor creates a signer/trust root.
import {canonical,digest} from './paid-action-broker.mjs';
import {QUESTION_INPUT_TOOLS} from './handoff-records.mjs';

const requireFrame=(condition,message)=>{if(!condition)throw Error(message);};
// Inspect structured provider result wrappers only; answer text is never a verdict.
const providerResultError=value=>{
  if(!value||typeof value!=='object')return false;
  if(Array.isArray(value))return value.some(providerResultError);
  return Boolean(value.error||value.is_error||value.isError)||
    ['message','payload','result','rawResult','content'].some(key=>providerResultError(value[key]));
};
export const nativeOwnershipValid=value=>value && typeof value.ptyId==='string' && value.ptyId.length>0 &&
  Number.isSafeInteger(value.pid) && value.pid>0 && typeof value.runId==='string' && value.runId.length>0;
export function validateProviderQuestion(provider,question) {
  requireFrame(question && typeof question.frameText==='string' &&
    Buffer.byteLength(question.frameText)===question.frameBytes && digest(question.frameText)===question.frameSha256,
    'provider-question-frame-incomplete');
  let captured;try{captured=JSON.parse(question.frameText);}catch{throw Error('provider-question-frame-unresolved');}
  requireFrame(!providerResultError(captured),
    'provider-question-error-frame');
  const calls=provider==='claude'&&captured.type==='assistant'?captured.message?.content:
    provider==='codex'&&captured.type==='response_item'?[captured.payload]:[];
  const call=Array.isArray(calls)?calls.find(c=>provider==='claude'
    ?c?.type==='tool_use'&&c.id===question.callId:c?.type==='function_call'&&c.call_id===question.callId):null;
  let input=call?.input;
  if(call?.type==='function_call')try{input=JSON.parse(call.arguments);}catch{throw Error('provider-question-call-unresolved');}
  requireFrame(call && QUESTION_INPUT_TOOLS.includes(call.name) && call.name===question.toolName &&
    canonical(input)===canonical(question.question),'provider-question-call-mismatch');
  return {callId:question.callId,toolName:call.name,question:input,frameSha256:question.frameSha256,frameBytes:question.frameBytes};
}
export const providerQuestionOwnership=(providerBindingHash,route,question)=>digest({providerBindingHash,
  logicalRouteSession:route.logicalRouteSession,actualSession:route.actualSession,ownership:route.ownership,
  callId:question.callId,toolName:question.toolName,frameSha256:question.frameSha256,frameBytes:question.frameBytes});
export function validateProviderTaskDelivery(task,delivery) {
  requireFrame(task && typeof task.text==='string' && task.text.length>0 &&
    task.bytes===Buffer.byteLength(task.text) && task.sha256===digest(task.text),'provider-startup-task-incomplete');
  requireFrame(delivery?.kind==='provider-task' && typeof delivery.wireBase64==='string',
    'provider-startup-delivery-missing');
  // Reuse the existing bracketed-paste + submit transport, with byte-exact task.
  const expected=Buffer.from(`\x1b[200~${task.text}\x1b[201~\r`),wire=Buffer.from(delivery.wireBase64,'base64');
  requireFrame(wire.equals(expected) && wire.toString('base64')===delivery.wireBase64 &&
    delivery.wireBytes===wire.length && delivery.wireSha256===digest(wire),'provider-startup-delivery-mismatch');
  return {kind:'provider-task',wireBase64:delivery.wireBase64,wireBytes:wire.length,wireSha256:digest(wire)};
}
export function validateNativeInputFrame(binding,event) {
  const original=event?.original, question=event?.questionAnswer;
  requireFrame(event?.kind==='owner' && event.verifiedHuman===true,'native-input-not-attested-owner');
  requireFrame(original && typeof original.sourceFrameText==='string' &&
    Buffer.byteLength(original.sourceFrameText)===original.sourceFrameBytes &&
    digest(original.sourceFrameText)===original.sourceFrameSha256,'native-input-source-frame-incomplete');
  let frame;
  try{frame=JSON.parse(original.sourceFrameText);}catch{throw Error('native-input-frame-unresolved');}
  requireFrame(typeof original.logicalRouteSession==='string' && original.logicalRouteSession.length>0,
    'native-input-logical-route-missing');
  requireFrame(nativeOwnershipValid(original.nativeOwnership) && original.nativeOwnership.ptyId===original.pane,
    'native-input-source-ownership-missing');
  requireFrame(frame.version===1 && frame.kind===(original.modality==='question-answer'?'native-question-answer':'native-owner-submit') &&
    original.sourceFrameKind===frame.kind && frame.originalId===event.originalId && frame.provider===binding.provider &&
    frame.authoredText===event.text && canonical(frame.attachments)===canonical(event.attachments) &&
    ['sourceId','channel','pane','session','logicalRouteSession','timestamp','sequence','nativeOwnership'].every(k=>
      frame.source?.[k]!==undefined && canonical(frame.source[k])===canonical(original[k])),
    'native-input-frame-original-mismatch');
  // This is the actual semantic submit/answer frame, retained before forwarding.
  // It is not a fabricated provider transcript record or a raw keystroke stream.
  if(original.modality==='question-answer') {
    requireFrame(question && typeof question.questionFrameText==='string' &&
      Buffer.byteLength(question.questionFrameText)===question.questionFrameBytes &&
      digest(question.questionFrameText)===question.questionFrameSha256 &&
      question.recordStatus==='result','native-question-frame-incomplete-or-error');
    requireFrame(!providerResultError(question.rawResult)&&!providerResultError(frame.rawResult),'native-question-result-error');
    requireFrame(frame.questionCallId===question.toolCallId &&
      canonical(frame.question)===canonical(question.question) &&
      canonical(frame.rawAnswer)===canonical(question.answer) &&
      canonical(frame.rawResult)===canonical(question.rawResult) &&
      frame.questionFrameSha256===question.questionFrameSha256,
      'native-question-result-mismatch');
    const current=validateProviderQuestion(binding.provider,{callId:question.toolCallId,toolName:question.questionToolName,
      question:question.question,frameText:question.questionFrameText,frameBytes:question.questionFrameBytes,frameSha256:question.questionFrameSha256});
    requireFrame(frame.questionToolName===current.toolName,'native-question-call-mismatch');
  }
  const delivery=original.nativeDelivery;
  requireFrame(delivery && delivery.kind===(original.modality==='question-answer'?'provider-choice':'provider-turn') &&
    typeof delivery.wireBase64==='string' && Number.isSafeInteger(delivery.wireBytes) && delivery.wireBytes>0,
    'native-delivery-frame-missing');
  const wire=Buffer.from(delivery.wireBase64,'base64');
  requireFrame(wire.toString('base64')===delivery.wireBase64 && wire.length===delivery.wireBytes &&
    digest(wire)===delivery.wireSha256,'native-delivery-frame-byte-mismatch');
  return {sourceFrameSha256:original.sourceFrameSha256,sourceFrameBytes:original.sourceFrameBytes,
    ...(question?{questionFrameSha256:question.questionFrameSha256,questionFrameBytes:question.questionFrameBytes,
      questionCallId:question.toolCallId}:{}),wireBase64:delivery.wireBase64,
    wireBytes:delivery.wireBytes,wireSha256:delivery.wireSha256,kind:delivery.kind};
}

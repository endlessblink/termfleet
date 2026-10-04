import type {TerminalState} from './types';
import type {SessionEnvelope} from '../../shared/sessionEnvelope.mjs';
/** Only a real backend exit event qualifies. Scraped terminal output never calls
 * this adapter; old PTY and publisher bindings are rejected by the reducer. */
export function ptySessionEnvelope(pane:TerminalState|undefined,exit:{id:string;code?:number|null;success?:boolean},at=Date.now()):SessionEnvelope|null {
 const state=pane?.sessionStateV2;
 if(!state || pane.id!==exit.id) return null;
 return {version:2,identity:{...state.identity},producer:'pty-lifecycle',id:`exit:${exit.id}:${at}`,seq:(state.producerSeq['pty-lifecycle'] ?? 0)+1,
  at,source:'process',kind:exit.code===130 ? 'process.interrupted' : exit.success || pane.manualStopRequested ? 'process.gone':'process.crashed'};
}

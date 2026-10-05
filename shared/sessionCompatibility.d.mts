import type {SessionSnapshot} from './sessionSnapshot.mjs';
export function sessionCompatibilitySidecar(sidecar:Record<string,unknown>,head:SessionSnapshot|null,authority?:boolean):Record<string,unknown>;

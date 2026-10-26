/** Existing pure owner-record serialization; this declaration grants no authority. */
export function ownerCheckpoint(provider: string, text: string): string;

export function observedSourceReady(snapshot: unknown, scope: {dir:string;paneId:string;provider:string;sessionId:string}): boolean;
export function observedSourceCheckpoint(snapshot: unknown): string;

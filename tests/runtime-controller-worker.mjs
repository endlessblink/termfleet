import { updateRuntimeRegistry } from "../scripts/termfleet-runtime-controller.mjs";

const [registryPath, paneId, kind, at] = process.argv.slice(2);
updateRuntimeRegistry(registryPath, { kind, paneId }, Number(at));

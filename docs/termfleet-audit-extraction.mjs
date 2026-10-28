import {ownerTextOf} from "../termcontrol/bridge/requirements.mjs";
import {injected} from "../scripts/termfleet-asks.mjs";
import {sayLine} from "../termcontrol/bridge/feed.mjs";
const synthetic="Goal: Audit\nFull instructions: Read /tmp/synthetic-task.md and carry out the instructions in it.\nBot registry reference: termcontrol. Validated checkout: /tmp/synthetic. This path check grants no deployment or messaging permission.";
console.log(JSON.stringify({syntheticAccepted:ownerTextOf(synthetic)!==null,syntheticInjected:injected(synthetic),shortSay:sayLine({summary:'termfleet-say "Still checking."'}),truncatedSay:sayLine({summary:('termfleet-say "'+'x'.repeat(200)+'"').slice(0,140)}),prefixedSay:sayLine({summary:'await tools.mcp__lean_ctx__ctx_shell'})}));

//! Thin serde/daemon adapter. Parsing a proposal never grants authority.
use crate::handoff_native::{self, CommitReceipt, Descriptor, Launch, NativeRun, Proposal};
use crate::pty::PtyManager;
use serde_json::{json, Value};
fn text(v: &Value, k: &str) -> Result<String, String> {
    v[k].as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("native handoff missing {k}"))
}
fn size(v: &Value, k: &str) -> Result<u16, String> {
    v[k].as_u64()
        .and_then(|n| u16::try_from(n).ok())
        .filter(|n| *n > 0)
        .ok_or_else(|| format!("native handoff invalid {k}"))
}
pub(crate) fn proposal(v: &Value) -> Result<Proposal, String> {
    if v["unsentDraft"]["submitted"] != false {
        return Err("native handoff draft must remain unsent".into());
    }
    Ok(Proposal {
        request_id: text(v, "requestId")?,
        source_pane: text(v, "sourcePane")?,
        source_session: text(v, "sourceSession")?,
        target_pane: text(v, "targetPane")?,
        target_session: v["targetSession"].as_str().map(str::to_owned),
        descriptor: Descriptor {
            path: text(&v["descriptor"], "path")?,
            sha256: text(&v["descriptor"], "sha256")?,
            generation: text(&v["descriptor"], "generation")?,
        },
        launch: Launch {
            provider: text(v, "provider")?,
            command: text(v, "command")?,
            cwd: v["cwd"].as_str().map(str::to_owned),
            cols: size(v, "cols")?,
            rows: size(v, "rows")?,
        },
        unsent_text: text(&v["unsentDraft"], "text")?,
        startup_text: text(v, "startupTask")?,
    })
}
pub(crate) fn commit(v: &Value, _manager: &PtyManager) -> Result<Value, String> {
    let p = proposal(v)?;
    let receipt = crate::handoff_native_host::daemon_host()?.commit(&p)?;
    Ok(receipt_json(&receipt))
}
pub(crate) fn receipt_json(r: &CommitReceipt) -> Value {
    let i = &r.effect.intent;
    let target = &r.effect.target;
    let descriptor = json!({"path":i.descriptor.path,"sha256":i.descriptor.sha256,"generation":i.descriptor.generation});
    let receipt = json!({"operationId":i.operation_id,"actionHash":i.action_hash,"sourcePane":i.source_pane,
        "targetPane":i.target_pane,"sourceSession":i.source_session,"targetSession":i.target_session,"descriptor":descriptor,
        "generation":i.generation,"head":i.head,"through":i.through,"epoch":i.epoch,"checkpointHash":i.checkpoint_hash,
        "decisionHash":i.decision_hash,"decisionRevision":i.decision_revision,"startOwnership":"committed",
        "archiveOwnership":"committed","startupTask":{"bytes":i.startup_task.bytes,"sha256":i.startup_task.sha256,"status":"withheld","submitted":false},"unsentDraft":{"sha256":i.draft.sha256,"bytes":i.draft.bytes,
            "targetPane":i.target_pane,"targetSession":i.target_session,"status":"retained-unsent","submitted":false}});
    json!({"operationId":i.operation_id,"actionHash":i.action_hash,"head":i.head,"through":i.through,
        "generation":i.generation,"checkpointHash":i.checkpoint_hash,"decisionHash":i.decision_hash,"receipt":receipt,
        "startupTask":{"bytes":i.startup_task.bytes,"sha256":i.startup_task.sha256,"status":"withheld","submitted":false},
        "nativeOwnership":{"source":{"ptyId":i.source_pane,"pid":i.source_pid,"runId":i.source_run_id},
            "target":{"ptyId":target.pane,"pid":target.pid,"runId":target.run_id}},
        "comprehension":"unverified","paidAuthorization":"none"})
}
pub(crate) fn recover(v: &Value) -> Result<Value, String> {
    let r = crate::handoff_native_host::daemon_host()?.recover(
        &text(v, "operationId")?,
        &text(v, "targetPane")?,
        &text(v, "targetSession")?,
    )?;
    Ok(
        json!({"operationId":r.operation_id,"targetPane":r.target_pane,"targetSession":r.target_session,
        "text":r.draft.text,"bytes":r.draft.bytes,"sha256":r.draft.sha256,"status":"retained-unsent","submitted":false}),
    )
}
pub(crate) fn input(v: &Value, manager: &PtyManager) -> Result<Value, String> {
    let _ = manager;
    let r = crate::handoff_native_host::daemon_host()?.input(&v.to_string())?;
    Ok(input_receipt_json(&r))
}
pub(crate) fn input_receipt_json(r: &handoff_native::InputReceipt) -> Value {
    let i = &r.intent;
    let ownership = |n: &NativeRun| json!({"ptyId":n.pane,"pid":n.pid,"runId":n.run_id});
    json!({"operationId":i.id,"originalId":i.original_id,"eventHash":i.event_hash,
        "acceptedHead":i.accepted_head,"through":i.through,"sourcePane":i.source_pane,"sourceSession":i.source_session,
        "targetPane":i.target_pane,"targetSession":i.target_session,
        "sourceLogicalRouteSession":i.source_logical_route_session,"targetLogicalRouteSession":i.target_logical_route_session,
        "providerBindingHash":i.provider_binding_hash,"lifecycleOperationId":i.lifecycle_operation_id,
        "generation":i.generation,"sourceOwnership":ownership(&i.source_ownership),"targetOwnership":ownership(&i.target_ownership),
        "questionOwnership":i.question_ownership,"wireBytes":i.wire_bytes,"wireSha256":i.wire_sha256,"status":"written-to-bound-pty"})
}

pub(crate) fn register_provider(v: &Value) -> Result<Value, String> {
    let r = crate::handoff_native_host::daemon_host()?.register(&v.to_string())?;
    Ok(registration_receipt_json(&r))
}
pub(crate) fn activate_provider(v: &Value) -> Result<Value, String> {
    let i = crate::handoff_native_host::daemon_host()?.activate(&v.to_string())?;
    Ok(activation_receipt_json(&i))
}
pub(crate) fn activation_receipt_json(i: &crate::handoff_native_binding::Activation) -> Value {
    json!({"operationId":i.id,"head":i.head,"through":i.through,"checkpointHash":i.checkpoint_hash,
        "decisionHash":i.decision_hash,"decisionRevision":i.decision_revision,"epoch":i.epoch,"generation":i.generation,
        "providerBindingGeneration":i.provider_binding_generation,"providerBindingHash":i.provider_binding_hash,
        "providerBindingRevision":i.provider_binding_revision,"lifecycleOperationId":i.lifecycle_operation_id,
        "targetPane":i.target_pane,"targetSession":i.target_session,"targetLogicalRouteSession":i.target_logical_route_session,
        "targetOwnership":{"ptyId":i.target_ownership.pane,"pid":i.target_ownership.pid,"runId":i.target_ownership.run_id},
        "startupTask":{"bytes":i.startup_task.bytes,"sha256":i.startup_task.sha256},"wireBytes":i.wire_bytes,
        "wireSha256":i.wire_sha256,"status":"released-to-bound-provider"})
}

pub(crate) fn registration_receipt_json(i: &crate::handoff_native_binding::Registration) -> Value {
    let route = |r: &crate::handoff_native_binding::Route| {
        json!({"pane":r.pane,"logicalRouteSession":r.logical_route_session,
        "actualSession":r.actual_session,"ownership":{"ptyId":r.ownership.pane,"pid":r.ownership.pid,"runId":r.ownership.run_id}})
    };
    json!({"operationId":i.id,"head":i.head,"through":i.through,"generation":i.generation,
        "lifecycleOperationId":i.lifecycle_operation_id,"revision":i.revision,"providerBindingHash":i.provider_binding_hash,
        "source":route(&i.source),"target":i.target.as_ref().map(route),"status":"bound-native-provider-projection"})
}

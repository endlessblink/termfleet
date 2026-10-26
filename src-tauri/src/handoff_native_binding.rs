//! Private typed runtime mapping and exact startup-byte release. No serialized
//! input here is authority: only the registered existing host may supply these.
use crate::handoff_native::{sha256, Draft, HostOwnedLifecycleBridge, NativeRun, NativeSessions};
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Route {
    pub pane: String,
    pub logical_route_session: String,
    pub actual_session: String,
    pub ownership: NativeRun,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Registration {
    pub id: String,
    pub head: String,
    pub through: u64,
    pub generation: String,
    pub lifecycle_operation_id: Option<String>,
    pub revision: u64,
    pub provider_binding_hash: String,
    pub source: Route,
    pub target: Option<Route>,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Activation {
    pub id: String,
    pub head: String,
    pub through: u64,
    pub checkpoint_hash: String,
    pub decision_hash: String,
    pub decision_revision: u64,
    pub epoch: u64,
    pub generation: String,
    pub provider_binding_generation: String,
    pub provider_binding_hash: String,
    pub provider_binding_revision: u64,
    pub lifecycle_operation_id: String,
    pub target_pane: String,
    pub target_session: String,
    pub target_logical_route_session: String,
    pub target_ownership: NativeRun,
    pub startup_task: Draft,
    pub wire: Vec<u8>,
    pub wire_bytes: usize,
    pub wire_sha256: String,
}
fn identity(s: &str) -> bool {
    !s.is_empty() && !s.contains('\0')
}
fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn route(r: &Route) -> bool {
    identity(&r.pane)
        && identity(&r.actual_session)
        && identity(&r.logical_route_session)
        && r.pane == r.ownership.pane
        && identity(&r.ownership.run_id)
        && r.ownership.pid > 0
}
pub(crate) fn validate_registration(i: &Registration) -> Result<(), String> {
    if !identity(&i.id)
        || !hash(&i.head)
        || i.through == 0
        || !identity(&i.generation)
        || i.revision == 0
        || !hash(&i.provider_binding_hash)
        || !route(&i.source)
        || i.source.actual_session != i.source.logical_route_session
        || i.target.is_some() != i.lifecycle_operation_id.is_some()
        || i.target.as_ref().is_some_and(|t| {
            !route(t)
                || t.pane == i.source.pane
                || t.actual_session == i.source.actual_session
                || t.actual_session == t.logical_route_session
                || t.ownership.run_id == i.source.ownership.run_id
                || t.ownership.pid == i.source.ownership.pid
        })
    {
        return Err("native actual provider mapping binding unverified".into());
    }
    Ok(())
}
pub(crate) fn validate_activation(i: &Activation) -> Result<(), String> {
    let mut expected = b"\x1b[200~".to_vec();
    expected.extend_from_slice(i.startup_task.text.as_bytes());
    expected.extend_from_slice(b"\x1b[201~\r");
    if !identity(&i.id)
        || !hash(&i.head)
        || i.through == 0
        || !hash(&i.checkpoint_hash)
        || !hash(&i.decision_hash)
        || i.decision_revision == 0
        || !identity(&i.generation)
        || !identity(&i.provider_binding_generation)
        || !hash(&i.provider_binding_hash)
        || i.provider_binding_revision == 0
        || !identity(&i.lifecycle_operation_id)
        || !identity(&i.target_session)
        || i.target_session == i.target_logical_route_session
        || !identity(&i.target_logical_route_session)
        || i.target_pane != i.target_ownership.pane
        || i.target_ownership.pid == 0
        || !identity(&i.target_ownership.run_id)
        || i.startup_task.text.is_empty()
        || i.startup_task.bytes != i.startup_task.text.len()
        || i.startup_task.sha256 != sha256(i.startup_task.text.as_bytes())
        || i.wire != expected
        || i.wire_bytes != expected.len()
        || i.wire_sha256 != sha256(&expected)
    {
        return Err("native provider startup activation bytes/scope unverified".into());
    }
    Ok(())
}
pub(crate) fn register(
    proposal: &str,
    host: &dyn HostOwnedLifecycleBridge,
    sessions: &dyn NativeSessions,
) -> Result<Registration, String> {
    let mut entered = false;
    let mut effect = None;
    let mut op = None;
    let mut callback = |i: &Registration| {
        if entered {
            return Err("provider registration callback consumed; no retry".into());
        }
        entered = true;
        op = Some(i.id.clone());
        validate_registration(i)?;
        sessions.register_provider(i)?;
        effect = Some(i.clone());
        Ok(i.clone())
    };
    let result = host.register_provider(proposal, &mut callback);
    drop(callback);
    match result {
        Ok(r) if effect.as_ref() == Some(&r) => Ok(r),
        other => Err(format!(
            "native provider registration unverified; operation={}; reconcile without retry; {}",
            op.as_deref().unwrap_or("not-initiated"),
            other
                .err()
                .unwrap_or("mismatched host mapping receipt".into())
        )),
    }
}
pub(crate) fn activate(
    proposal: &str,
    host: &dyn HostOwnedLifecycleBridge,
    sessions: &dyn NativeSessions,
) -> Result<Activation, String> {
    let mut entered = false;
    let mut effect = None;
    let mut op = None;
    let mut callback = |i: &Activation| {
        if entered {
            return Err("provider activation callback consumed; no retry".into());
        }
        entered = true;
        op = Some(i.id.clone());
        validate_activation(i)?;
        sessions.activate_provider(i)?;
        effect = Some(i.clone());
        Ok(i.clone())
    };
    let result = host.activate_provider(proposal, &mut callback);
    drop(callback);
    match result{Ok(r)if effect.as_ref()==Some(&r)=>Ok(r),other=>Err(format!("native provider activation outcome unverified; operation={}; reconcile without retry; {}",op.as_deref().unwrap_or("not-initiated"),other.err().unwrap_or("mismatched host activation receipt".into())))}
}

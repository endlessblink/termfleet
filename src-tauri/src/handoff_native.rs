//! Native lifecycle mechanics. Public proposals are untrusted. The private host
//! bridge must own the existing broker transaction, current framed-source scope,
//! durable intent, resource ownership and outcome/routing persistence. Same UID,
//! renderer origin and caller-supplied fields do not create that bridge.
use std::sync::{Arc, OnceLock};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Descriptor {
    pub path: String,
    pub sha256: String,
    pub generation: String,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Draft {
    pub text: String,
    pub sha256: String,
    pub bytes: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Launch {
    pub provider: String,
    pub command: String,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct Proposal {
    pub request_id: String,
    pub source_pane: String,
    pub source_session: String,
    pub target_pane: String,
    pub target_session: Option<String>,
    pub descriptor: Descriptor,
    pub launch: Launch,
    pub unsent_text: String,
    pub startup_text: String,
}
// Deserialize this type only in the private daemon child-pipe codec, never
// from a renderer/daemon proposal. It comes only
// from the private registered host's CURRENT VERIFIED existing broker intent.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Intent {
    pub operation_id: String,
    pub action_hash: String,
    pub request_id: String,
    pub source_pane: String,
    pub source_session: String,
    pub target_pane: String,
    pub target_session: String,
    pub descriptor: Descriptor,
    pub generation: String,
    pub head: String,
    pub through: u64,
    pub epoch: u64,
    pub checkpoint_hash: String,
    pub decision_hash: String,
    pub decision_revision: u64,
    pub launch: Launch,
    pub draft: Draft,
    pub startup_task: Draft,
    pub source_run_id: String,
    pub source_pid: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NativeRun {
    pub pane: String,
    pub run_id: String,
    pub pid: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EffectReceipt {
    pub intent: Intent,
    pub target: NativeRun,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommitReceipt {
    pub effect: EffectReceipt,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Recovery {
    pub operation_id: String,
    pub target_pane: String,
    pub target_session: String,
    pub draft: Draft,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InputIntent {
    pub id: String,
    pub original_id: String,
    pub event_hash: String,
    pub accepted_head: String,
    pub through: u64,
    pub source_pane: String,
    pub source_session: String,
    pub target_pane: String,
    pub target_session: String,
    pub source_logical_route_session: String,
    pub target_logical_route_session: String,
    pub provider_binding_hash: String,
    pub lifecycle_operation_id: Option<String>,
    pub generation: Option<String>,
    pub source_ownership: NativeRun,
    pub target_ownership: NativeRun,
    pub question_ownership: Option<String>,
    pub wire: Vec<u8>,
    pub wire_bytes: usize,
    pub wire_sha256: String,
    pub provider_choice: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InputReceipt {
    pub intent: InputIntent,
}

pub(crate) trait NativeSessions {
    // Actual implementation uses PtyManager's existing creation lock. It cannot
    // restore/reuse an id, remove an ended entry, kill or submit draft text.
    fn start_fresh(&self, intent: &Intent) -> Result<NativeRun, String>;
    fn register_provider(
        &self,
        _intent: &crate::handoff_native_binding::Registration,
    ) -> Result<(), String> {
        Err("native provider registrar unavailable".into())
    }
    fn activate_provider(
        &self,
        _intent: &crate::handoff_native_binding::Activation,
    ) -> Result<(), String> {
        Err("native provider activation unavailable".into())
    }
    fn write_admitted(&self, _intent: &InputIntent) -> Result<(), String> {
        Err("native admitted writer unavailable".into())
    }
}
pub(crate) trait HostOwnedLifecycleBridge: Send + Sync {
    // Must preserve committing intent and classify ALL callback/reply errors as
    // uncertain, including malformed results/timeout. Never automatically retry.
    fn commit(
        &self,
        proposal: &Proposal,
        native: &mut dyn FnMut(&Intent) -> Result<EffectReceipt, String>,
    ) -> Result<CommitReceipt, String>;
    // Must verify an already recorded exact operation/target/current native scope.
    // Read the draft from that same durable broker intent; no new draft journal.
    fn recover_unsent(
        &self,
        operation_id: &str,
        target_pane: &str,
        target_session: &str,
    ) -> Result<Recovery, String>;
    fn deliver_input(
        &self,
        _proposal: &str,
        _native: &mut dyn FnMut(&InputIntent) -> Result<InputReceipt, String>,
    ) -> Result<InputReceipt, String> {
        Err("authenticated native framed input bridge unavailable".into())
    }
    fn register_provider(
        &self,
        _proposal: &str,
        _native: &mut dyn FnMut(
            &crate::handoff_native_binding::Registration,
        )
            -> Result<crate::handoff_native_binding::Registration, String>,
    ) -> Result<crate::handoff_native_binding::Registration, String> {
        Err("authenticated actual provider registration unavailable".into())
    }
    fn activate_provider(
        &self,
        _proposal: &str,
        _native: &mut dyn FnMut(
            &crate::handoff_native_binding::Activation,
        )
            -> Result<crate::handoff_native_binding::Activation, String>,
    ) -> Result<crate::handoff_native_binding::Activation, String> {
        Err("authenticated exact provider startup activation unavailable".into())
    }
}
static HOST: OnceLock<Arc<dyn HostOwnedLifecycleBridge>> = OnceLock::new();
// Deliberately not a Tauri command, env option, file path or serialized permit.
// The daemon registers an empty-catalog bridge; registration creates no authority.
// Trustworthy source enrollment and bootstrap
// must be implemented by the existing broker/source host before enabling it.
#[allow(dead_code)]
pub(crate) fn register_host_owned_bridge(
    bridge: Arc<dyn HostOwnedLifecycleBridge>,
) -> Result<(), String> {
    HOST.set(bridge)
        .map_err(|_| "native handoff host already registered".into())
}
pub(crate) fn registered_host() -> Option<Arc<dyn HostOwnedLifecycleBridge>> {
    HOST.get().cloned()
}
#[cfg(test)]
pub(crate) fn commit(
    proposal: &Proposal,
    sessions: &dyn NativeSessions,
) -> Result<CommitReceipt, String> {
    execute(proposal, HOST.get().map(Arc::as_ref), sessions)
}
fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn identity(s: &str) -> bool {
    !s.is_empty() && !s.contains('\0')
}
// Dependency-free byte checksum, not an authority or signing implementation.
// Existing protected broker remains responsible for signature/scope verification.
pub(crate) fn sha256(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h = [
        0x6a09e667u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut data = bytes.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&(bytes.len() as u64).wrapping_mul(8).to_be_bytes());
    for block in data.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (j, b) in block.chunks_exact(4).enumerate() {
            w[j] = u32::from_be_bytes(b.try_into().unwrap());
        }
        for j in 16..64 {
            let x = w[j - 15];
            let y = w[j - 2];
            let s0 = x.rotate_right(7) ^ x.rotate_right(18) ^ (x >> 3);
            let s1 = y.rotate_right(17) ^ y.rotate_right(19) ^ (y >> 10);
            w[j] = w[j - 16]
                .wrapping_add(s0)
                .wrapping_add(w[j - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut z] = h;
        for j in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = z
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[j])
                .wrapping_add(w[j]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            z = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (i, v) in [a, b, c, d, e, f, g, z].iter().enumerate() {
            h[i] = h[i].wrapping_add(*v);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}
fn validate(proposal: &Proposal, intent: &Intent) -> Result<(), String> {
    if !identity(&intent.operation_id)
        || !hash(&intent.action_hash)
        || !hash(&intent.head)
        || !hash(&intent.checkpoint_hash)
        || !hash(&intent.decision_hash)
        || intent.through == 0
        || intent.decision_revision == 0
        || !identity(&intent.generation)
        || !identity(&intent.source_session)
        || !identity(&intent.target_session)
        || intent.source_session == intent.target_session
        || intent.source_pane == intent.target_pane
        || intent.request_id != proposal.request_id
        || intent.source_pane != proposal.source_pane
        || intent.source_session != proposal.source_session
        || intent.target_pane != proposal.target_pane
        || proposal
            .target_session
            .as_ref()
            .is_some_and(|s| s != &intent.target_session)
        || intent.descriptor != proposal.descriptor
        || !intent.descriptor.path.starts_with('/')
        || !hash(&intent.descriptor.sha256)
        || !identity(&intent.descriptor.generation)
        || intent.launch != proposal.launch
        || !matches!(
            intent.launch.provider.as_str(),
            "claude" | "codex" | "opencode"
        )
        || !identity(&intent.launch.command)
        || intent.launch.cols == 0
        || intent.launch.rows == 0
        || intent.draft.text != proposal.unsent_text
        || intent.draft.bytes != intent.draft.text.len()
        || intent.draft.sha256 != sha256(intent.draft.text.as_bytes())
        || intent.startup_task.text != proposal.startup_text
        || intent.startup_task.bytes != intent.startup_task.text.len()
        || intent.startup_task.sha256 != sha256(intent.startup_task.text.as_bytes())
        || !identity(&intent.startup_task.text)
        || !identity(&intent.source_run_id)
        || intent.source_pid == 0
    {
        return Err("native handoff proposal does not match current host intent".into());
    }
    Ok(())
}
pub(crate) fn execute(
    proposal: &Proposal,
    host: Option<&dyn HostOwnedLifecycleBridge>,
    sessions: &dyn NativeSessions,
) -> Result<CommitReceipt, String> {
    let host = host.ok_or(
        "native handoff authenticated source/intent bridge unavailable; no effect initiated",
    )?;
    let mut entered = false;
    let mut native_receipt = None;
    let mut operation = None;
    let mut callback = |intent: &Intent| {
        if entered {
            return Err(
                "native lifecycle callback already consumed; reconcile without retry".into(),
            );
        }
        entered = true;
        operation = Some(intent.operation_id.clone());
        validate(proposal, intent)?;
        let target = sessions.start_fresh(intent)?;
        if target.pane != intent.target_pane
            || !identity(&target.run_id)
            || target.run_id == intent.source_run_id
            || target.pid == 0
            || target.pid == intent.source_pid
        {
            return Err("native start target outcome unverified".into());
        }
        let receipt = EffectReceipt {
            intent: intent.clone(),
            target,
        };
        native_receipt = Some(receipt.clone());
        Ok(receipt)
    };
    let result = host.commit(proposal, &mut callback);
    drop(callback);
    match result {
        Ok(receipt) if entered && native_receipt.as_ref() == Some(&receipt.effect) => Ok(receipt),
        other => Err(format!(
            "native lifecycle outcome unverified; operation={}; reconcile without retry; {}",
            operation.as_deref().unwrap_or("not-initiated"),
            other
                .err()
                .unwrap_or_else(|| "host receipt missing or mismatched".into())
        )),
    }
}
#[cfg(test)]
pub(crate) fn recover(
    operation_id: &str,
    target_pane: &str,
    target_session: &str,
) -> Result<Recovery, String> {
    recover_owned(
        operation_id,
        target_pane,
        target_session,
        HOST.get().map(Arc::as_ref),
    )
}
pub(crate) fn recover_owned(
    operation_id: &str,
    target_pane: &str,
    target_session: &str,
    host: Option<&dyn HostOwnedLifecycleBridge>,
) -> Result<Recovery, String> {
    let host = host.ok_or("native handoff authenticated recovery bridge unavailable")?;
    let r = host.recover_unsent(operation_id, target_pane, target_session)?;
    if r.operation_id != operation_id
        || r.target_pane != target_pane
        || r.target_session != target_session
        || r.draft.bytes != r.draft.text.len()
        || r.draft.sha256 != sha256(r.draft.text.as_bytes())
    {
        return Err("unsent recovery binding unverified".into());
    }
    Ok(r)
}
#[cfg(test)]
pub(crate) fn deliver_input(
    proposal: &str,
    sessions: &dyn NativeSessions,
) -> Result<InputReceipt, String> {
    deliver_input_owned(proposal, HOST.get().map(Arc::as_ref), sessions)
}
pub(crate) fn deliver_input_owned(
    proposal: &str,
    host: Option<&dyn HostOwnedLifecycleBridge>,
    sessions: &dyn NativeSessions,
) -> Result<InputReceipt, String> {
    let host =
        host.ok_or("authenticated native framed input bridge unavailable; no write initiated")?;
    let mut entered = false;
    let mut receipt = None;
    let mut operation = None;
    let mut native = |i: &InputIntent| {
        if entered {
            return Err("native input callback already consumed; reconcile without retry".into());
        }
        entered = true;
        operation = Some(i.id.clone());
        if !identity(&i.id)
            || !identity(&i.original_id)
            || !hash(&i.event_hash)
            || !hash(&i.accepted_head)
            || i.through == 0
            || !identity(&i.source_pane)
            || !identity(&i.target_pane)
            || i.generation.as_ref().is_none_or(|s| !identity(s))
            || i.lifecycle_operation_id
                .as_ref()
                .is_some_and(|s| !identity(s))
            || i.generation.as_ref().is_some_and(|s| !identity(s))
            || !identity(&i.source_session)
            || !identity(&i.source_logical_route_session)
            || !identity(&i.target_logical_route_session)
            || !hash(&i.provider_binding_hash)
            || !identity(&i.target_session)
            || i.source_ownership.pane != i.source_pane
            || i.target_ownership.pane != i.target_pane
            || i.source_ownership.pid == 0
            || i.target_ownership.pid == 0
            || !identity(&i.source_ownership.run_id)
            || !identity(&i.target_ownership.run_id)
            || (i.source_pane == i.target_pane
                && (i.source_session != i.target_session
                    || i.source_logical_route_session != i.target_logical_route_session
                    || i.source_ownership != i.target_ownership))
            || (i.source_pane != i.target_pane
                && (i.source_ownership.run_id == i.target_ownership.run_id
                    || i.source_ownership.pid == i.target_ownership.pid))
            || i.wire.is_empty()
            || i.wire.len() != i.wire_bytes
            || sha256(&i.wire) != i.wire_sha256
            || (i.provider_choice && !i.question_ownership.as_ref().is_some_and(|s| identity(s)))
        {
            return Err("native admitted frame binding/bytes unverified".into());
        }
        sessions.write_admitted(i)?;
        let r = InputReceipt { intent: i.clone() };
        receipt = Some(r.clone());
        Ok(r)
    };
    let result = host.deliver_input(proposal, &mut native);
    drop(native);
    match result {
        Ok(r) if entered && receipt.as_ref() == Some(&r) => Ok(r),
        other => Err(format!(
            "native input outcome unverified; operation={}; reconcile without retry; {}",
            operation.as_deref().unwrap_or("not-initiated"),
            other
                .err()
                .unwrap_or_else(|| "host input receipt missing/mismatched".into())
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    struct Sessions {
        ids: Mutex<Vec<String>>,
        starts: Mutex<Vec<Intent>>,
    }
    impl NativeSessions for Sessions {
        fn start_fresh(&self, i: &Intent) -> Result<NativeRun, String> {
            let mut ids = self.ids.lock().unwrap();
            if !ids.contains(&i.source_pane) || ids.contains(&i.target_pane) {
                return Err("source missing or target already owned".into());
            }
            if i.source_run_id != "source-run" || i.source_pid != 41 {
                return Err("native source instance mismatch".into());
            }
            ids.push(i.target_pane.clone());
            self.starts.lock().unwrap().push(i.clone());
            Ok(NativeRun {
                pane: i.target_pane.clone(),
                run_id: "target-run".into(),
                pid: 42,
            })
        }
    }
    struct Host {
        intent: Intent,
        mode: &'static str,
    }
    impl HostOwnedLifecycleBridge for Host {
        fn commit(
            &self,
            _: &Proposal,
            native: &mut dyn FnMut(&Intent) -> Result<EffectReceipt, String>,
        ) -> Result<CommitReceipt, String> {
            if self.mode == "denied" {
                return Err("current scope denied".into());
            }
            let r = native(&self.intent)?;
            if self.mode == "lost" {
                return Err("durable host reply unavailable".into());
            }
            if self.mode == "twice" {
                native(&self.intent)?;
            }
            let mut r = r;
            if self.mode == "wrong-receipt" {
                r.target.pane = "wrong".into();
            }
            Ok(CommitReceipt { effect: r })
        }
        fn recover_unsent(&self, _: &str, _: &str, _: &str) -> Result<Recovery, String> {
            Err("test no recovery registration".into())
        }
    }
    fn fixture() -> (Proposal, Intent, Sessions) {
        let descriptor = Descriptor {
            path: "/synthetic/manifest.json".into(),
            sha256: "a".repeat(64),
            generation: "capsule-generation".into(),
        };
        let launch = Launch {
            provider: "claude".into(),
            command: "synthetic-only-command".into(),
            cwd: Some("/synthetic".into()),
            cols: 100,
            rows: 30,
        };
        let draft = Draft {
            text: "  unsent טיוטה 💠\n".into(),
            sha256: sha256("  unsent טיוטה 💠\n".as_bytes()),
            bytes: "  unsent טיוטה 💠\n".len(),
        };
        let p = Proposal {
            request_id: "request".into(),
            source_pane: "old".into(),
            source_session: "source".into(),
            target_pane: "new".into(),
            target_session: None,
            descriptor: descriptor.clone(),
            launch: launch.clone(),
            unsent_text: draft.text.clone(),
            startup_text: "retained startup task".into(),
        };
        let i = Intent {
            operation_id: "operation".into(),
            action_hash: "b".repeat(64),
            request_id: p.request_id.clone(),
            source_pane: p.source_pane.clone(),
            source_session: p.source_session.clone(),
            target_pane: p.target_pane.clone(),
            target_session: "successor".into(),
            descriptor,
            generation: "checkpoint-generation".into(),
            head: "c".repeat(64),
            through: 2,
            epoch: 0,
            checkpoint_hash: "e".repeat(64),
            decision_hash: "f".repeat(64),
            decision_revision: 1,
            launch,
            draft,
            startup_task: Draft {
                text: "retained startup task".into(),
                bytes: 21,
                sha256: sha256(b"retained startup task"),
            },
            source_run_id: "source-run".into(),
            source_pid: 41,
        };
        (
            p,
            i,
            Sessions {
                ids: Mutex::new(vec!["old".into(), "unrelated".into()]),
                starts: Mutex::new(vec![]),
            },
        )
    }
    #[test]
    fn absent_host_denies_before_native_effect() {
        let (p, _, s) = fixture();
        assert!(execute(&p, None, &s).is_err());
        assert!(s.starts.lock().unwrap().is_empty());
    }
    #[test]
    fn default_real_entrypoint_has_no_registered_host() {
        let (p, _, s) = fixture();
        assert!(commit(&p, &s).is_err());
        assert!(s.starts.lock().unwrap().is_empty());
    }
    #[test]
    fn source_and_every_other_session_survive_and_draft_stays_unsent() {
        let (p, i, s) = fixture();
        let h = Host {
            intent: i.clone(),
            mode: "valid",
        };
        let r = execute(&p, Some(&h), &s).unwrap();
        assert_eq!(*s.ids.lock().unwrap(), vec!["old", "unrelated", "new"]);
        assert_eq!(r.effect.intent.draft, i.draft);
        assert_eq!(r.effect.target.run_id, "target-run");
    }
    #[test]
    fn existing_target_cannot_be_reused() {
        let (p, i, s) = fixture();
        s.ids.lock().unwrap().push("new".into());
        assert!(execute(
            &p,
            Some(&Host {
                intent: i,
                mode: "valid"
            }),
            &s
        )
        .is_err());
        assert!(s.starts.lock().unwrap().is_empty());
    }
    #[test]
    fn exact_binding_rejects_mutated_launch_source_descriptor_and_draft() {
        for change in 0..6 {
            let (mut p, i, s) = fixture();
            match change {
                0 => p.launch.command = "changed".into(),
                1 => p.source_session = "changed".into(),
                2 => p.descriptor.sha256 = "0".repeat(64),
                3 => p.unsent_text.push('x'),
                4 => p.target_session = Some("wrong".into()),
                _ => p.target_pane = "other".into(),
            };
            assert!(execute(
                &p,
                Some(&Host {
                    intent: i,
                    mode: "valid"
                }),
                &s
            )
            .is_err());
            assert!(s.starts.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn denied_scope_has_zero_effect() {
        let (p, i, s) = fixture();
        assert!(execute(
            &p,
            Some(&Host {
                intent: i,
                mode: "denied"
            }),
            &s
        )
        .is_err());
        assert!(s.starts.lock().unwrap().is_empty());
    }
    #[test]
    fn lost_or_wrong_receipt_reports_operation_and_does_not_repeat() {
        for mode in ["lost", "wrong-receipt", "twice"] {
            let (p, i, s) = fixture();
            let error = execute(&p, Some(&Host { intent: i, mode }), &s).unwrap_err();
            assert!(error.contains("operation=operation"));
            assert_eq!(s.starts.lock().unwrap().len(), 1);
            assert!(s.ids.lock().unwrap().contains(&"old".into()));
        }
    }
    #[test]
    fn missing_recovery_host_cannot_return_or_submit_a_draft() {
        assert!(recover("operation", "new", "successor").is_err());
    }
    #[test]
    fn standard_sha256_vectors() {
        assert_eq!(
            sha256(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256(&vec![b'a'; 1000000]),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }
    #[test]
    fn wrong_draft_digest_or_native_source_instance_has_zero_start() {
        for change in 0..3 {
            let (p, mut i, s) = fixture();
            match change {
                0 => i.draft.sha256 = "0".repeat(64),
                1 => i.source_run_id = "wrong-run".into(),
                _ => i.source_pid = 99,
            };
            assert!(execute(
                &p,
                Some(&Host {
                    intent: i,
                    mode: "valid"
                }),
                &s
            )
            .is_err());
            assert!(s.starts.lock().unwrap().is_empty());
        }
    }

    struct InputSessions {
        writes: Mutex<Vec<Vec<u8>>>,
        fail_after_write: bool,
    }
    impl NativeSessions for InputSessions {
        fn start_fresh(&self, _: &Intent) -> Result<NativeRun, String> {
            Err("input cannot start".into())
        }
        fn write_admitted(&self, i: &InputIntent) -> Result<(), String> {
            if i.source_ownership
                != (NativeRun {
                    pane: "old".into(),
                    run_id: "source-run".into(),
                    pid: 41,
                })
                || i.target_ownership
                    != (NativeRun {
                        pane: "new".into(),
                        run_id: "target-run".into(),
                        pid: 42,
                    })
                || i.lifecycle_operation_id.as_deref() != Some("operation")
                || i.generation.as_deref() != Some("checkpoint-generation")
            {
                return Err("current native run/PID/generation changed".into());
            }
            self.writes.lock().unwrap().push(i.wire.clone());
            if self.fail_after_write {
                Err("partial write uncertainty".into())
            } else {
                Ok(())
            }
        }
    }
    struct InputHost {
        intent: InputIntent,
        mode: &'static str,
        recovery: Recovery,
    }
    impl HostOwnedLifecycleBridge for InputHost {
        fn commit(
            &self,
            _: &Proposal,
            _: &mut dyn FnMut(&Intent) -> Result<EffectReceipt, String>,
        ) -> Result<CommitReceipt, String> {
            Err("input cannot commit".into())
        }
        fn recover_unsent(&self, _: &str, _: &str, _: &str) -> Result<Recovery, String> {
            Ok(self.recovery.clone())
        }
        fn deliver_input(
            &self,
            _: &str,
            native: &mut dyn FnMut(&InputIntent) -> Result<InputReceipt, String>,
        ) -> Result<InputReceipt, String> {
            if self.mode == "denied" {
                return Err("current question/scope denied".into());
            }
            let mut r = native(&self.intent)?;
            if self.mode == "lost" {
                return Err("host input outcome missing".into());
            }
            if self.mode == "twice" {
                native(&self.intent)?;
            }
            if self.mode == "wrong-receipt" {
                r.intent.accepted_head = "0".repeat(64);
            }
            Ok(r)
        }
    }
    fn input_fixture() -> (InputHost, InputSessions) {
        let (_, i, _) = fixture();
        let wire = "exact owner frame טיוטה 💠\r".as_bytes().to_vec();
        let intent = InputIntent {
            id: "delivery".into(),
            original_id: "original".into(),
            event_hash: "a".repeat(64),
            accepted_head: "b".repeat(64),
            through: 3,
            source_pane: "old".into(),
            source_session: "source".into(),
            target_pane: "new".into(),
            target_session: "successor".into(),
            source_logical_route_session: "source".into(),
            target_logical_route_session: "successor-route".into(),
            provider_binding_hash: "f".repeat(64),
            lifecycle_operation_id: Some("operation".into()),
            generation: Some("checkpoint-generation".into()),
            source_ownership: NativeRun {
                pane: "old".into(),
                run_id: "source-run".into(),
                pid: 41,
            },
            target_ownership: NativeRun {
                pane: "new".into(),
                run_id: "target-run".into(),
                pid: 42,
            },
            question_ownership: None,
            wire_bytes: wire.len(),
            wire_sha256: sha256(&wire),
            wire,
            provider_choice: false,
        };
        (
            InputHost {
                intent,
                mode: "valid",
                recovery: Recovery {
                    operation_id: i.operation_id,
                    target_pane: i.target_pane,
                    target_session: i.target_session,
                    draft: i.draft,
                },
            },
            InputSessions {
                writes: Mutex::new(vec![]),
                fail_after_write: false,
            },
        )
    }
    #[test]
    fn unregistered_framed_input_has_zero_write() {
        let (_, s) = input_fixture();
        assert!(deliver_input("{\"verifiedHuman\":true}", &s).is_err());
        assert!(deliver_input_owned("{}", None, &s).is_err());
        assert!(s.writes.lock().unwrap().is_empty());
    }
    #[test]
    fn admitted_exact_wire_is_written_once_to_bound_successor() {
        let (h, s) = input_fixture();
        let r = deliver_input_owned("untrusted proposal", Some(&h), &s).unwrap();
        assert_eq!(r.intent, h.intent);
        assert_eq!(*s.writes.lock().unwrap(), vec![h.intent.wire]);
    }
    #[test]
    fn stale_run_pid_generation_and_byte_binding_deny_without_writing() {
        for n in 0..10 {
            let (mut h, s) = input_fixture();
            match n {
                0 => h.intent.wire_sha256 = "0".repeat(64),
                1 => h.intent.wire_bytes += 1,
                2 => h.intent.wire.push(0),
                3 => h.intent.source_ownership.pid = 99,
                4 => h.intent.target_ownership.run_id = "replaced-run".into(),
                5 => h.intent.generation = Some("stale".into()),
                6 => h.intent.lifecycle_operation_id = None,
                7 => h.intent.source_ownership.pane = "other".into(),
                8 => h.intent.target_ownership.pid = 0,
                _ => h.intent.event_hash = "bad".into(),
            };
            assert!(deliver_input_owned("{}", Some(&h), &s).is_err());
            assert!(s.writes.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn question_choice_requires_current_host_question_binding() {
        let (mut h, s) = input_fixture();
        h.intent.provider_choice = true;
        assert!(deliver_input_owned("{}", Some(&h), &s).is_err());
        assert!(s.writes.lock().unwrap().is_empty());
        h.intent.question_ownership = Some("trusted-current-question-binding".into());
        assert!(deliver_input_owned("{}", Some(&h), &s).is_ok());
        assert_eq!(s.writes.lock().unwrap().len(), 1);
    }
    #[test]
    fn denied_question_scope_cannot_write() {
        let (mut h, s) = input_fixture();
        h.mode = "denied";
        assert!(deliver_input_owned("{}", Some(&h), &s).is_err());
        assert!(s.writes.lock().unwrap().is_empty());
    }
    #[test]
    fn input_lost_wrong_double_and_partial_outcome_keep_operation_without_retry() {
        for mode in ["lost", "wrong-receipt", "twice", "partial"] {
            let (mut h, mut s) = input_fixture();
            h.mode = mode;
            s.fail_after_write = mode == "partial";
            let e = deliver_input_owned("{}", Some(&h), &s).unwrap_err();
            assert!(e.contains("operation=delivery"));
            assert_eq!(s.writes.lock().unwrap().len(), 1);
        }
    }
    #[test]
    fn same_route_requires_exact_session_and_native_tuple() {
        for n in 0..3 {
            let (mut h, s) = input_fixture();
            h.intent.target_pane = h.intent.source_pane.clone();
            h.intent.target_ownership.pane = h.intent.source_pane.clone();
            match n {
                0 => (),
                1 => h.intent.target_session = h.intent.source_session.clone(),
                _ => {
                    h.intent.target_session = h.intent.source_session.clone();
                    h.intent.target_ownership = h.intent.source_ownership.clone();
                    h.intent.target_ownership.run_id = "wrong".into();
                }
            }
            assert!(deliver_input_owned("{}", Some(&h), &s).is_err());
            assert!(s.writes.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn recovery_returns_full_exact_unsent_bytes_and_does_not_write() {
        let (h, s) = input_fixture();
        let r = recover_owned("operation", "new", "successor", Some(&h)).unwrap();
        assert_eq!(r, h.recovery);
        assert_eq!(r.draft.sha256, sha256(r.draft.text.as_bytes()));
        assert!(s.writes.lock().unwrap().is_empty());
    }
    #[test]
    fn changed_recovery_target_hash_or_bytes_never_passes() {
        for n in 0..4 {
            let (mut h, s) = input_fixture();
            match n {
                0 => h.recovery.target_session = "wrong".into(),
                1 => h.recovery.draft.sha256 = "0".repeat(64),
                2 => h.recovery.draft.bytes += 1,
                _ => h.recovery.draft.text.push('x'),
            };
            assert!(recover_owned("operation", "new", "successor", Some(&h)).is_err());
            assert!(s.writes.lock().unwrap().is_empty());
        }
    }
}

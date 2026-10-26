//! Concrete daemon-local ownership wrapper. The existing private authority runs
//! INSIDE a physical PTY lease through its full broker publication/error path.
//! Registering only in the UI process cannot initialize this daemon instance.
use crate::handoff_native::{
    self, CommitReceipt, HostOwnedLifecycleBridge, InputReceipt, Proposal,
};
use crate::handoff_native_binding::{self, Activation, Registration};
use crate::pty::PtyManager;
use std::sync::{Arc, OnceLock};
pub(crate) struct DaemonHost {
    manager: Arc<PtyManager>,
    authority: Arc<dyn HostOwnedLifecycleBridge>,
}
static DAEMON_HOST: OnceLock<DaemonHost> = OnceLock::new();
pub(crate) fn initialize_daemon_host(manager: Arc<PtyManager>) -> Result<bool, String> {
    let Some(authority) = handoff_native::registered_host() else {
        return Ok(false);
    };
    DAEMON_HOST
        .set(DaemonHost { manager, authority })
        .map_err(|_| "daemon private host already initialized")?;
    Ok(true)
}
pub(crate) fn daemon_host() -> Result<&'static DaemonHost, String> {
    DAEMON_HOST
        .get()
        .ok_or("daemon authenticated host/bootstrap unavailable; zero native effects".into())
}
impl DaemonHost {
    pub(crate) fn commit(&self, p: &Proposal) -> Result<CommitReceipt, String> {
        self.manager.with_host_owned_operation(|lease| {
            handoff_native::execute(p, Some(self.authority.as_ref()), lease)
        })
    }
    pub(crate) fn recover(
        &self,
        op: &str,
        pane: &str,
        session: &str,
    ) -> Result<handoff_native::Recovery, String> {
        self.manager.with_host_owned_operation(|_| {
            handoff_native::recover_owned(op, pane, session, Some(self.authority.as_ref()))
        })
    }
    pub(crate) fn input(&self, p: &str) -> Result<InputReceipt, String> {
        self.manager.with_host_owned_operation(|lease| {
            handoff_native::deliver_input_owned(p, Some(self.authority.as_ref()), lease)
        })
    }
    pub(crate) fn register(&self, p: &str) -> Result<Registration, String> {
        self.manager.with_host_owned_operation(|lease| {
            handoff_native_binding::register(p, self.authority.as_ref(), lease)
        })
    }
    pub(crate) fn activate(&self, p: &str) -> Result<Activation, String> {
        self.manager.with_host_owned_operation(|lease| {
            handoff_native_binding::activate(p, self.authority.as_ref(), lease)
        })
    }
}

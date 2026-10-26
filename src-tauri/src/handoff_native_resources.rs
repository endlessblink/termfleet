//! Concrete participant guard for the existing per-pane source journal and
//! enrolled immutable document snapshots. No signer, broker or second ledger.
//! This excludes the existing publisher's mkdir-lock participants; it does not
//! claim exclusion of arbitrary filesystem editors or prove human authority.
use crate::handoff_native::sha256;
use crate::handoff_native_bridge::{HeldResources, ResourceOwner, Scope};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::collections::HashSet;

#[derive(Clone)]
pub(crate) struct FrozenBytes { pub path: PathBuf, pub bytes: usize, pub sha256: String }
pub(crate) struct CaptureResourceOwner {
    scope: Scope, directory: PathBuf, lock: PathBuf, source: Vec<FrozenBytes>,
    snapshot_root: PathBuf, documents: Vec<FrozenBytes>, uncertain: Mutex<bool>,
    recovery_helper: Option<PathBuf>, last_recovery: Mutex<Option<serde_json::Value>>,
}
fn actual_directory(p: &Path) -> Result<PathBuf, String> {
    if !p.is_absolute() { return Err("resource path is not absolute".into()); }
    let m = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    if !m.is_dir() || m.file_type().is_symlink() { return Err("resource directory redirected".into()); }
    let real = p.canonicalize().map_err(|e| e.to_string())?;
    if real != p { return Err("resource ancestor redirected".into()); }
    Ok(real)
}
fn verify(file: &FrozenBytes, root: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(&file.path).map_err(|e| e.to_string())?;
    if !m.is_file() || m.file_type().is_symlink() || !file.path.starts_with(root) ||
        file.path.canonicalize().map_err(|e| e.to_string())? != file.path {
        return Err("enrolled resource is not confined regular bytes".into());
    }
    // Exact whole bytes, not a prefix/file-name receipt; appended late tail denies.
    let bytes = fs::read(&file.path).map_err(|e| e.to_string())?;
    if bytes.len() != file.bytes || sha256(&bytes) != file.sha256 {
        return Err("enrolled source/document frontier changed".into());
    }
    Ok(())
}
fn captured_paths(directory: &Path, head_name: &str) -> Result<HashSet<PathBuf>, String> {
    let prefix = head_name.strip_suffix(".json").ok_or("invalid capture head name")?;
    let mut paths = HashSet::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let p = entry.map_err(|e| e.to_string())?.path();
        let name = p.file_name().and_then(|s| s.to_str()).ok_or("capture path encoding invalid")?;
        if name.starts_with(&format!("{prefix}-")) && name.contains("-pending-") && name.ends_with(".json") {
            // Retention before admission is intentionally allowed during a lease.
            // This frontier never confers permission or a committed sequence.
            return Err("observed pending source is unadmitted; no stale native effect".into());
        }
        if name == head_name || (name.starts_with(&format!("{prefix}-")) && name.ends_with(".jsonl")) {
            paths.insert(p);
        }
    }
    if !paths.contains(&directory.join(head_name)) { return Err("complete source head missing".into()); }
    Ok(paths)
}
impl CaptureResourceOwner {
    // Called only by a private source host after authentic enrollment. Source
    // receipts include the exact head and every selected journal; snapshot paths
    // must be its owned immutable copies, never arbitrary caller-chosen docs.
    pub(crate) fn enroll(scope: Scope, directory: PathBuf, source: Vec<FrozenBytes>,
        snapshot_root: PathBuf, documents: Vec<FrozenBytes>) -> Result<Self, String> {
        let directory = actual_directory(&directory)?;
        let snapshot_root = actual_directory(&snapshot_root)?;
        if source.is_empty() || documents.len() != scope.documents.len() {
            return Err("complete enrolled source/snapshots missing".into());
        }
        for (file, doc) in documents.iter().zip(&scope.documents) {
            if file.path.to_str() != Some(doc.path.as_str()) || file.sha256 != doc.sha256 {
                return Err("enrolled immutable document binding mismatch".into());
            }
            verify(file, &snapshot_root)?;
        }
        for file in &source { verify(file, &directory)?; }
        // Exact existing JS FNV-1a over UTF-16 code units, including Unicode panes.
        let mut hash: u32 = 2166136261;
        for unit in scope.binding.source_pane.encode_utf16() { hash = (hash ^ u32::from(unit)).wrapping_mul(16777619); }
        let head_name = format!("events-{hash:08x}.json");
        let head: serde_json::Value = serde_json::from_slice(&fs::read(directory.join(&head_name)).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if head["identity"]["paneId"] != scope.binding.source_pane || head["identity"]["sessionId"] != scope.binding.source_session || head["provider"] != scope.binding.provider {
            return Err("observed source head does not bind enrolled provider/session/pane".into());
        }
        let captured = captured_paths(&directory, &head_name)?;
        let supplied: HashSet<_> = source.iter().map(|f| f.path.clone()).collect();
        if supplied.len() != source.len() || captured != supplied { return Err("complete source file set/watermark not enrolled".into()); }
        let lock = directory.join(format!("{head_name}.lock"));
        let recovery_helper = crate::handoff_native_bridge::source_recovery_helper();
        #[cfg(not(test))] if recovery_helper.is_none() { return Err("installed observed source recovery helper missing; no enrollment".into()); }
        Ok(Self {scope, directory, lock, source, snapshot_root, documents, uncertain: Mutex::new(false), recovery_helper, last_recovery: Mutex::new(None)})
    }
    #[cfg(test)] pub(crate) fn with_test_recovery_helper(mut self, script: PathBuf) -> Self { self.recovery_helper = Some(script); self }
    #[cfg(test)] pub(crate) fn recovery_receipt(&self) -> Option<serde_json::Value> { self.last_recovery.lock().ok()?.clone() }
}
struct CaptureHeld<'a> { owner: &'a CaptureResourceOwner, state: MutexGuard<'a, bool> }
impl ResourceOwner for CaptureResourceOwner {
    fn acquire(&self) -> Result<Box<dyn HeldResources + '_>, String> {
        let state = self.uncertain.try_lock().map_err(|_| "source ownership busy")?;
        if *state { return Err("source operation uncertain; reconcile before another claim".into()); }
        // Do not steal even an apparently dead owner: existing recovery policy is
        // the publisher's responsibility. Busy frames remain retained/unadmitted.
        fs::create_dir(&self.lock).map_err(|e| format!("existing pane journal busy: {e}"))?;
        let held = CaptureHeld {owner:self,state};
        let mut owner = OpenOptions::new().write(true).create_new(true).open(self.lock.join("owner"))
            .map_err(|e| e.to_string())?;
        owner.write_all(std::process::id().to_string().as_bytes()).and_then(|_| owner.sync_all()).map_err(|e| e.to_string())?;
        held.validate(&self.scope)?;
        Ok(Box::new(held))
    }
}
impl HeldResources for CaptureHeld<'_> {
    fn validate(&self, scope: &Scope) -> Result<(), String> {
        if scope != &self.owner.scope { return Err("enrolled scope/head/binding mismatch".into()); }
        let head_name = self.owner.lock.file_name().and_then(|s| s.to_str()).and_then(|s| s.strip_suffix(".lock")).ok_or("capture lock binding missing")?;
        let current = captured_paths(&self.owner.directory, head_name)?;
        if current != self.owner.source.iter().map(|f| f.path.clone()).collect() {
            return Err("complete source file frontier changed".into());
        }
        for file in &self.owner.source { verify(file, &self.owner.directory)?; }
        for file in &self.owner.documents { verify(file, &self.owner.snapshot_root)?; }
        Ok(())
    }
    fn complete(&mut self) -> Result<(), String> { self.validate(&self.owner.scope) }
    fn uncertain(&mut self, _: Option<&str>) -> Result<(), String> { *self.state = true; Ok(()) }
}
impl Drop for CaptureHeld<'_> {
    fn drop(&mut self) {
        // Own exact files only; never recursively remove an unknown lock tree.
        let _ = fs::remove_file(self.owner.lock.join("owner"));
        let released = fs::remove_dir(&self.owner.lock).is_ok();
        if let Some(script) = &self.owner.recovery_helper {
            let result = if released {
                crate::handoff_native_bridge::recover_observed_source(script, &self.owner.directory,
                    &self.owner.scope.binding.source_pane, &self.owner.scope.binding.provider)
            } else { Err("source lock release unverified; retained originals remain pending".into()) };
            let receipt = match result {
                Ok(receipt) => {
                    // New observed records invalidate this enrolled frontier.
                    // Recovery never clears native/broker uncertainty or approval.
                    if receipt["receipts"].as_array().is_none_or(|r| !r.is_empty()) { *self.state = true; }
                    receipt
                },
                Err(error) => { *self.state = true; serde_json::json!({"ok":false,"status":"unverified","trust":"observed","acknowledged":false,"forwarded":false,"error":error}) },
            };
            if let Ok(mut last) = self.owner.last_recovery.lock() { *last = Some(receipt); }
        }
    }
}

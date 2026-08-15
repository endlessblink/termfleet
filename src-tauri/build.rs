use std::fs;
use std::path::Path;

fn track_frontend(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            track_frontend(&child);
        } else {
            println!("cargo:rerun-if-changed={}", child.display());
        }
    }
}

fn main() {
    // The frontend is EMBEDDED into this binary at compile time (`frontendDist` in
    // tauri.conf.json). Cargo only tracks Rust sources, so `cargo build --release`
    // run after `npm run build` relinked nothing and kept serving the OLD UI — the
    // binary looked freshly built and behaved days out of date. That silently swallowed
    // several rounds of frontend fixes (2026-07-26): every "rebuild and relaunch" was a
    // no-op for the UI. Re-run this script, and with it the asset embed, whenever the
    // built frontend changes.
    track_frontend(Path::new("../dist"));
    tauri_build::build();
}

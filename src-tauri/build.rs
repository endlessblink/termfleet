fn main() {
    // The frontend is EMBEDDED into this binary at compile time (`frontendDist` in
    // tauri.conf.json). Cargo only tracks Rust sources, so `cargo build --release`
    // run after `npm run build` relinked nothing and kept serving the OLD UI — the
    // binary looked freshly built and behaved days out of date. That silently swallowed
    // several rounds of frontend fixes (2026-07-26): every "rebuild and relaunch" was a
    // no-op for the UI. Re-run this script, and with it the asset embed, whenever the
    // built frontend changes.
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build();
}

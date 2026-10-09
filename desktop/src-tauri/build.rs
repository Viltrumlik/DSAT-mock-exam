// Registering the app's commands here (rather than letting Tauri expose every registered command
// to every window by default) is what makes the ACL per-command: each name below becomes a
// permission `allow-<kebab-name>` that `capabilities/mastersat.json` hands to mastersat.uz and to
// nothing else. Keep this list identical to the invoke_handler in main.rs.
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "app_info",
                "lockdown_precheck",
                "lockdown_close_app",
                "lockdown_enter",
                "lockdown_prove",
                "lockdown_exit",
                "lockdown_heartbeat",
                "battery_status",
                "auth_begin",
                "auth_take_verifier",
                "open_external",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

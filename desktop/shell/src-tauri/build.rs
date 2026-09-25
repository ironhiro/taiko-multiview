fn main() {
    // Declaring the app's own commands generates an "allow-<command>" permission for each,
    // which is what lets a capability grant them - including to the deployed site, which
    // Tauri treats as remote and never lets reach an undeclared command.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["chat_panel"])),
    )
    .expect("failed to run the Tauri build script");
}

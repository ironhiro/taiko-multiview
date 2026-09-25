use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Where the shell gets the page from.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum FrontendMode {
    /// Dev server if it is running, then `RemoteUrl` if set, then the bundled build.
    #[serde(alias = "auto")]
    Auto,

    /// Always the Vite dev server.
    #[serde(alias = "devServer", alias = "devserver")]
    DevServer,

    /// Always the build compiled into this app.
    #[serde(alias = "bundled", alias = "Built", alias = "built")]
    Bundled,

    /// Always `RemoteUrl` - the deployed site.
    #[serde(alias = "remote")]
    Remote,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellSettings {
    pub frontend_mode: FrontendMode,

    pub dev_server_url: String,

    /// The deployed frontend. Same-origin `/api` there too, courtesy of the host rewrite.
    pub remote_url: String,

    /// Only used with the bundled build, which has no proxy in front of it.
    pub api_base_url: String,

    /// Lets every tile start playing without a click - the whole reason this window
    /// exists. On by default because wry creates the webview that way on both platforms.
    pub allow_autoplay_with_sound: bool,
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            frontend_mode: FrontendMode::Auto,
            dev_server_url: "http://localhost:5173".to_string(),
            remote_url: String::new(),
            api_base_url: "http://localhost:5180".to_string(),
            allow_autoplay_with_sound: true,
        }
    }
}

const FILE_NAME: &str = "shell.config.json";

impl ShellSettings {
    /// First file that exists wins; missing keys keep their default.
    ///
    /// 1. `$TAIKO_SHELL_CONFIG` - a full path, for trying something out without
    ///    touching an installed copy.
    /// 2. `shell.config.json` beside the executable - portable installs on Windows.
    /// 3. `<app config dir>/shell.config.json` - the editable copy on macOS, where
    ///    the executable lives inside the .app bundle and should stay untouched.
    pub fn load(app: &tauri::App) -> Self {
        for candidate in Self::candidates(app) {
            if !candidate.is_file() {
                continue;
            }

            match Self::read(&candidate) {
                Ok(settings) => {
                    println!("shell config: {}", candidate.display());
                    return settings;
                }
                // A typo in the config must not stop the window from opening; the
                // defaults are a working configuration on their own.
                Err(err) => eprintln!("ignoring {}: {err}", candidate.display()),
            }
        }

        Self::default()
    }

    fn candidates(app: &tauri::App) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        if let Some(explicit) = std::env::var_os("TAIKO_SHELL_CONFIG") {
            paths.push(PathBuf::from(explicit));
        }

        if let Some(directory) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) {
            paths.push(directory.join(FILE_NAME));
        }

        if let Ok(directory) = app.path().app_config_dir() {
            paths.push(directory.join(FILE_NAME));
        }

        paths
    }

    fn read(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path).map_err(|err| err.to_string())?;

        // Editors on Windows save JSON with a UTF-8 BOM, which serde_json rejects.
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);

        serde_json::from_str(text).map_err(|err| err.to_string())
    }
}

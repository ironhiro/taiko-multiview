//! The venue editor's reach outside the page: the one settings file it edits, and
//! YouTube's public pages for looking channels up. Everything else - parsing, editing,
//! validating - happens in the page.
//!
//! Both are fenced in, because the page may be served from elsewhere (the dev server,
//! the deployed site): it can only ever write to the file the viewer picked or the shell
//! found, never to a path of its own choosing, and it can only fetch from YouTube.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// The settings file this session edits. Set by `editor_open`, the only way in.
#[derive(Default)]
pub struct EditorFile(Mutex<Option<PathBuf>>);

#[derive(serde::Serialize)]
pub struct OpenedFile {
    path: String,
    text: String,
}

/// Opens the backend's appsettings.json - found by walking up from the app, or picked
/// in a file dialog when `pick` is set or nothing was found.
#[tauri::command]
pub async fn editor_open(app: AppHandle, file: State<'_, EditorFile>, pick: bool) -> Result<Option<OpenedFile>, String> {
    let path = if pick { None } else { find_default_path() };

    let path = match path {
        Some(path) => path,
        None => {
            let picked = app
                .dialog()
                .file()
                .set_title("appsettings.json 선택")
                .add_filter("JSON", &["json"])
                .blocking_pick_file();

            match picked.and_then(|picked| picked.into_path().ok()) {
                Some(path) => path,
                None => return Ok(None), // Cancelled.
            }
        }
    };

    let text = std::fs::read_to_string(&path).map_err(|err| format!("{}: {err}", path.display()))?;
    // Notepad and PowerShell write a BOM; JSON.parse in the page would choke on it.
    let text = text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text);

    *file.0.lock().unwrap() = Some(path.clone());
    Ok(Some(OpenedFile { path: path.display().to_string(), text }))
}

/// Writes the edited settings back over the file that was opened. The text must be a
/// JSON object - a page bug should never be able to leave the backend unable to start.
#[tauri::command]
pub async fn editor_save(file: State<'_, EditorFile>, text: String) -> Result<(), String> {
    let Some(path) = file.0.lock().unwrap().clone() else {
        return Err("먼저 설정 파일을 열어 주세요.".to_string());
    };

    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(_)) => {}
        Ok(_) => return Err("최상위가 JSON 객체가 아닙니다.".to_string()),
        Err(err) => return Err(format!("JSON이 올바르지 않습니다: {err}")),
    }

    // Written beside the file and then moved over it, so a crash mid-write cannot leave
    // half a settings file behind.
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text.as_bytes()).map_err(|err| err.to_string())?;
    std::fs::rename(&temp, &path).map_err(|err| err.to_string())?;
    Ok(())
}

/// Fetches a page or feed from www.youtube.com as text - channel pages to read an id out
/// of, RSS feeds for recent titles. The page cannot do it itself (CORS), and nothing
/// but YouTube is reachable through here.
#[tauri::command]
pub async fn editor_fetch(url: String) -> Result<String, String> {
    let parsed = tauri::Url::parse(&url).map_err(|err| err.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("www.youtube.com") {
        return Err(format!("YouTube 주소만 조회할 수 있습니다: {url}"));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).build();
        let response = agent
            .get(parsed.as_str())
            // YouTube serves a trimmed page to clients it does not recognise.
            .set(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
            )
            .set("Accept-Language", "ko-KR,ko;q=0.9,en;q=0.8")
            .call()
            .map_err(|err| err.to_string())?;

        let mut body = String::new();
        use std::io::Read;
        response
            .into_reader()
            .take(8 * 1024 * 1024)
            .read_to_string(&mut body)
            .map_err(|err| err.to_string())?;
        Ok(body)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// backend/TaikoLabs.Api/appsettings.json, looked for above the app and above the
/// working directory - the first covers a dev build, the second a copied binary run
/// from the repository.
fn find_default_path() -> Option<PathBuf> {
    let relative = Path::new("backend").join("TaikoLabs.Api").join("appsettings.json");

    let starts = [
        std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)),
        std::env::current_dir().ok(),
    ];

    starts.into_iter().flatten().find_map(|start| {
        start
            .ancestors()
            .map(|dir| dir.join(&relative))
            .find(|candidate| candidate.is_file())
    })
}

/// Opens the editor in a window of its own, beside the multiview, or brings it forward.
pub fn open_editor_window(app: &AppHandle, page: tauri::Url) {
    if let Some(window) = app.get_webview_window(crate::EDITOR_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let mut url = page;
    url.set_query(Some("screen=editor"));
    url.set_fragment(None);

    // The bundled build is served on the app's own scheme, not over http.
    let webview_url = if matches!(url.scheme(), "http" | "https") {
        tauri::WebviewUrl::External(url)
    } else {
        tauri::WebviewUrl::CustomProtocol(url)
    };

    let result = tauri::WebviewWindowBuilder::new(app, crate::EDITOR_WINDOW_LABEL, webview_url)
        .title("매장 등록기 — 태고 멀티뷰")
        .inner_size(1180.0, 860.0)
        .min_inner_size(900.0, 600.0)
        // Links in the editor (a channel page, say) go to the browser.
        .on_new_window(|url, _features| {
            crate::open_in_browser(&url);
            tauri::webview::NewWindowResponse::Deny
        })
        .build();

    if let Err(err) = result {
        eprintln!("could not open the venue editor ({err})");
    }
}

// Cross-platform shell for the Taiko multiview: WebView2 on Windows, WKWebView
// on macOS, one codebase.
//
// The shell exists for one reason. Browsers refuse unmuted autoplay, so a multiview
// in a tab always starts silent. wry builds its webview with autoplay enabled by
// default - it sets mediaTypesRequiringUserActionForPlayback to None on WKWebView and
// passes --autoplay-policy=no-user-gesture-required to WebView2 - which is exactly the
// restriction this window is here to lift. Nothing below has to ask for it.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod editor;
mod settings;

use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use settings::{FrontendMode, ShellSettings};
use tauri::menu::{IsMenuItem, Menu, MenuItem, Submenu};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::ipc::CapabilityBuilder;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewBuilder, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const WINDOW_LABEL: &str = "main";
const CHAT_WINDOW_LABEL: &str = "chat";
const CHAT_PANEL_LABEL: &str = "chat-panel";
const EDITOR_WINDOW_LABEL: &str = "editor";

/// WKWebView's default user agent stops before the "Version/x Safari/y" part, and YouTube
/// reads that as an outdated browser: its live chat asks to update, and Google refuses
/// sign-in from what looks like an embedded webview. Both windows therefore present
/// themselves as the Safari installed on this Mac - the same WebKit they run on, so
/// nothing is claimed that the engine cannot do. Read at startup, so it never goes stale.
#[cfg(target_os = "macos")]
fn user_agent() -> Option<String> {
    let version = Command::new("defaults")
        .args(["read", "/Applications/Safari.app/Contents/Info.plist", "CFBundleShortVersionString"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| "26.0".to_string());

    Some(format!(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{version} Safari/605.1.15"
    ))
}

/// WebView2 already identifies as current Edge.
#[cfg(not(target_os = "macos"))]
fn user_agent() -> Option<String> {
    None
}

/// The chat URL last asked for, so the chat window can find its way back to it.
#[derive(Default)]
struct ChatTarget(Mutex<Option<Url>>);

fn main() {
    tauri::Builder::default()
        .manage(ChatTarget::default())
        .manage(MultiviewHome::default())
        .manage(ChatPanelVideo::default())
        .manage(editor::EditorFile::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            chat_panel,
            editor::editor_open,
            editor::editor_save,
            editor::editor_fetch,
        ])
        .setup(|app| {
            let settings = ShellSettings::load(app);
            let target = resolve_target(&settings);

            // A page served from elsewhere (the dev server, the deployed site) counts as
            // remote, and remote pages reach no app command unless a capability names
            // their origin. These name exactly the page being loaded, and give each
            // window only its own commands: the chat panel to the multiview, file and
            // YouTube access to the editor.
            if let WebviewUrl::External(url) = &target.url {
                let port = url.port().map(|port| format!(":{port}")).unwrap_or_default();
                let origin = format!("{}://{}{port}/*", url.scheme(), url.host_str().unwrap_or_default());
                app.add_capability(
                    CapabilityBuilder::new("multiview-remote")
                        .remote(origin.clone())
                        .window(WINDOW_LABEL)
                        .permission("allow-chat-panel"),
                )?;
                app.add_capability(
                    CapabilityBuilder::new("editor-remote")
                        .remote(origin)
                        .window(EDITOR_WINDOW_LABEL)
                        .permission("allow-editor-open")
                        .permission("allow-editor-save")
                        .permission("allow-editor-fetch"),
                )?;
            }

            let handle = app.handle().clone();

            let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, target.url)
                .title(format!("태고 멀티뷰 — {}", target.description))
                .inner_size(1280.0, 960.0)
                .min_inner_size(380.0, 360.0)
                .center()
                // The page asks for new windows with window.open and target="_blank".
                // Without this they go nowhere inside the shell.
                .on_new_window(move |url, _features| {
                    open_elsewhere(&handle, url);
                    NewWindowResponse::Deny
                })
                .on_page_load(keep_page_in_place)
                // The page names the venue on screen; the title keeps saying which
                // frontend was loaded after it, so that is never a guess.
                .on_document_title_changed({
                    let source = target.description.clone();
                    move |window, title| {
                        let _ = window.set_title(&format!("{title} — {source}"));
                    }
                });

            if let Some(agent) = user_agent() {
                builder = builder.user_agent(&agent);
            }

            if target.inject_api_base {
                // Runs before any of the page's own script, so lib/api.ts sees it.
                builder = builder.initialization_script(format!(
                    "window.__TAIKO_API_BASE__ = {};",
                    serde_json::to_string(&settings.api_base_url)?
                ));
            }

            // Turning autoplay off means dropping wry's flag while keeping the rest of
            // what it passes. WebView2 only: WKWebView takes its media policy at
            // creation time and Tauri exposes no switch for it.
            #[cfg(target_os = "windows")]
            if !settings.allow_autoplay_with_sound {
                builder = builder.additional_browser_args(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
                );
            }

            #[cfg(not(target_os = "windows"))]
            if !settings.allow_autoplay_with_sound {
                eprintln!("allowAutoplayWithSound is Windows-only; tiles can still start with sound");
            }

            let window = builder.build()?;
            install_menu(app, &window)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("could not start the Taiko Multiview shell");
}

// ------------------------------------------------------------------- new windows

/// The last address the multiview window showed itself at, to come back to.
#[derive(Default)]
struct MultiviewHome(Mutex<Option<Url>>);

/// Keeps the multiview window on the multiview.
///
/// The embedded chat's "sign in" link targets the top frame, so a click there replaced
/// the whole multiview with Google's sign-in and, after it, YouTube's home page. When
/// the window starts loading a page of another site, it is sent straight back, and the
/// page opens where it belongs instead: sign-in in the chat window, anything else in
/// the browser.
///
/// Page-load events only fire for the window's own top frame. The players and the chat
/// run whole sign-in round trips in their frames on their own, and a hook that sees
/// frame navigations too cannot tell those apart from the viewer's click.
fn keep_page_in_place(window: WebviewWindow, payload: tauri::webview::PageLoadPayload<'_>) {
    let url = payload.url().clone();
    let home = window.state::<MultiviewHome>();

    let Some(current_home) = home.0.lock().unwrap().clone() else {
        // The very first load is the multiview itself.
        if payload.event() == PageLoadEvent::Finished {
            *home.0.lock().unwrap() = Some(url);
        }
        return;
    };

    if same_site(&url, &current_home) {
        match payload.event() {
            // The page is reloading and forgets its open chat; the panel webview would
            // otherwise sit there orphaned over the fresh page.
            PageLoadEvent::Started => close_chat_panel(window.app_handle()),
            PageLoadEvent::Finished => *home.0.lock().unwrap() = Some(url),
        }
        return;
    }

    if payload.event() != PageLoadEvent::Started {
        return;
    }

    let _ = window.navigate(current_home.clone());

    // A YouTube player can take the whole window to Google's passive sign-in check on
    // its own (seen once per launch). Nobody asked for that page, so nothing opens.
    if url.query_pairs().any(|(key, value)| key == "passive" && value == "true") {
        eprintln!("[nav] passive sign-in check took the multiview; sent back to {current_home}");
        return;
    }

    eprintln!("[nav] multiview was leaving for {url}; sent back to {current_home}");

    let handle = window.app_handle().clone();
    let _ = window.app_handle().run_on_main_thread(move || open_elsewhere(&handle, url));
}

// -------------------------------------------------------------------- chat panel

/// The broadcast whose chat the panel webview is showing.
#[derive(Default)]
struct ChatPanelVideo(Mutex<Option<String>>);

/// Where the panel sits, in the page's CSS pixels - the window's logical pixels.
#[derive(serde::Deserialize)]
struct PanelBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Shows a broadcast's chat as a webview of its own, laid over the multiview's chat panel.
///
/// Inside the page the chat would be a youtube.com frame in someone else's site, and
/// WebKit's tracking prevention keeps the viewer's YouTube sign-in from such frames: it
/// could be read but never written to. As a webview of its own it is youtube.com proper,
/// signs in like any site, and keeps the sign-in.
///
/// The page calls this with the video and the panel's bounds whenever either changes,
/// and with neither to close it. Async on purpose: add_child waits on the main thread,
/// where a synchronous command would already be running.
#[tauri::command]
async fn chat_panel(
    window: tauri::Window,
    video_id: Option<String>,
    bounds: Option<PanelBounds>,
) -> Result<(), String> {
    let app = window.app_handle().clone();

    let (Some(video_id), Some(bounds)) = (video_id, bounds) else {
        close_chat_panel(&app);
        return Ok(());
    };

    // The id goes into a URL; YouTube's ids are letters, digits, '-' and '_' only.
    if video_id.is_empty() || !video_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("not a YouTube video id: {video_id}"));
    }

    let url = Url::parse(&format!(
        "https://www.youtube.com/live_chat?is_popout=1&dark_theme=1&v={video_id}"
    ))
    .map_err(|err| err.to_string())?;
    let position = LogicalPosition::new(bounds.x, bounds.y + title_bar_height(&window));
    let size = LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0));
    let showing = app.state::<ChatPanelVideo>();
    log_panel_geometry(&window, &bounds);

    if let Some(panel) = app.get_webview(CHAT_PANEL_LABEL) {
        panel.set_position(position).map_err(|err| err.to_string())?;
        panel.set_size(size).map_err(|err| err.to_string())?;

        let mut current = showing.0.lock().unwrap();
        if current.as_deref() != Some(video_id.as_str()) {
            panel.navigate(url).map_err(|err| err.to_string())?;
            *current = Some(video_id);
        }
        return Ok(());
    }

    let handle = app.clone();
    let mut builder = WebviewBuilder::new(CHAT_PANEL_LABEL, WebviewUrl::External(url))
        .initialization_script(RETURN_TO_CHAT_SCRIPT)
        // Sign-in pop-ups stay in the panel, where the sign-in is wanted; other links
        // (channel pages, super chat terms) go to the browser.
        .on_new_window(move |url, _features| {
            if is_sign_in(&url) {
                if let Some(panel) = handle.get_webview(CHAT_PANEL_LABEL) {
                    let _ = panel.navigate(url);
                }
            } else {
                open_in_browser(&url);
            }
            NewWindowResponse::Deny
        });

    if let Some(agent) = user_agent() {
        builder = builder.user_agent(&agent);
    }

    window.add_child(builder, position, size).map_err(|err| err.to_string())?;
    *showing.0.lock().unwrap() = Some(video_id);
    eprintln!("[panel] chat panel opened");
    Ok(())
}

/// How far a child webview lands above where it was asked to be.
///
/// The window's content runs up under its title bar: the page's view is as tall as the
/// whole window (787 against a 759 content layout, measured), and WebKit shifts the page
/// down by the difference so nothing hides under the bar. The page reports its bounds in
/// its own unshifted coordinates, so a webview placed at them sat one title bar too high
/// and covered the panel's header. The gap between the window's frame and its content
/// layout rect is that shift. Asked of AppKit directly - Tauri reports the window's outer
/// and inner sizes as equal here - on the main thread, where AppKit wants it.
#[cfg(target_os = "macos")]
fn title_bar_height(window: &tauri::Window) -> f64 {
    use std::sync::mpsc::channel;

    let (sender, receiver) = channel();
    let ns_window = window.clone();
    let queued = window.run_on_main_thread(move || {
        let gap = ns_window.ns_window().ok().map(|handle| unsafe {
            let handle = handle as *mut objc2::runtime::AnyObject;
            let frame: objc2_foundation::NSRect = objc2::msg_send![handle, frame];
            let layout: objc2_foundation::NSRect = objc2::msg_send![handle, contentLayoutRect];
            (frame.size.height - layout.size.height).max(0.0)
        });
        let _ = sender.send(gap);
    });

    if queued.is_err() {
        return 0.0;
    }

    receiver
        .recv_timeout(Duration::from_secs(1))
        .ok()
        .flatten()
        .unwrap_or(0.0)
}

#[cfg(not(target_os = "macos"))]
fn title_bar_height(_window: &tauri::Window) -> f64 {
    0.0
}

/// What the page asked for against what the window and the webview actually are, for
/// telling a misplaced panel from a mis-sized one.
fn log_panel_geometry(window: &tauri::Window, bounds: &PanelBounds) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let inner = window.inner_size().map(|size| size.to_logical::<f64>(scale));
    let placed = window.app_handle().get_webview(CHAT_PANEL_LABEL).map(|panel| {
        (
            panel.position().map(|p| p.to_logical::<f64>(scale)),
            panel.size().map(|s| s.to_logical::<f64>(scale)),
        )
    });
    eprintln!(
        "[panel] asked x={:.0} y={:.0} w={:.0} h={:.0} | title bar {:.0} | window {:?} scale {scale} | placed {:?}",
        bounds.x, bounds.y, bounds.width, bounds.height, title_bar_height(window), inner.map(|s| (s.width, s.height)).ok(),
        placed.map(|(p, s)| (p.map(|p| (p.x, p.y)).ok(), s.map(|s| (s.width, s.height)).ok())),
    );
}

fn close_chat_panel(app: &AppHandle) {
    if let Some(panel) = app.get_webview(CHAT_PANEL_LABEL) {
        let _ = panel.close();
        eprintln!("[panel] chat panel closed");
    }
    *app.state::<ChatPanelVideo>().0.lock().unwrap() = None;
}

/// Url::origin is opaque - never equal, even to itself - for the bundled build's own
/// tauri:// scheme, so the parts are compared directly.
fn same_site(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// Where a new-window request from the multiview goes.
///
/// YouTube's live chat, and the Google / YouTube sign-in that the chat's "sign in" button
/// starts, open in the app's chat window - signing in anywhere else (the system browser)
/// would leave the app signed out. Anything else is a plain link for the system browser.
fn open_elsewhere(app: &AppHandle, url: Url) {
    if is_live_chat(&url) {
        eprintln!("[chat] open chat {url}");
        *app.state::<ChatTarget>().0.lock().unwrap() = Some(url.clone());
        show_in_chat_window(app, url);
    } else if is_sign_in(&url) {
        eprintln!("[chat] sign-in from the page {url}");
        if let Some(chat) = chat_url_inside(&url) {
            *app.state::<ChatTarget>().0.lock().unwrap() = Some(chat);
        }
        show_in_chat_window(app, url);
    } else {
        eprintln!("[chat] to the browser {url}");
        open_in_browser(&url);
    }
}

/// One chat window, reused for whichever chat is asked for next.
///
/// Built fresh rather than handed back to the page as its opener, which would tie it to
/// the page's webview configuration; the page never talks to it.
fn show_in_chat_window(app: &AppHandle, url: Url) {
    if let Some(chat) = app.get_webview_window(CHAT_WINDOW_LABEL) {
        let _ = chat.navigate(url);
        let _ = chat.show();
        let _ = chat.set_focus();
        return;
    }

    let handle = app.clone();
    let mut builder = WebviewWindowBuilder::new(app, CHAT_WINDOW_LABEL, WebviewUrl::External(url))
        .title("라이브 채팅")
        .inner_size(420.0, 720.0)
        .min_inner_size(320.0, 400.0)
        .initialization_script(RETURN_TO_CHAT_SCRIPT)
        .on_page_load(return_to_chat)
        // The chat's own sign-in may ask for a new window; keep it in this one.
        .on_new_window(move |url, _features| {
            eprintln!("[chat] new window from the chat {url}");
            if let Some(chat) = handle.get_webview_window(CHAT_WINDOW_LABEL) {
                let _ = chat.navigate(url);
            }
            NewWindowResponse::Deny
        });

    if let Some(agent) = user_agent() {
        builder = builder.user_agent(&agent);
    }

    if let Err(err) = builder.build() {
        eprintln!("could not open the chat window ({err})");
    }
}

/// Signing in from the chat ends on YouTube's home page or the video's watch page, not
/// back in the chat. YouTube often gets there by rewriting the address in place rather
/// than loading a page, so no page-load event fires; this script, run on every page of
/// the chat window, watches the address itself. On a chat it remembers the address; on
/// the home or watch page it goes back to the remembered chat.
const RETURN_TO_CHAT_SCRIPT: &str = r#"
(() => {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  const KEY = 'taikoChat';
  const check = () => {
    if (location.pathname.startsWith('/live_chat')) {
      sessionStorage.setItem(KEY, location.href);
    } else if (location.pathname === '/' || location.pathname === '/watch') {
      const target = sessionStorage.getItem(KEY);
      if (target) location.replace(target);
    }
  };
  check();
  setInterval(check, 700);
})();
"#;

/// The page-load half: hands the script the chat to return to when the window never saw
/// one itself (sign-in started from the multiview's panel), and covers real page loads.
fn return_to_chat(window: WebviewWindow, payload: tauri::webview::PageLoadPayload<'_>) {
    if payload.event() != PageLoadEvent::Finished {
        return;
    }

    let url = payload.url();
    eprintln!("[chat] loaded {url}");

    if !is_youtube(url) {
        return;
    }

    let Some(target) = window.state::<ChatTarget>().0.lock().unwrap().clone() else {
        return;
    };

    if let Ok(quoted) = serde_json::to_string(target.as_str()) {
        let _ = window.eval(format!("sessionStorage.setItem('taikoChat', {quoted})"));
    }

    if url.path() == "/" || url.path() == "/watch" {
        eprintln!("[chat] back to {target}");
        let _ = window.navigate(target);
    }
}

fn is_youtube(url: &Url) -> bool {
    matches!(url.host_str(), Some("www.youtube.com" | "youtube.com" | "m.youtube.com"))
}

fn is_sign_in(url: &Url) -> bool {
    matches!(url.host_str(), Some("accounts.google.com"))
        || (is_youtube(url) && (url.path().starts_with("/signin") || url.path().starts_with("/login")))
}

/// The chat a sign-in URL will return to, found in its continue/next parameters - which
/// may themselves be URLs carrying further parameters, so this looks one level down too.
fn chat_url_inside(url: &Url) -> Option<Url> {
    for (key, value) in url.query_pairs() {
        if key != "continue" && key != "next" {
            continue;
        }

        // Relative values (next=/watch?v=...) are resolved against YouTube.
        let inner = Url::parse(&value).or_else(|_| Url::parse(&format!("https://www.youtube.com{value}")));
        let Ok(inner) = inner else {
            continue;
        };

        if is_live_chat(&inner) {
            return Some(inner);
        }

        // Signing in from the embedded chat returns to the broadcast's watch page; the
        // chat of that same broadcast is where the viewer meant to be.
        if is_youtube(&inner) && inner.path() == "/watch" {
            if let Some((_, video)) = inner.query_pairs().find(|(key, _)| key == "v") {
                return Url::parse(&format!("https://www.youtube.com/live_chat?is_popout=1&v={video}")).ok();
            }
        }

        if let Some(found) = chat_url_inside(&inner) {
            return Some(found);
        }
    }

    None
}

fn is_live_chat(url: &Url) -> bool {
    is_youtube(url) && url.path().starts_with("/live_chat")
}

/// The platform's own "open this" command, to keep a plugin out of the dependencies.
pub(crate) fn open_in_browser(url: &Url) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url.as_str()).spawn();
    // Not `cmd /C start`: cmd would cut the URL at its first '&'.
    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32").args(["url.dll,FileProtocolHandler", url.as_str()]).spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let result = Command::new("xdg-open").arg(url.as_str()).spawn();

    if let Err(err) = result {
        eprintln!("could not open {url} in the browser ({err})");
    }
}

// ------------------------------------------------------------------ start target

struct StartTarget {
    url: WebviewUrl,

    /// Shown in the title bar, so which frontend is loaded is never a guess.
    description: String,

    /// Only the bundled build needs this: the dev server proxies /api itself and the
    /// deployed host rewrites it, so both are already same-origin.
    inject_api_base: bool,
}

fn resolve_target(settings: &ShellSettings) -> StartTarget {
    let dev_server = || {
        if settings.dev_server_url.is_empty() || !is_reachable(&settings.dev_server_url) {
            return None;
        }

        external(&settings.dev_server_url, "개발 서버")
    };

    let remote = || {
        if settings.remote_url.is_empty() {
            return None;
        }

        external(&settings.remote_url, "원격")
    };

    let resolved = match settings.frontend_mode {
        FrontendMode::Auto => dev_server().or_else(remote),

        FrontendMode::DevServer => dev_server().or_else(|| {
            eprintln!(
                "dev server {} is not answering; loading the bundled build instead",
                settings.dev_server_url
            );
            None
        }),

        FrontendMode::Remote => remote().or_else(|| {
            eprintln!("remoteUrl is not set; loading the bundled build instead");
            None
        }),

        FrontendMode::Bundled => None,
    };

    // Falling back never leaves an empty window: the bundled build is compiled in.
    resolved.unwrap_or_else(|| StartTarget {
        url: WebviewUrl::App("index.html".into()),
        description: "번들".to_string(),
        inject_api_base: true,
    })
}

fn external(raw: &str, label: &str) -> Option<StartTarget> {
    match tauri::Url::parse(raw) {
        Ok(url) => Some(StartTarget {
            url: WebviewUrl::External(url),
            description: format!("{label} · {raw}"),
            inject_api_base: false,
        }),
        Err(err) => {
            eprintln!("{raw} is not a valid URL ({err}); ignoring it");
            None
        }
    }
}

/// A TCP connect separates a running dev server from a missing one well enough, and
/// it keeps an HTTP client out of the dependency list.
fn is_reachable(raw: &str) -> bool {
    let Ok(url) = tauri::Url::parse(raw) else {
        return false;
    };

    let Some(host) = url.host_str() else {
        return false;
    };

    let Some(port) = url.port_or_known_default() else {
        return false;
    };

    let Ok(mut addresses) = (host, port).to_socket_addrs() else {
        return false;
    };

    addresses.any(|address| TcpStream::connect_timeout(&address, Duration::from_millis(700)).is_ok())
}

// -------------------------------------------------------------------------- menu

/// Accelerators follow each platform's own habit rather than one shared set: F5 and
/// F11 are meaningless on a Mac, where F11 belongs to Mission Control.
mod accelerator {
    #[cfg(target_os = "macos")]
    pub const RELOAD: &str = "Cmd+R";
    #[cfg(not(target_os = "macos"))]
    pub const RELOAD: &str = "F5";

    /// macOS gets fullscreen from the default View menu instead.
    #[cfg(not(target_os = "macos"))]
    pub const FULLSCREEN: &str = "F11";

    #[cfg(target_os = "macos")]
    pub const EDITOR: &str = "Cmd+Shift+E";
    #[cfg(not(target_os = "macos"))]
    pub const EDITOR: &str = "Ctrl+Shift+E";

    #[cfg(target_os = "macos")]
    pub const DEVTOOLS: &str = "Cmd+Alt+I";
    #[cfg(not(target_os = "macos"))]
    pub const DEVTOOLS: &str = "F12";
}

fn install_menu(app: &tauri::App, window: &WebviewWindow) -> tauri::Result<()> {
    let reload = MenuItem::with_id(app, "reload", "다시 불러오기", true, Some(accelerator::RELOAD))?;
    let editor = MenuItem::with_id(app, "editor", "매장 등록기", true, Some(accelerator::EDITOR))?;
    let devtools = MenuItem::with_id(app, "devtools", "개발자 도구", true, Some(accelerator::DEVTOOLS))?;

    // Only on Windows: the default menu carries a View submenu with Toggle Fullscreen
    // on macOS already, under the accelerator Mac users reach for. On Windows it has
    // no View submenu at all, so fullscreen has to come from here.
    #[cfg(not(target_os = "macos"))]
    let fullscreen = MenuItem::with_id(app, "fullscreen", "전체화면", true, Some(accelerator::FULLSCREEN))?;

    #[cfg(target_os = "macos")]
    let items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&reload, &editor, &devtools];
    #[cfg(not(target_os = "macos"))]
    let items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&reload, &fullscreen, &editor, &devtools];

    let shell_menu = Submenu::with_items(app, "멀티뷰", true, &items)?;

    // Built on top of the platform default, so macOS keeps the app, Edit and Window
    // menus it expects - without them, even Cmd+Q stops working.
    let menu = Menu::default(app.handle())?;
    menu.append(&shell_menu)?;
    app.set_menu(menu)?;

    let window = window.clone();
    app.on_menu_event(move |handle, event| match event.id().as_ref() {
        "reload" => {
            let _ = window.reload();
        }
        "fullscreen" => {
            let entering = !window.is_fullscreen().unwrap_or(false);
            let _ = window.set_fullscreen(entering);
        }
        "devtools" => window.open_devtools(),
        "editor" => {
            // Opened on the same page the multiview is showing, wherever that is served.
            let page = handle.state::<MultiviewHome>().0.lock().unwrap().clone().or_else(|| window.url().ok());
            if let Some(page) = page {
                editor::open_editor_window(handle, page);
            }
        }
        _ => {}
    });

    Ok(())
}

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
use tauri::{Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const WINDOW_LABEL: &str = "main";
const EDITOR_WINDOW_LABEL: &str = "editor";

/// WKWebView's default user agent stops before the "Version/x Safari/y" part, and YouTube
/// reads that as an outdated browser. The multiview window therefore presents itself as
/// the Safari installed on this Mac - the same WebKit it runs on, so nothing is claimed
/// that the engine cannot do. Read at startup, so it never goes stale.
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

fn main() {
    tauri::Builder::default()
        .manage(MultiviewHome::default())
        .manage(editor::EditorFile::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            editor::editor_open,
            editor::editor_save,
            editor::editor_fetch,
        ])
        .setup(|app| {
            let settings = ShellSettings::load(app);
            let target = resolve_target(&settings);
            let with_editor = editor_allowed(&target, &settings);
            if !with_editor {
                eprintln!("venue editor off: {} is not a local server", target.description);
            }

            // A page served from elsewhere (the dev server, the deployed site) counts as
            // remote, and remote pages reach no app command unless a capability names
            // their origin. This names exactly the page being loaded, and only for the
            // editor window: the multiview itself calls no app command.
            if let WebviewUrl::External(url) = &target.url {
                if with_editor {
                    let port = url.port().map(|port| format!(":{port}")).unwrap_or_default();
                    let origin = format!("{}://{}{port}/*", url.scheme(), url.host_str().unwrap_or_default());
                    app.add_capability(
                        CapabilityBuilder::new("editor-remote")
                            .remote(origin)
                            .window(EDITOR_WINDOW_LABEL)
                            .permission("allow-editor-open")
                            .permission("allow-editor-save")
                            .permission("allow-editor-fetch"),
                    )?;
                }
            }

            let mut builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, target.url)
                .title(format!("태고 멀티뷰 — {}", target.description))
                .inner_size(1280.0, 960.0)
                .min_inner_size(380.0, 360.0)
                .center()
                // The page asks for new windows with window.open and target="_blank".
                // Without this they go nowhere inside the shell; the browser takes them.
                .on_new_window(|url, _features| {
                    open_in_browser(&url);
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
            install_menu(app, &window, with_editor)?;

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
/// A link inside a YouTube frame can target the top frame and replace the whole
/// multiview with another site. When the window starts loading a page of another site,
/// it is sent straight back, and the page opens in the browser instead.
///
/// Page-load events only fire for the window's own top frame. The players run whole
/// sign-in round trips in their frames on their own, and a hook that sees frame
/// navigations too cannot tell those apart from the viewer's click.
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
        if payload.event() == PageLoadEvent::Finished {
            *home.0.lock().unwrap() = Some(url);
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

    open_in_browser(&url);
}

/// Url::origin is opaque - never equal, even to itself - for the bundled build's own
/// tauri:// scheme, so the parts are compared directly.
fn same_site(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
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

/// The venue editor writes venues.json on this machine, which only means something when
/// this machine runs the API: the dev server, or the bundled build talking to a local
/// API. Pointed at the deployed site it would edit a file the live server never reads,
/// so there it is not offered at all.
fn editor_allowed(target: &StartTarget, settings: &ShellSettings) -> bool {
    match &target.url {
        WebviewUrl::External(url) => is_loopback(url),
        _ => tauri::Url::parse(&settings.api_base_url).is_ok_and(|url| is_loopback(&url)),
    }
}

fn is_loopback(url: &tauri::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };

    host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
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

fn install_menu(app: &tauri::App, window: &WebviewWindow, with_editor: bool) -> tauri::Result<()> {
    let reload = MenuItem::with_id(app, "reload", "다시 불러오기", true, Some(accelerator::RELOAD))?;
    let editor = MenuItem::with_id(app, "editor", "매장 등록기", true, Some(accelerator::EDITOR))?;
    let devtools = MenuItem::with_id(app, "devtools", "개발자 도구", true, Some(accelerator::DEVTOOLS))?;

    // Only on Windows: the default menu carries a View submenu with Toggle Fullscreen
    // on macOS already, under the accelerator Mac users reach for. On Windows it has
    // no View submenu at all, so fullscreen has to come from here.
    #[cfg(not(target_os = "macos"))]
    let fullscreen = MenuItem::with_id(app, "fullscreen", "전체화면", true, Some(accelerator::FULLSCREEN))?;

    #[cfg(target_os = "macos")]
    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&reload, &editor, &devtools];
    #[cfg(not(target_os = "macos"))]
    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&reload, &fullscreen, &editor, &devtools];

    if !with_editor {
        items.retain(|item| item.id() != editor.id());
    }

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
        "editor" if with_editor => {
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

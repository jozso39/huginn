//! Huginn for macOS: a thin shell around Huginn's own server.
//!
//! The server (a compiled Bun binary, bundled as a sidecar) does all the work and
//! serves the app; this shell starts it with the secrets on stdin, shows its page in
//! a window, and turns its stdout events into the menu-bar count, the Dock badge and
//! notifications. It also keeps Huginn running in the background, starts it at login
//! and installs updates.

use std::{
    error::Error,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex,
    },
    time::Duration,
};

use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tauri_plugin_updater::UpdaterExt;

/// Fixed so sign-in redirects can be registered with providers (Slack needs an exact
/// port); the server falls back to the next two if it is taken.
const PORT: u16 = 47823;
const UPDATE_EVERY: Duration = Duration::from_secs(60 * 60);
const FIRST_UPDATE_CHECK: Duration = Duration::from_secs(30);
const MAX_SERVER_RESTARTS: u32 = 5;
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const TRAY_ID: &str = "huginn";

type AnyResult<T> = Result<T, Box<dyn Error>>;

/// One JSON line on the server's stdout (see src/infrastructure/desktop/DesktopChannel.ts).
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ServerEvent {
    Ready {
        port: u16,
    },
    Badge {
        important: u32,
    },
    Notify {
        title: String,
        body: String,
    },
}

struct Shell {
    data_dir: PathBuf,
    secret_key: String,
    /// Proves to the server that a request comes from this window.
    launch_token: String,
    server: Mutex<Option<CommandChild>>,
    restarts: AtomicU32,
    quitting: AtomicBool,
    update_ready: AtomicBool,
    restart_item: Mutex<Option<MenuItem<Wry>>>,
    login_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = data_dir(app.handle())?;

            fs::create_dir_all(&data_dir)?;
            app.manage(Shell {
                secret_key: master_key(&data_dir)?,
                launch_token: random_hex(32),
                data_dir: data_dir.clone(),
                server: Mutex::new(None),
                restarts: AtomicU32::new(0),
                quitting: AtomicBool::new(false),
                update_ready: AtomicBool::new(false),
                restart_item: Mutex::new(None),
                login_item: Mutex::new(None),
            });
            build_window(&handle)?;
            build_tray(&handle)?;
            open_at_login_once(&handle, &data_dir);
            start_server(&handle)?;

            // A development build must never replace itself with a release.
            if !cfg!(debug_assertions) {
                spawn_update_checks(handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps Huginn running in the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Huginn could not start")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_window(app),
            RunEvent::Exit => stop_server(app),
            _ => {}
        });
}

/// Where Huginn keeps its database and key. A development build gets its own folder so
/// it can never touch the real data (or poll the same accounts with it).
fn data_dir(app: &AppHandle) -> AnyResult<PathBuf> {
    let dir = app.path().app_data_dir()?;

    if !cfg!(debug_assertions) {
        return Ok(dir);
    }

    let name = dir
        .file_name()
        .map(|name| format!("{}.dev", name.to_string_lossy()))
        .ok_or("no data folder name")?;

    Ok(dir.with_file_name(name))
}

/// The window shows Huginn's own pages; every other link leaves for the browser (or the
/// app it belongs to, like Slack), instead of replacing Huginn or going nowhere.
fn build_window(app: &AppHandle) -> AnyResult<()> {
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("Huginn")
        .inner_size(1200.0, 820.0)
        .min_inner_size(380.0, 480.0)
        .on_navigation(|url| {
            if stays_inside(url) {
                return true;
            }

            open_outside(url);
            false
        })
        .on_new_window(|url, _| {
            open_outside(&url);
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;

    Ok(())
}

/// Huginn's loading page, its local server, and what e-mail frames are made of.
fn stays_inside(url: &url::Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        "http" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost")),
        _ => false,
    }
}

/// Only kinds of links a message may reasonably carry; anything else (file:, other
/// apps' schemes) is ignored rather than handed to macOS.
fn open_outside(url: &url::Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto" | "slack") {
        let _ = std::process::Command::new("/usr/bin/open").arg(url.as_str()).spawn();
    }
}

/// The key that seals every stored token. Created once; copying a server's
/// HUGINN_SECRET_KEY here moves its database over as is.
fn master_key(data_dir: &Path) -> AnyResult<String> {
    let path = data_dir.join("master.key");

    if let Ok(existing) = fs::read_to_string(&path) {
        return Ok(existing.trim().to_string());
    }

    let mut bytes = [0u8; 32];

    rand::rng().fill_bytes(&mut bytes);

    let key = base64::engine::general_purpose::STANDARD.encode(bytes);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)?;

    file.write_all(key.as_bytes())?;

    Ok(key)
}

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];

    rand::rng().fill_bytes(&mut buffer);
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn start_server(app: &AppHandle) -> AnyResult<()> {
    let shell = app.state::<Shell>();
    let resources = app.path().resource_dir()?;
    let (mut events, mut child) = app
        .shell()
        .sidecar("huginn-server")?
        .env("HUGINN_DESKTOP", "1")
        .env("NODE_ENV", "production")
        .env("HUGINN_DATA_DIR", &shell.data_dir)
        .env("HUGINN_RESOURCES_DIR", &resources)
        .env("PORT", PORT.to_string())
        .spawn()?;

    // Secrets go over stdin: never in the environment or the process list.
    let secrets = serde_json::json!({
        "secretKey": shell.secret_key,
        "launchToken": shell.launch_token,
    });

    child.write(format!("{secrets}\n").as_bytes())?;
    *shell.server.lock().expect("server lock") = Some(child);

    let handle = app.clone();
    let log_path = shell.data_dir.join("server.log");

    tauri::async_runtime::spawn(async move {
        let mut log = open_log(&log_path);

        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => on_server_line(&handle, &line),
                CommandEvent::Stderr(line) => {
                    if let Some(file) = log.as_mut() {
                        let _ = file.write_all(&line);
                        let _ = file.write_all(b"\n");
                    }
                }
                CommandEvent::Terminated(_) => on_server_gone(&handle),
                _ => {}
            }
        }
    });

    Ok(())
}

/// The server's log (its stderr), started afresh when it grows too big.
fn open_log(path: &Path) -> Option<fs::File> {
    let too_big = fs::metadata(path)
        .map(|meta| meta.len() > MAX_LOG_BYTES)
        .unwrap_or(false);

    OpenOptions::new()
        .create(true)
        .append(!too_big)
        .write(true)
        .truncate(too_big)
        .open(path)
        .ok()
}

fn on_server_line(app: &AppHandle, line: &[u8]) {
    let Ok(event) = serde_json::from_slice::<ServerEvent>(line) else {
        return;
    };

    match event {
        ServerEvent::Ready { port } => {
            app.state::<Shell>().restarts.store(0, Ordering::SeqCst);
            open_app(app, port);
        }
        ServerEvent::Badge { important } => set_badge(app, important),
        ServerEvent::Notify { title, body } => {
            let _ = app.notification().builder().title(title).body(body).show();
        }
    }
}

/// The server stopped without being asked: start it again, a few times at most.
fn on_server_gone(app: &AppHandle) {
    let shell = app.state::<Shell>();

    if shell.quitting.load(Ordering::SeqCst) {
        return;
    }

    let attempt = shell.restarts.fetch_add(1, Ordering::SeqCst) + 1;

    if attempt > MAX_SERVER_RESTARTS {
        let _ = app
            .notification()
            .builder()
            .title("Huginn stopped")
            .body("Its server keeps failing. See server.log in Huginn's data folder.")
            .show();

        return;
    }

    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2 * u64::from(attempt))).await;

        if let Err(error) = start_server(&handle) {
            eprintln!("restarting the server failed: {error}");
        }
    });
}

fn stop_server(app: &AppHandle) {
    let shell = app.state::<Shell>();

    shell.quitting.store(true, Ordering::SeqCst);

    let child = shell.server.lock().expect("server lock").take();

    if let Some(child) = child {
        let _ = child.kill();
    }
}

fn open_app(app: &AppHandle, port: u16) {
    let token = app.state::<Shell>().launch_token.clone();
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Ok(url) = format!("http://127.0.0.1:{port}/__launch?token={token}").parse() {
        let _ = window.navigate(url);
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn set_badge(app: &AppHandle, important: u32) {
    let label = (important > 0).then(|| important.to_string());

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(label.as_deref());
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count((important > 0).then_some(i64::from(important)));
    }
}

fn build_tray(app: &AppHandle) -> AnyResult<()> {
    let open = MenuItem::with_id(app, "open", "Open Huginn", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check-update", "Check for Updates…", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Restart to Update", false, None::<&str>)?;
    let login_on = app.autolaunch().is_enabled().unwrap_or(false);
    let login = CheckMenuItem::with_id(app, "login", "Open at Login", true, login_on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Huginn", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &check,
            &restart,
            &login,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    // A template image: macOS draws it white on a dark menu bar and black on a light one.
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray@2x.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Huginn")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_window(app),
            "check-update" => {
                let handle = app.clone();

                tauri::async_runtime::spawn(async move {
                    report_update_check(&handle, check_for_update(&handle).await);
                });
            }
            "restart" => app.restart(),
            "login" => toggle_open_at_login(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    let shell = app.state::<Shell>();

    *shell.restart_item.lock().expect("menu lock") = Some(restart);
    *shell.login_item.lock().expect("menu lock") = Some(login);

    Ok(())
}

/// Huginn is a background app: it starts at login unless the user switches that off.
/// Done once, so turning it off in the menu sticks.
fn open_at_login_once(app: &AppHandle, data_dir: &Path) {
    let marker = data_dir.join(".open-at-login-decided");

    if cfg!(debug_assertions) || marker.exists() {
        return;
    }

    if app.autolaunch().enable().is_ok() {
        let _ = fs::write(&marker, b"");

        if let Some(item) = app.state::<Shell>().login_item.lock().expect("menu lock").as_ref() {
            let _ = item.set_checked(true);
        }
    }
}

fn toggle_open_at_login(app: &AppHandle) {
    let autolaunch = app.autolaunch();
    let enabled = autolaunch.is_enabled().unwrap_or(false);
    let result = if enabled {
        autolaunch.disable()
    } else {
        autolaunch.enable()
    };
    let now = if result.is_ok() { !enabled } else { enabled };

    if let Some(item) = app.state::<Shell>().login_item.lock().expect("menu lock").as_ref() {
        let _ = item.set_checked(now);
    }
}

fn spawn_update_checks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_UPDATE_CHECK).await;

        loop {
            if let Err(error) = check_for_update(&app).await {
                eprintln!("update check failed: {error}");
            }

            tokio::time::sleep(UPDATE_EVERY).await;
        }
    });
}

enum UpdateCheck {
    UpToDate,
    Ready,
}

/// Downloads and installs a newer version in the background; it takes effect on the
/// next start ("Restart to Update").
async fn check_for_update(app: &AppHandle) -> AnyResult<UpdateCheck> {
    let shell = app.state::<Shell>();

    if shell.update_ready.load(Ordering::SeqCst) {
        return Ok(UpdateCheck::Ready);
    }

    let Some(update) = app.updater()?.check().await? else {
        return Ok(UpdateCheck::UpToDate);
    };
    let version = update.version.clone();

    update.download_and_install(|_, _| {}, || {}).await?;
    shell.update_ready.store(true, Ordering::SeqCst);

    if let Some(item) = shell.restart_item.lock().expect("menu lock").as_ref() {
        let _ = item.set_text(format!("Restart to Update ({version})"));
        let _ = item.set_enabled(true);
    }

    let _ = app
        .notification()
        .builder()
        .title(format!("Huginn {version} is ready"))
        .body("Restart Huginn from the menu bar to finish updating.")
        .show();

    Ok(UpdateCheck::Ready)
}

/// Only for checks the user asked for; the hourly ones stay silent unless they find one.
fn report_update_check(app: &AppHandle, result: AnyResult<UpdateCheck>) {
    let body = match result {
        Ok(UpdateCheck::UpToDate) => "You have the latest version.".to_string(),
        Ok(UpdateCheck::Ready) => return,
        Err(error) => format!("Could not check for updates: {error}"),
    };

    let _ = app.notification().builder().title("Huginn").body(body).show();
}

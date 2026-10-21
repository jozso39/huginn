//! The sign-in window for services without an API sign-in (Messenger): the service's own
//! login page in a window of its own, with no address bar and no way off its sites. Once
//! the user is in, the shell takes the session's cookies from the window's private cookie
//! store and hands them to the server. Huginn never sees the password, the page never sees
//! Huginn (it gets no Tauri access), and nothing stays behind when the window closes.

use std::{collections::HashMap, sync::Mutex, thread, time::Duration};

use regex::Regex;
use serde::Deserialize;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const LABEL: &str = "login";
/// The cookie store can lag behind the page that set the cookies.
const COOKIE_TRIES: u32 = 10;
const COOKIE_WAIT: Duration = Duration::from_millis(300);

/// What the server asks for (see src/infrastructure/desktop/DesktopChannel.ts).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    id: String,
    title: String,
    url: url::Url,
    /// The same browser the server will pose as, so the session looks like one browser.
    user_agent: String,
    /// The sites the window may show (a host or its subdomains); other links open in the browser.
    hosts: Vec<String>,
    /// A page whose address matches this means the user is signed in.
    done: String,
    cookie_domain: String,
    required: Vec<String>,
    optional: Vec<String>,
}

/// The sign-in in progress, if any: one window at a time.
#[derive(Default)]
pub struct Logins {
    active: Mutex<Option<String>>,
}

pub fn open(app: &AppHandle, request: LoginRequest) {
    // A new sign-in replaces one still open.
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }

    let Ok(done) = Regex::new(&request.done) else {
        crate::tell_server(app, &answer(&request.id, None));

        return;
    };

    *app.state::<Logins>().active.lock().expect("login lock") = Some(request.id.clone());

    if let Err(error) = build(app, request.clone(), done) {
        eprintln!("the sign-in window did not open: {error}");
        finish(app, &request.id, None);
    }
}

fn build(app: &AppHandle, request: LoginRequest, done: Regex) -> tauri::Result<()> {
    let hosts = request.hosts.clone();
    let loaded = request.clone();
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(request.url.clone()))
        .title(&request.title)
        .inner_size(520.0, 760.0)
        .min_inner_size(380.0, 520.0)
        // Its own cookie store, gone with the window: nothing is shared with Huginn's
        // window, and the next sign-in starts clean.
        .incognito(true)
        .user_agent(&request.user_agent)
        .on_navigation(move |url| {
            if on_sites(url, &hosts) {
                return true;
            }

            crate::open_outside(url);
            false
        })
        .on_new_window(|url, _| {
            crate::open_outside(&url);
            NewWindowResponse::Deny
        })
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }

            let url = payload.url().clone();

            // The window has no address bar; its title says where it is.
            let _ = window.set_title(&format!(
                "{} — {}",
                loaded.title,
                url.host_str().unwrap_or_default()
            ));

            if done.is_match(url.as_str()) {
                let request = loaded.clone();

                // Reading cookies waits on the main thread, which runs this callback.
                thread::spawn(move || take_cookies(&window, &request));
            }
        })
        .build()?;

    let handle = app.clone();
    let id = request.id;

    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            finish(&handle, &id, None);
        }
    });

    Ok(())
}

fn on_sites(url: &url::Url, hosts: &[String]) -> bool {
    let Some(host) = url.host_str() else {
        return matches!(url.scheme(), "about" | "blob" | "data");
    };

    url.scheme() == "https"
        && hosts
            .iter()
            .any(|site| host == site || host.ends_with(&format!(".{site}")))
}

fn take_cookies(window: &WebviewWindow, request: &LoginRequest) {
    for _ in 0..COOKIE_TRIES {
        let found = session_cookies(window, request);

        if request.required.iter().all(|name| found.contains_key(name)) {
            finish(window.app_handle(), &request.id, Some(found));
            let _ = window.destroy();

            return;
        }

        thread::sleep(COOKIE_WAIT);
    }

    eprintln!("signed in, but the session cookies did not show up");
}

/// Only the named cookies of the service's domain: nothing else leaves the window.
fn session_cookies(window: &WebviewWindow, request: &LoginRequest) -> HashMap<String, String> {
    let Ok(cookies) = window.cookies() else {
        return HashMap::new();
    };

    cookies
        .iter()
        .filter(|cookie| {
            cookie.domain().is_some_and(|domain| {
                let domain = domain.trim_start_matches('.');

                domain == request.cookie_domain
                    || domain.ends_with(&format!(".{}", request.cookie_domain))
            })
        })
        .filter(|cookie| {
            let name = cookie.name().to_string();

            request.required.contains(&name) || request.optional.contains(&name)
        })
        .map(|cookie| (cookie.name().to_string(), cookie.value().to_string()))
        .collect()
}

/// Tells the server once how the sign-in ended: the cookies, or none when the window
/// closed first.
fn finish(app: &AppHandle, id: &str, cookies: Option<HashMap<String, String>>) {
    {
        let logins = app.state::<Logins>();
        let mut active = logins.active.lock().expect("login lock");

        if active.as_deref() != Some(id) {
            return;
        }

        *active = None;
    }

    crate::tell_server(app, &answer(id, cookies));
}

fn answer(id: &str, cookies: Option<HashMap<String, String>>) -> serde_json::Value {
    serde_json::json!({ "type": "login", "id": id, "cookies": cookies })
}

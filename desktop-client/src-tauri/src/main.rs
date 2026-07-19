#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[cfg(windows)]
use windows_sys::Win32::UI::{
    Input::KeyboardAndMouse::{
        RegisterHotKey, SendInput, UnregisterHotKey, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE,
        KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
        MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
        MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN,
        MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    },
    WindowsAndMessaging::{
        GetMessageW, GetSystemMetrics, MSG, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, WM_HOTKEY,
    },
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeInfo {
    app_version: &'static str,
    platform: &'static str,
    architecture: &'static str,
    debug: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "camelCase")]
enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum InputAction {
    Down,
    Up,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum ControlInputEvent {
    MouseMove {
        x: f64,
        y: f64,
    },
    MouseButton {
        button: MouseButton,
        action: InputAction,
        x: f64,
        y: f64,
    },
    MouseScroll {
        delta_x: f64,
        delta_y: f64,
        x: f64,
        y: f64,
    },
    Key {
        code: String,
        action: InputAction,
    },
    ReleaseAll,
}

struct NativeControlSession {
    session_id: String,
    nonce: String,
    expires_at_ms: u64,
    allow_keyboard: bool,
    last_sequence: u64,
    last_seen: Instant,
    rate_window_started: Instant,
    rate_window_count: u32,
    target: ControlTarget,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct ControlTarget {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Default)]
struct ControlRuntime {
    active: Option<NativeControlSession>,
    held_keys: HashSet<(u16, bool)>,
    held_buttons: HashSet<MouseButton>,
}

type SharedControlState = Arc<Mutex<ControlRuntime>>;

#[tauri::command]
fn desktop_runtime_info() -> DesktopRuntimeInfo {
    DesktopRuntimeInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        debug: cfg!(debug_assertions),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

#[tauri::command]
fn start_control_session(
    state: tauri::State<'_, SharedControlState>,
    session_id: String,
    nonce: String,
    expires_at_ms: u64,
    allow_keyboard: bool,
    target: ControlTarget,
) -> Result<(), String> {
    let current_time = now_ms();
    if !valid_identifier(&session_id) || nonce.len() != 43 || !valid_identifier(&nonce) {
        return Err("Invalid control session identity.".into());
    }
    if expires_at_ms <= current_time || expires_at_ms - current_time > 15 * 60_000 {
        return Err("Invalid control session expiration.".into());
    }
    validate_control_target(target)?;
    let mut runtime = state
        .lock()
        .map_err(|_| "Control runtime is unavailable.".to_string())?;
    release_all_inputs(&mut runtime)?;
    let now = Instant::now();
    runtime.active = Some(NativeControlSession {
        session_id,
        nonce,
        expires_at_ms,
        allow_keyboard,
        last_sequence: 0,
        last_seen: now,
        rate_window_started: now,
        rate_window_count: 0,
        target,
    });
    Ok(())
}

fn validate_session<'a>(
    runtime: &'a mut ControlRuntime,
    session_id: &str,
    nonce: &str,
    sequence: u64,
) -> Result<&'a mut NativeControlSession, String> {
    let session = runtime
        .active
        .as_mut()
        .ok_or_else(|| "No active control session.".to_string())?;
    if session.session_id != session_id || session.nonce != nonce {
        return Err("Control session does not match.".into());
    }
    if now_ms() >= session.expires_at_ms {
        return Err("Control session expired.".into());
    }
    if sequence <= session.last_sequence {
        return Err("Control event sequence is stale.".into());
    }
    let now = Instant::now();
    if now.duration_since(session.rate_window_started) >= Duration::from_secs(1) {
        session.rate_window_started = now;
        session.rate_window_count = 0;
    }
    session.rate_window_count += 1;
    if session.rate_window_count > 300 {
        return Err("Control event rate exceeded.".into());
    }
    session.last_sequence = sequence;
    session.last_seen = now;
    Ok(session)
}

#[tauri::command]
fn control_heartbeat(
    state: tauri::State<'_, SharedControlState>,
    session_id: String,
    nonce: String,
    sequence: u64,
) -> Result<(), String> {
    let mut runtime = state
        .lock()
        .map_err(|_| "Control runtime is unavailable.".to_string())?;
    validate_session(&mut runtime, &session_id, &nonce, sequence)?;
    Ok(())
}

#[tauri::command]
fn apply_control_event(
    state: tauri::State<'_, SharedControlState>,
    session_id: String,
    nonce: String,
    sequence: u64,
    event: ControlInputEvent,
) -> Result<(), String> {
    let mut runtime = state
        .lock()
        .map_err(|_| "Control runtime is unavailable.".to_string())?;
    let session = validate_session(&mut runtime, &session_id, &nonce, sequence)?;
    let allow_keyboard = session.allow_keyboard;
    let target = session.target;
    match event {
        ControlInputEvent::MouseMove { x, y } => move_mouse(target, x, y),
        ControlInputEvent::MouseButton {
            button,
            action,
            x,
            y,
        } => {
            move_mouse(target, x, y)?;
            mouse_button(&mut runtime, button, action)
        }
        ControlInputEvent::MouseScroll {
            delta_x,
            delta_y,
            x,
            y,
        } => {
            move_mouse(target, x, y)?;
            mouse_scroll(delta_x, delta_y)
        }
        ControlInputEvent::Key { code, action } => {
            if !allow_keyboard {
                return Err("Keyboard control is not enabled.".into());
            }
            keyboard_event(&mut runtime, &code, action)
        }
        ControlInputEvent::ReleaseAll => release_all_inputs(&mut runtime),
    }
}

#[tauri::command]
fn stop_control_session(
    state: tauri::State<'_, SharedControlState>,
    session_id: Option<String>,
) -> Result<(), String> {
    let mut runtime = state
        .lock()
        .map_err(|_| "Control runtime is unavailable.".to_string())?;
    if let (Some(expected), Some(active)) = (session_id.as_deref(), runtime.active.as_ref()) {
        if expected != active.session_id {
            return Ok(());
        }
    }
    stop_locked(&mut runtime)
}

fn stop_locked(runtime: &mut ControlRuntime) -> Result<(), String> {
    release_all_inputs(runtime)?;
    runtime.active = None;
    Ok(())
}

#[cfg(windows)]
fn send_input(input: INPUT) -> Result<(), String> {
    let sent = unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) };
    if sent == 1 {
        Ok(())
    } else {
        Err("Windows rejected an input event.".into())
    }
}

#[cfg(not(windows))]
fn send_input(_input: ()) -> Result<(), String> {
    Err("Remote input is available only on Windows.".into())
}

#[cfg(windows)]
fn mouse_input(flags: u32, dx: i32, dy: i32, data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(windows)]
fn key_input(vk: u16, key_up: bool, extended: bool) -> INPUT {
    let mut flags = if key_up { KEYEVENTF_KEYUP } else { 0 };
    if extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn normalized_axis(value: f64) -> Result<i32, String> {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err("Mouse coordinates are out of bounds.".into());
    }
    Ok((value * 65_535.0).round() as i32)
}

#[cfg(windows)]
fn virtual_desktop() -> (i32, i32, i32, i32) {
    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    }
}

#[cfg(windows)]
fn validate_control_target(target: ControlTarget) -> Result<(), String> {
    let (virtual_x, virtual_y, virtual_width, virtual_height) = virtual_desktop();
    if target.width == 0
        || target.height == 0
        || target.x < virtual_x
        || target.y < virtual_y
        || i64::from(target.x) + i64::from(target.width)
            > i64::from(virtual_x) + i64::from(virtual_width)
        || i64::from(target.y) + i64::from(target.height)
            > i64::from(virtual_y) + i64::from(virtual_height)
    {
        return Err("Selected monitor is outside the current virtual desktop.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn validate_control_target(_target: ControlTarget) -> Result<(), String> {
    Err("Remote input is available only on Windows.".into())
}

#[cfg(windows)]
fn move_mouse(target: ControlTarget, x: f64, y: f64) -> Result<(), String> {
    let normalized_x = normalized_axis(x)? as f64 / 65_535.0;
    let normalized_y = normalized_axis(y)? as f64 / 65_535.0;
    let pixel_x = target.x as f64 + normalized_x * f64::from(target.width.saturating_sub(1));
    let pixel_y = target.y as f64 + normalized_y * f64::from(target.height.saturating_sub(1));
    let (virtual_x, virtual_y, virtual_width, virtual_height) = virtual_desktop();
    let absolute_x = ((pixel_x - f64::from(virtual_x)) * 65_535.0
        / f64::from((virtual_width - 1).max(1)))
    .round() as i32;
    let absolute_y = ((pixel_y - f64::from(virtual_y)) * 65_535.0
        / f64::from((virtual_height - 1).max(1)))
    .round() as i32;
    send_input(mouse_input(
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        absolute_x,
        absolute_y,
        0,
    ))
}

#[cfg(not(windows))]
fn move_mouse(_target: ControlTarget, _x: f64, _y: f64) -> Result<(), String> {
    Err("Remote input is available only on Windows.".into())
}

#[cfg(windows)]
fn mouse_button(
    runtime: &mut ControlRuntime,
    button: MouseButton,
    action: InputAction,
) -> Result<(), String> {
    let flags = match (button, action) {
        (MouseButton::Left, InputAction::Down) => MOUSEEVENTF_LEFTDOWN,
        (MouseButton::Left, InputAction::Up) => MOUSEEVENTF_LEFTUP,
        (MouseButton::Right, InputAction::Down) => MOUSEEVENTF_RIGHTDOWN,
        (MouseButton::Right, InputAction::Up) => MOUSEEVENTF_RIGHTUP,
        (MouseButton::Middle, InputAction::Down) => MOUSEEVENTF_MIDDLEDOWN,
        (MouseButton::Middle, InputAction::Up) => MOUSEEVENTF_MIDDLEUP,
    };
    send_input(mouse_input(flags, 0, 0, 0))?;
    match action {
        InputAction::Down => {
            runtime.held_buttons.insert(button);
        }
        InputAction::Up => {
            runtime.held_buttons.remove(&button);
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn mouse_button(
    _runtime: &mut ControlRuntime,
    _button: MouseButton,
    _action: InputAction,
) -> Result<(), String> {
    Err("Remote input is available only on Windows.".into())
}

#[cfg(windows)]
fn mouse_scroll(delta_x: f64, delta_y: f64) -> Result<(), String> {
    if !delta_x.is_finite() || !delta_y.is_finite() {
        return Err("Invalid scroll amount.".into());
    }
    let vertical = (-delta_y).clamp(-2_000.0, 2_000.0).round() as i32;
    let horizontal = delta_x.clamp(-2_000.0, 2_000.0).round() as i32;
    if vertical != 0 {
        send_input(mouse_input(MOUSEEVENTF_WHEEL, 0, 0, vertical as u32))?;
    }
    if horizontal != 0 {
        send_input(mouse_input(MOUSEEVENTF_HWHEEL, 0, 0, horizontal as u32))?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn mouse_scroll(_delta_x: f64, _delta_y: f64) -> Result<(), String> {
    Err("Remote input is available only on Windows.".into())
}

fn key_code(code: &str) -> Option<(u16, bool)> {
    if let Some(letter) = code.strip_prefix("Key").filter(|value| value.len() == 1) {
        let byte = letter.as_bytes()[0];
        if byte.is_ascii_uppercase() {
            return Some((byte as u16, false));
        }
    }
    if let Some(digit) = code.strip_prefix("Digit").filter(|value| value.len() == 1) {
        let byte = digit.as_bytes()[0];
        if byte.is_ascii_digit() {
            return Some((byte as u16, false));
        }
    }
    if let Some(number) = code
        .strip_prefix('F')
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|number| (1..=12).contains(number))
    {
        return Some((0x6F + number, false));
    }
    Some(match code {
        "Enter" => (0x0D, false),
        "Escape" => (0x1B, false),
        "Tab" => (0x09, false),
        "Space" => (0x20, false),
        "Backspace" => (0x08, false),
        "Delete" => (0x2E, true),
        "Insert" => (0x2D, true),
        "Home" => (0x24, true),
        "End" => (0x23, true),
        "PageUp" => (0x21, true),
        "PageDown" => (0x22, true),
        "ArrowUp" => (0x26, true),
        "ArrowDown" => (0x28, true),
        "ArrowLeft" => (0x25, true),
        "ArrowRight" => (0x27, true),
        "ShiftLeft" => (0xA0, false),
        "ShiftRight" => (0xA1, false),
        "ControlLeft" => (0xA2, false),
        "ControlRight" => (0xA3, true),
        "AltLeft" => (0xA4, false),
        "AltRight" => (0xA5, true),
        _ => return None,
    })
}

#[cfg(windows)]
fn keyboard_event(
    runtime: &mut ControlRuntime,
    code: &str,
    action: InputAction,
) -> Result<(), String> {
    let (vk, extended) =
        key_code(code).ok_or_else(|| "Keyboard key is not supported.".to_string())?;
    send_input(key_input(vk, matches!(action, InputAction::Up), extended))?;
    match action {
        InputAction::Down => {
            runtime.held_keys.insert((vk, extended));
        }
        InputAction::Up => {
            runtime.held_keys.remove(&(vk, extended));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn keyboard_event(
    _runtime: &mut ControlRuntime,
    _code: &str,
    _action: InputAction,
) -> Result<(), String> {
    Err("Remote input is available only on Windows.".into())
}

#[cfg(windows)]
fn release_all_inputs(runtime: &mut ControlRuntime) -> Result<(), String> {
    let keys: Vec<(u16, bool)> = runtime.held_keys.drain().collect();
    for (key, extended) in keys {
        let _ = send_input(key_input(key, true, extended));
    }
    let buttons: Vec<MouseButton> = runtime.held_buttons.drain().collect();
    for button in buttons {
        let flag = match button {
            MouseButton::Left => MOUSEEVENTF_LEFTUP,
            MouseButton::Right => MOUSEEVENTF_RIGHTUP,
            MouseButton::Middle => MOUSEEVENTF_MIDDLEUP,
        };
        let _ = send_input(mouse_input(flag, 0, 0, 0));
    }
    Ok(())
}

#[cfg(not(windows))]
fn release_all_inputs(runtime: &mut ControlRuntime) -> Result<(), String> {
    runtime.held_keys.clear();
    runtime.held_buttons.clear();
    Ok(())
}

fn spawn_watchdog(state: SharedControlState) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let Ok(mut runtime) = state.lock() else {
            continue;
        };
        let should_stop = runtime.active.as_ref().is_some_and(|session| {
            now_ms() >= session.expires_at_ms
                || session.last_seen.elapsed() > Duration::from_secs(5)
        });
        if should_stop {
            let _ = stop_locked(&mut runtime);
        }
    });
}

#[cfg(windows)]
fn spawn_emergency_hotkey(app_handle: tauri::AppHandle, state: SharedControlState) {
    std::thread::spawn(move || unsafe {
        const HOTKEY_ID: i32 = 0x5754;
        if RegisterHotKey(
            std::ptr::null_mut(),
            HOTKEY_ID,
            MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
            0x7B,
        ) == 0
        {
            return;
        }
        let mut message = MSG::default();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            if message.message == WM_HOTKEY && message.wParam == HOTKEY_ID as usize {
                if let Ok(mut runtime) = state.lock() {
                    let _ = stop_locked(&mut runtime);
                };
                let _ = app_handle.emit("control-emergency-stop", ());
            }
        }
        UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
    });
}

#[cfg(not(windows))]
fn spawn_emergency_hotkey(_app_handle: tauri::AppHandle, _state: SharedControlState) {}

fn main() {
    let control_state: SharedControlState = Arc::new(Mutex::new(ControlRuntime::default()));
    let setup_state = control_state.clone();
    tauri::Builder::default()
        .manage(control_state)
        .setup(move |app| {
            spawn_watchdog(setup_state.clone());
            spawn_emergency_hotkey(app.handle().clone(), setup_state.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_info,
            start_control_session,
            apply_control_event,
            control_heartbeat,
            stop_control_session,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Watch Together desktop application")
        .run(|app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                let state = app_handle.state::<SharedControlState>();
                if let Ok(mut runtime) = state.lock() {
                    let _ = stop_locked(&mut runtime);
                };
            }
        });
}

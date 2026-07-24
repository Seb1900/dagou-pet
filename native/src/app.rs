use crate::audio::SoundController;
use crate::cursor::DragCursors;
use crate::input::{DogKeyRole, resolve_key_expression};
use crate::render::{LayeredRenderer, PetAnimator};
use crate::settings::{
    AppSettings, PET_SCALE_MAX, PET_SCALE_MIN, PET_WINDOW_BASE_SIZE, SettingsStore,
};
use crate::ui::{SettingsAction, SettingsUi, default_jiao_keys};
use crate::update::{
    RELEASES_URL, UpdateResult, check_and_download, is_installed_build, start_installer,
};
use crate::window::{
    PET_CLASS_NAME, SETTINGS_CLASS_NAME, SETTINGS_HEIGHT, SETTINGS_WIDTH, constrain_position,
    default_pet_position, load_icon, position_settings_above, wide,
};
use anyhow::{Result, bail};
use crossbeam_channel::{Receiver, TryRecvError, bounded};
use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{
    COLORREF, CloseHandle, ERROR_ALREADY_EXISTS, GetLastError, HINSTANCE, HWND, LPARAM, LRESULT,
    POINT, RECT, WPARAM,
};
use windows::Win32::Graphics::Gdi::{
    GetStockObject, HBRUSH, HDC, SetBkMode, SetTextColor, TRANSPARENT, WHITE_BRUSH,
};
use windows::Win32::System::ApplicationInstallationAndServicing::{
    ACTCTXW, ActivateActCtx, CreateActCtxW, DeactivateActCtx, ReleaseActCtx,
};
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::System::WindowsProgramming::{
    ACTCTX_FLAG_HMODULE_VALID, ACTCTX_FLAG_RESOURCE_NAME_VALID,
};
use windows::Win32::UI::Controls::{
    ICC_BAR_CLASSES, INITCOMMONCONTROLSEX, InitCommonControlsEx, WM_MOUSELEAVE,
};
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MOD_ALT, MOD_CONTROL, RegisterHotKey, ReleaseCapture, SetCapture, TME_LEAVE,
    TRACKMOUSEEVENT, TrackMouseEvent, UnregisterHotKey,
};
use windows::Win32::UI::Shell::{
    NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW, Shell_NotifyIconW,
    ShellExecuteW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CS_HREDRAW, CS_VREDRAW, CallNextHookEx, CreatePopupMenu, CreateWindowExW,
    DefWindowProcW, DestroyIcon, DestroyMenu, DestroyWindow, DispatchMessageW, FindWindowW,
    GWLP_USERDATA, GetClientRect, GetCursorPos, GetMessageW, GetWindowRect, HCURSOR, HHOOK, HICON,
    HMENU, HTCLIENT, HTTRANSPARENT, HWND_NOTOPMOST, HWND_TOPMOST, IDC_ARROW, IDC_SIZENESW,
    IDC_SIZENWSE, IDYES, IsWindowVisible, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, LoadCursorW,
    MB_ICONERROR, MB_ICONINFORMATION, MB_ICONQUESTION, MB_OK, MB_YESNO, MF_CHECKED, MF_SEPARATOR,
    MF_STRING, MSG, MessageBoxW, PBT_APMRESUMEAUTOMATIC, PBT_APMSUSPEND, PostMessageW,
    PostQuitMessage, RegisterClassExW, SW_HIDE, SW_SHOWNOACTIVATE, SW_SHOWNORMAL, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetCursor, SetForegroundWindow, SetTimer,
    SetWindowLongPtrW, SetWindowPos, SetWindowsHookExW, ShowWindow, TPM_RETURNCMD, TPM_RIGHTBUTTON,
    TrackPopupMenu, TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WINDOW_EX_STYLE, WM_APP,
    WM_CLOSE, WM_COMMAND, WM_CONTEXTMENU, WM_CREATE, WM_CTLCOLORBTN, WM_CTLCOLORSTATIC, WM_DESTROY,
    WM_DEVICECHANGE, WM_DISPLAYCHANGE, WM_DRAWITEM, WM_ERASEBKGND, WM_HOTKEY, WM_HSCROLL,
    WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_NCCREATE, WM_NCHITTEST,
    WM_NOTIFY, WM_POWERBROADCAST, WM_QUERYENDSESSION, WM_RBUTTONUP, WM_SETCURSOR, WM_SETTINGCHANGE,
    WM_SHOWWINDOW, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_TIMER, WNDCLASSEXW, WS_CAPTION, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_OVERLAPPED, WS_POPUP, WS_SYSMENU,
};
use windows::core::{PCWSTR, w};

const TIMER_ANIMATION: usize = 1;
const HOTKEY_CLICK_THROUGH: i32 = 1;
const TRAY_ID: u32 = 1;
const WM_APP_KEY: u32 = WM_APP + 1;
const WM_APP_TRAY: u32 = WM_APP + 2;
const WM_APP_SHOW_SETTINGS: u32 = WM_APP + 3;

const MENU_SETTINGS: u32 = 1001;
const MENU_PAUSE: u32 = 1002;
const MENU_RESET_POSITION: u32 = 1003;
const MENU_EXIT: u32 = 1004;

static APP_STATE: AtomicPtr<AppState> = AtomicPtr::new(null_mut());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HitRegion {
    Outside,
    Dog,
    Scale,
}

#[derive(Debug, Clone, Copy)]
enum DragGesture {
    Move {
        cursor: POINT,
        window: POINT,
        moved: bool,
    },
    Resize {
        cursor: POINT,
        window: RECT,
        size: i32,
    },
}

#[derive(Debug, Clone, Copy)]
struct PressedKey {
    role: DogKeyRole,
    virtual_key: u32,
}

struct AppState {
    instance: HINSTANCE,
    pet_window: HWND,
    settings_window: HWND,
    icon_large: HICON,
    icon_small: HICON,
    drag_cursors: DragCursors,
    keyboard_hook: Option<HHOOK>,
    mutex: windows::Win32::Foundation::HANDLE,
    tray_added: bool,
    settings_store: SettingsStore,
    renderer: LayeredRenderer,
    animator: PetAnimator,
    sound: Option<SoundController>,
    pressed_roles: HashMap<u32, PressedKey>,
    drag: Option<DragGesture>,
    tracking_mouse: bool,
    capture_key: bool,
    settings_ui: Option<SettingsUi>,
    update_receiver: Option<Receiver<UpdateResult>>,
    update_manual: bool,
    update_status: String,
    startup_update_due: Option<Instant>,
    next_audio_check: Instant,
    next_topmost_check: Instant,
    audio_restart_requested: bool,
    quitting: bool,
}

impl AppState {
    fn settings(&self) -> &AppSettings {
        self.settings_store.settings()
    }

    fn render(&mut self) {
        let mut rect = RECT::default();
        unsafe {
            if GetWindowRect(self.pet_window, &mut rect).is_err() {
                return;
            }
        }
        let frame = self.animator.tick();
        if let Err(error) = self.renderer.render(
            self.pet_window,
            &frame,
            POINT {
                x: rect.left,
                y: rect.top,
            },
        ) {
            eprintln!("Direct2D render failed: {error:#}");
        }
    }

    fn handle_key(&mut self, virtual_key: u32, scan_code: u32, extended: bool, released: bool) {
        let Some(input) = resolve_key_expression(virtual_key, scan_code, extended, self.settings())
        else {
            return;
        };
        let press_id = input.key_code;
        if self.capture_key && !released {
            let mut settings = self.settings().clone();
            if !settings.jiao_key_codes.contains(&input.key_code) {
                settings.jiao_key_codes.push(input.key_code);
            }
            self.capture_key = false;
            self.apply_settings(settings);
            self.refresh_settings_window();
            return;
        }
        if !self.settings().listening {
            return;
        }
        if released {
            let Some(pressed) = self.pressed_roles.remove(&press_id) else {
                return;
            };
            self.animator.key_up(press_id, pressed.role);
            if let Some(sound) = self.sound.as_mut() {
                sound.key_up(press_id);
            }
        } else {
            if self.pressed_roles.contains_key(&press_id) {
                return;
            }
            self.pressed_roles.insert(
                press_id,
                PressedKey {
                    role: input.role,
                    virtual_key,
                },
            );
            self.animator.key_down(press_id, input.role);
            if let Some(sound) = self.sound.as_mut() {
                sound.key_down(press_id, input);
            }
        }
    }

    fn release_stale_keys(&mut self) {
        let released: Vec<u32> = self
            .pressed_roles
            .iter()
            .filter_map(|(press_id, pressed)| {
                let down =
                    unsafe { GetAsyncKeyState(pressed.virtual_key as i32) } as u16 & 0x8000 != 0;
                (!down).then_some(*press_id)
            })
            .collect();
        for press_id in released {
            if let Some(pressed) = self.pressed_roles.remove(&press_id) {
                self.animator.key_up(press_id, pressed.role);
                if let Some(sound) = self.sound.as_mut() {
                    sound.key_up(press_id);
                }
            }
        }
    }

    fn release_all_keys(&mut self) {
        let pressed: Vec<(u32, DogKeyRole)> = self
            .pressed_roles
            .drain()
            .map(|(press_id, pressed)| (press_id, pressed.role))
            .collect();
        for (press_id, role) in pressed {
            self.animator.key_up(press_id, role);
            if let Some(sound) = self.sound.as_mut() {
                sound.key_up(press_id);
            }
        }
    }

    fn request_audio_restart(&mut self) {
        self.audio_restart_requested = true;
        self.next_audio_check = Instant::now();
    }

    fn maintain_audio(&mut self) {
        let now = Instant::now();
        if !self.audio_restart_requested && now < self.next_audio_check {
            return;
        }
        self.next_audio_check = now + Duration::from_secs(2);

        let configured_device = self
            .settings_store
            .audio()
            .output_device_id
            .as_deref()
            .map(str::to_owned);
        let default_changed = configured_device.is_none()
            && self
                .sound
                .as_ref()
                .zip(SoundController::default_output_device_name())
                .is_some_and(|(sound, current)| sound.output_device_name() != current);
        let needs_restart = self.audio_restart_requested
            || self.sound.as_ref().is_none_or(|sound| !sound.is_healthy())
            || default_changed;
        self.audio_restart_requested = false;
        if !needs_restart {
            return;
        }

        self.release_all_keys();
        self.animator.reset();
        self.sound = SoundController::start(&self.settings().clone(), configured_device.as_deref())
            .map_err(|error| eprintln!("Audio restart failed: {error:#}"))
            .ok();
    }

    fn hit_region(&self, x: i32, y: i32) -> HitRegion {
        if self.settings().click_through {
            return HitRegion::Outside;
        }
        let size = self.pet_size().max(1) as f32;
        let mut logical_x = x as f32 / size * 1024.0;
        let mut logical_y = y as f32 / size * 1024.0;
        if self.settings().flip_horizontal {
            logical_x = 1024.0 - logical_x;
        }
        if self.settings().flip_vertical {
            logical_y = 1024.0 - logical_y;
        }
        if (700.0..=860.0).contains(&logical_x)
            && ((1024.0 - 170.0)..=(1024.0 - 10.0)).contains(&logical_y)
        {
            return HitRegion::Scale;
        }
        if (130.0..=880.0).contains(&logical_x) && (10.0..=920.0).contains(&logical_y) {
            return HitRegion::Dog;
        }
        HitRegion::Outside
    }

    fn pet_size(&self) -> i32 {
        (PET_WINDOW_BASE_SIZE as f32 * self.settings().scale).round() as i32
    }

    fn resize_cursor(&self) -> PCWSTR {
        if self.settings().flip_horizontal ^ self.settings().flip_vertical {
            IDC_SIZENESW
        } else {
            IDC_SIZENWSE
        }
    }

    fn begin_drag(&mut self, point: POINT) {
        unsafe {
            let mut window = RECT::default();
            if GetWindowRect(self.pet_window, &mut window).is_err() {
                return;
            }
            match self.hit_region(point.x - window.left, point.y - window.top) {
                HitRegion::Dog => {
                    self.animator.hover_dog();
                    self.drag = Some(DragGesture::Move {
                        cursor: point,
                        window: POINT {
                            x: window.left,
                            y: window.top,
                        },
                        moved: false,
                    });
                    SetCapture(self.pet_window);
                }
                HitRegion::Scale => {
                    self.animator.set_scale_hover(true);
                    self.drag = Some(DragGesture::Resize {
                        cursor: point,
                        window,
                        size: window.right - window.left,
                    });
                    SetCapture(self.pet_window);
                }
                HitRegion::Outside => {}
            }
        }
    }

    fn update_drag(&mut self, point: POINT) {
        let Some(gesture) = self.drag else {
            return;
        };
        match gesture {
            DragGesture::Move {
                cursor,
                window,
                mut moved,
            } => {
                let delta_x = point.x - cursor.x;
                let delta_y = point.y - cursor.y;
                moved |= delta_x.abs() > 3 || delta_y.abs() > 3;
                let position = constrain_position(
                    POINT {
                        x: window.x + delta_x,
                        y: window.y + delta_y,
                    },
                    self.pet_size(),
                );
                unsafe {
                    let _ = SetWindowPos(
                        self.pet_window,
                        None,
                        position.x,
                        position.y,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                }
                self.drag = Some(DragGesture::Move {
                    cursor,
                    window,
                    moved,
                });
            }
            DragGesture::Resize {
                cursor,
                window,
                size,
            } => {
                let horizontal = if self.settings().flip_horizontal {
                    -(point.x - cursor.x)
                } else {
                    point.x - cursor.x
                };
                let vertical = if self.settings().flip_vertical {
                    -(point.y - cursor.y)
                } else {
                    point.y - cursor.y
                };
                let minimum = (PET_WINDOW_BASE_SIZE as f32 * PET_SCALE_MIN).round() as i32;
                let maximum = (PET_WINDOW_BASE_SIZE as f32 * PET_SCALE_MAX).round() as i32;
                let next_size = (size + (horizontal + vertical) / 2).clamp(minimum, maximum);
                if next_size == self.pet_size() {
                    return;
                }
                let x = if self.settings().flip_horizontal {
                    window.right - next_size
                } else {
                    window.left
                };
                let y = if self.settings().flip_vertical {
                    window.bottom - next_size
                } else {
                    window.top
                };
                if self.renderer.resize(next_size, next_size).is_err() {
                    return;
                }
                unsafe {
                    let _ = SetWindowPos(
                        self.pet_window,
                        None,
                        x,
                        y,
                        next_size,
                        next_size,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                }
                let mut settings = self.settings().clone();
                settings.scale = next_size as f32 / PET_WINDOW_BASE_SIZE as f32;
                self.animator.apply_settings(&settings);
                self.settings_store.preview(settings);
                self.render();
            }
        }
    }

    fn end_drag(&mut self) {
        unsafe {
            let _ = ReleaseCapture();
        }
        let Some(gesture) = self.drag.take() else {
            return;
        };
        let mut rect = RECT::default();
        unsafe {
            if GetWindowRect(self.pet_window, &mut rect).is_ok() {
                let mut settings = self.settings().clone();
                settings.x = Some(rect.left);
                settings.y = Some(rect.top);
                settings.scale = (rect.right - rect.left) as f32 / PET_WINDOW_BASE_SIZE as f32;
                let _ = self.settings_store.replace(settings);
            }
        }
        if matches!(gesture, DragGesture::Move { moved: false, .. }) {
            self.animator.pet();
            if let Some(sound) = self.sound.as_ref() {
                sound.play_pet_sound();
            }
        }
    }

    fn apply_settings(&mut self, settings: AppSettings) {
        if self.settings_store.replace(settings).is_err() {
            return;
        }
        let settings = self.settings().clone();
        self.animator.apply_settings(&settings);
        if let Some(sound) = self.sound.as_mut() {
            sound.configure(&settings);
        }
        if !settings.listening {
            self.pressed_roles.clear();
            self.animator.reset();
            if let Some(sound) = self.sound.as_mut() {
                sound.reset();
            }
        }
        self.apply_click_through();
        self.reassert_topmost();
        self.resize_to_settings();
    }

    fn apply_click_through(&self) {
        unsafe {
            let current = windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
                self.pet_window,
                windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
            ) as u32;
            let transparent = windows::Win32::UI::WindowsAndMessaging::WS_EX_TRANSPARENT.0;
            let next = if self.settings().click_through {
                current | transparent
            } else {
                current & !transparent
            };
            SetWindowLongPtrW(
                self.pet_window,
                windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
                next as isize,
            );
        }
    }

    fn resize_to_settings(&mut self) {
        let size = self.pet_size();
        let mut rect = RECT::default();
        unsafe {
            if GetWindowRect(self.pet_window, &mut rect).is_err() {
                return;
            }
            let _ = SetWindowPos(
                self.pet_window,
                None,
                rect.right - size,
                rect.bottom - size,
                size,
                size,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
        let _ = self.renderer.resize(size, size);
    }

    fn reassert_topmost(&self) {
        unsafe {
            let current = windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
                self.pet_window,
                windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
            ) as u32;
            let topmost = WS_EX_TOPMOST.0;
            let enabled = self.settings().always_on_top;
            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
            if enabled && current & topmost == 0 {
                let _ = SetWindowPos(self.pet_window, Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags);
            }
            let after = if enabled {
                HWND_TOPMOST
            } else {
                HWND_NOTOPMOST
            };
            let _ = SetWindowPos(self.pet_window, Some(after), 0, 0, 0, 0, flags);
            if !self.settings_window.0.is_null() && IsWindowVisible(self.settings_window).as_bool()
            {
                let _ = SetWindowPos(self.settings_window, Some(HWND_TOPMOST), 0, 0, 0, 0, flags);
            }
        }
    }

    fn maintain_topmost(&mut self) {
        let now = Instant::now();
        if now < self.next_topmost_check {
            return;
        }
        self.next_topmost_check = now + Duration::from_secs(1);
        if self.settings().always_on_top {
            self.reassert_topmost();
        }
    }

    fn reset_position(&mut self) {
        let position = default_pet_position(self.pet_size());
        unsafe {
            let _ = SetWindowPos(
                self.pet_window,
                None,
                position.x,
                position.y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
        let mut settings = self.settings().clone();
        settings.x = Some(position.x);
        settings.y = Some(position.y);
        let _ = self.settings_store.replace(settings);
    }

    fn show_settings(&mut self) {
        if self.settings_window.0.is_null()
            && let Err(error) = self.create_settings_window()
        {
            eprintln!("Settings window creation failed: {error:#}");
        }
        if self.settings_window.0.is_null() {
            return;
        }
        let mut pet = RECT::default();
        unsafe {
            if GetWindowRect(self.pet_window, &mut pet).is_ok() {
                let position = position_settings_above(pet);
                let _ = SetWindowPos(
                    self.settings_window,
                    Some(HWND_TOPMOST),
                    position.x,
                    position.y,
                    SETTINGS_WIDTH,
                    SETTINGS_HEIGHT,
                    SWP_NOACTIVATE,
                );
            }
            let _ = ShowWindow(self.settings_window, SW_SHOWNORMAL);
            let _ = SetForegroundWindow(self.settings_window);
        }
        self.refresh_settings_window();
    }

    fn create_settings_window(&mut self) -> Result<()> {
        let title = wide("大狗桌宠");
        unsafe {
            self.settings_window = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                PCWSTR(wide(SETTINGS_CLASS_NAME).as_ptr()),
                PCWSTR(title.as_ptr()),
                WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
                0,
                0,
                SETTINGS_WIDTH,
                SETTINGS_HEIGHT,
                None,
                None,
                Some(self.instance),
                None,
            )?;
        }
        Ok(())
    }

    fn refresh_settings_window(&mut self) {
        let settings = self.settings().clone();
        if let Some(ui) = self.settings_ui.as_mut() {
            ui.refresh(&settings, self.capture_key);
            ui.set_update_status(&self.update_status);
        }
    }

    fn begin_update_check(&mut self, manual: bool) {
        self.startup_update_due = None;
        if self.update_receiver.is_some() {
            if manual {
                self.update_status = "正在检查更新".into();
                self.refresh_settings_window();
            }
            return;
        }
        if !is_installed_build() {
            self.update_status = "免安装版手动更新".into();
            self.refresh_settings_window();
            if manual {
                self.open_url(RELEASES_URL);
            }
            return;
        }

        self.update_manual = manual;
        self.update_status = "正在检查更新".into();
        self.refresh_settings_window();
        let (sender, receiver) = bounded(1);
        std::thread::spawn(move || {
            let _ = sender.send(check_and_download());
        });
        self.update_receiver = Some(receiver);
    }

    fn poll_update(&mut self) {
        if self
            .startup_update_due
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.begin_update_check(false);
        }
        let result = match self.update_receiver.as_ref().map(Receiver::try_recv) {
            Some(Ok(result)) => Some(result),
            Some(Err(TryRecvError::Disconnected)) => {
                Some(UpdateResult::Error("更新线程意外结束，请稍后重试".into()))
            }
            _ => None,
        };
        let Some(result) = result else {
            return;
        };
        self.update_receiver = None;
        match result {
            UpdateResult::UpToDate => {
                self.update_status = "当前已是新版".into();
                self.refresh_settings_window();
                if self.update_manual {
                    self.show_message("当前已是新版。", "软件更新", MB_OK | MB_ICONINFORMATION);
                }
            }
            UpdateResult::Ready {
                version,
                installer_path,
            } => {
                self.update_status = format!("版本 {version} 已下载");
                self.refresh_settings_window();
                let text = format!("版本 {version} 已下载并通过校验。\n\n现在退出并安装更新吗？");
                if self.show_message(&text, "软件更新", MB_YESNO | MB_ICONQUESTION) == IDYES {
                    match start_installer(&installer_path) {
                        Ok(()) => unsafe {
                            self.quitting = true;
                            let _ = DestroyWindow(self.pet_window);
                        },
                        Err(error) => {
                            self.update_status = "安装包启动失败".into();
                            self.refresh_settings_window();
                            self.show_message(
                                &format!("无法启动更新安装包：\n{error:#}"),
                                "更新失败",
                                MB_OK | MB_ICONERROR,
                            );
                        }
                    }
                }
            }
            UpdateResult::Error(error) => {
                self.update_status = "检查更新失败".into();
                self.refresh_settings_window();
                if self.update_manual {
                    self.show_message(
                        &format!("检查更新失败：\n{error}"),
                        "软件更新",
                        MB_OK | MB_ICONERROR,
                    );
                }
            }
        }
    }

    fn show_message(
        &self,
        text: &str,
        title: &str,
        flags: windows::Win32::UI::WindowsAndMessaging::MESSAGEBOX_STYLE,
    ) -> windows::Win32::UI::WindowsAndMessaging::MESSAGEBOX_RESULT {
        let text = wide(text);
        let title = wide(title);
        unsafe {
            MessageBoxW(
                Some(self.settings_window),
                PCWSTR(text.as_ptr()),
                PCWSTR(title.as_ptr()),
                flags,
            )
        }
    }

    fn handle_settings_action(&mut self, action: SettingsAction) {
        match action {
            SettingsAction::None => {}
            SettingsAction::Apply(settings) => {
                self.apply_settings(settings);
                self.refresh_settings_window();
            }
            SettingsAction::CaptureKey => {
                self.capture_key = true;
                self.refresh_settings_window();
            }
            SettingsAction::ResetKeys => {
                let mut settings = self.settings().clone();
                settings.jiao_key_codes = default_jiao_keys();
                self.capture_key = false;
                self.apply_settings(settings);
                self.refresh_settings_window();
            }
            SettingsAction::Feedback => {
                self.open_url("https://my.feishu.cn/share/base/form/shrcnGOLHXa8CDRLcwwbDGRI9cf")
            }
            SettingsAction::Project => self.open_url("https://github.com/Seb1900/dagou-pet"),
            SettingsAction::Privacy => self.show_privacy(),
            SettingsAction::CheckUpdate => self.begin_update_check(true),
        }
    }

    fn open_url(&self, url: &str) {
        let url = wide(url);
        unsafe {
            let _ = ShellExecuteW(
                Some(self.settings_window),
                w!("open"),
                PCWSTR(url.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            );
        }
    }

    fn show_privacy(&self) {
        unsafe {
            let _ = MessageBoxW(
                Some(self.settings_window),
                w!(
                    "大狗桌宠会监听全局键盘按下和抬起事件，用于即时播放狗叫。\n\n按键信息只在本机内存中处理，不记录输入内容，不上传按键数据。\n\n检查更新时仅会访问官方 GitHub Release。"
                ),
                w!("隐私说明"),
                MB_OK | MB_ICONINFORMATION,
            );
        }
    }

    fn show_tray_menu(&mut self) {
        unsafe {
            let Ok(menu) = CreatePopupMenu() else {
                return;
            };
            append_menu(menu, MF_STRING, MENU_SETTINGS, "打开大狗桌宠");
            append_menu(menu, MF_SEPARATOR, 0, "");
            let pause_flags = if self.settings().listening {
                MF_STRING
            } else {
                MF_STRING | MF_CHECKED
            };
            append_menu(menu, pause_flags, MENU_PAUSE, "暂停狗叫");
            append_menu(menu, MF_STRING, MENU_RESET_POSITION, "回到右下角");
            append_menu(menu, MF_SEPARATOR, 0, "");
            append_menu(menu, MF_STRING, MENU_EXIT, "退出");
            let mut cursor = POINT::default();
            if GetCursorPos(&mut cursor).is_ok() {
                let _ = SetForegroundWindow(self.pet_window);
                let command = TrackPopupMenu(
                    menu,
                    TPM_RETURNCMD | TPM_RIGHTBUTTON,
                    cursor.x,
                    cursor.y,
                    None,
                    self.pet_window,
                    None,
                )
                .0 as u32;
                match command {
                    MENU_SETTINGS => self.show_settings(),
                    MENU_PAUSE => {
                        let mut settings = self.settings().clone();
                        settings.listening = !settings.listening;
                        self.apply_settings(settings);
                    }
                    MENU_RESET_POSITION => self.reset_position(),
                    MENU_EXIT => {
                        self.quitting = true;
                        let _ =
                            windows::Win32::UI::WindowsAndMessaging::DestroyWindow(self.pet_window);
                    }
                    _ => {}
                }
            }
            let _ = DestroyMenu(menu);
        }
    }

    fn add_tray(&mut self) {
        let data = tray_data(self.pet_window, self.icon_small);
        self.tray_added = unsafe { Shell_NotifyIconW(NIM_ADD, &data).as_bool() };
    }

    fn remove_tray(&mut self) {
        if !self.tray_added {
            return;
        }
        let data = tray_data(self.pet_window, self.icon_small);
        unsafe {
            let _ = Shell_NotifyIconW(NIM_DELETE, &data);
        }
        self.tray_added = false;
    }
}

pub fn run() -> Result<()> {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;

        let mutex = CreateMutexW(None, true, w!("Local\\Seb1900.DagouPet.Native"))?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            if let Ok(existing) = FindWindowW(PCWSTR(wide(PET_CLASS_NAME).as_ptr()), PCWSTR::null())
            {
                let _ = PostMessageW(Some(existing), WM_APP_SHOW_SETTINGS, WPARAM(0), LPARAM(0));
            }
            let _ = CloseHandle(mutex);
            CoUninitialize();
            return Ok(());
        }

        let module = GetModuleHandleW(None)?;
        let activation_context = CreateActCtxW(&ACTCTXW {
            cbSize: size_of::<ACTCTXW>() as u32,
            dwFlags: ACTCTX_FLAG_HMODULE_VALID | ACTCTX_FLAG_RESOURCE_NAME_VALID,
            lpResourceName: PCWSTR(std::ptr::without_provenance(2)),
            hModule: module,
            ..Default::default()
        })?;
        let mut activation_cookie = 0;
        ActivateActCtx(Some(activation_context), &mut activation_cookie)?;
        let instance = HINSTANCE(module.0);
        let controls = INITCOMMONCONTROLSEX {
            dwSize: size_of::<INITCOMMONCONTROLSEX>() as u32,
            dwICC: ICC_BAR_CLASSES,
        };
        if !InitCommonControlsEx(&controls).as_bool() {
            bail!("failed to initialize native controls");
        }
        let icon_large = load_icon(256)?;
        let icon_small = load_icon(32)?;
        let drag_cursors = DragCursors::load(instance)?;
        register_window_classes(instance, icon_large, icon_small)?;

        let settings_store = SettingsStore::load_default_location()?;
        let settings = settings_store.settings().clone();
        let size = (PET_WINDOW_BASE_SIZE as f32 * settings.scale).round() as i32;
        let requested = match (settings.x, settings.y) {
            (Some(x), Some(y)) => POINT { x, y },
            _ => default_pet_position(size),
        };
        let position = constrain_position(requested, size);
        let renderer = LayeredRenderer::new(size, size)?;
        let animator = PetAnimator::new(&settings);
        let (sound, audio_start_error) = match SoundController::start(
            &settings,
            settings_store.audio().output_device_id.as_deref(),
        ) {
            Ok(sound) => (Some(sound), None),
            Err(error) => (None, Some(format!("{error:#}"))),
        };

        let state = Box::new(AppState {
            instance,
            pet_window: HWND::default(),
            settings_window: HWND::default(),
            icon_large,
            icon_small,
            drag_cursors,
            keyboard_hook: None,
            mutex,
            tray_added: false,
            settings_store,
            renderer,
            animator,
            sound,
            pressed_roles: HashMap::new(),
            drag: None,
            tracking_mouse: false,
            capture_key: false,
            settings_ui: None,
            update_receiver: None,
            update_manual: false,
            update_status: if is_installed_build() {
                "等待自动检查".into()
            } else {
                "免安装版手动更新".into()
            },
            startup_update_due: is_installed_build()
                .then(|| Instant::now() + Duration::from_secs(8)),
            next_audio_check: Instant::now() + Duration::from_secs(2),
            next_topmost_check: Instant::now() + Duration::from_secs(1),
            audio_restart_requested: false,
            quitting: false,
        });
        let state_pointer = Box::into_raw(state);
        APP_STATE.store(state_pointer, Ordering::SeqCst);

        let title = wide("大狗桌宠");
        let pet_ex_style = if settings.always_on_top {
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST
        } else {
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
        };
        let pet_window = CreateWindowExW(
            pet_ex_style,
            PCWSTR(wide(PET_CLASS_NAME).as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_POPUP,
            position.x,
            position.y,
            size,
            size,
            None,
            None,
            Some(instance),
            Some(state_pointer.cast()),
        )?;
        (*state_pointer).pet_window = pet_window;
        (*state_pointer).apply_click_through();
        (*state_pointer).reassert_topmost();
        (*state_pointer).add_tray();
        let _ = RegisterHotKey(
            Some(pet_window),
            HOTKEY_CLICK_THROUGH,
            MOD_CONTROL | MOD_ALT,
            b'D' as u32,
        );
        (*state_pointer).keyboard_hook = Some(SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard_hook),
            Some(instance),
            0,
        )?);
        SetTimer(Some(pet_window), TIMER_ANIMATION, 16, None);
        let _ = ShowWindow(pet_window, SW_SHOWNOACTIVATE);
        (*state_pointer).reassert_topmost();
        (*state_pointer).render();
        if let Some(error) = audio_start_error {
            let text = wide(&format!("声音设备启动失败，程序会自动重试。\n\n{error}"));
            let _ = MessageBoxW(
                Some(pet_window),
                PCWSTR(text.as_ptr()),
                w!("声音启动失败"),
                MB_OK | MB_ICONERROR,
            );
        }

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        let mut state = Box::from_raw(state_pointer);
        APP_STATE.store(null_mut(), Ordering::SeqCst);
        state.remove_tray();
        if let Some(hook) = state.keyboard_hook.take() {
            let _ = UnhookWindowsHookEx(hook);
        }
        let _ = UnregisterHotKey(Some(state.pet_window), HOTKEY_CLICK_THROUGH);
        let _ = DestroyIcon(state.icon_large);
        let _ = DestroyIcon(state.icon_small);
        let _ = CloseHandle(state.mutex);
        drop(state);
        let _ = DeactivateActCtx(0, activation_cookie);
        ReleaseActCtx(activation_context);
        CoUninitialize();
    }
    Ok(())
}

unsafe fn register_window_classes(
    instance: HINSTANCE,
    icon_large: HICON,
    icon_small: HICON,
) -> Result<()> {
    let pet_class = wide(PET_CLASS_NAME);
    let settings_class = wide(SETTINGS_CLASS_NAME);
    let cursor = unsafe { LoadCursorW(None, IDC_ARROW)? };
    let pet = WNDCLASSEXW {
        cbSize: size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(pet_window_proc),
        hInstance: instance,
        hIcon: icon_large,
        hCursor: cursor,
        hIconSm: icon_small,
        lpszClassName: PCWSTR(pet_class.as_ptr()),
        ..Default::default()
    };
    if unsafe { RegisterClassExW(&pet) } == 0 {
        bail!("failed to register pet window class");
    }
    let background = unsafe { GetStockObject(WHITE_BRUSH) };
    let settings = WNDCLASSEXW {
        cbSize: size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(settings_window_proc),
        hInstance: instance,
        hIcon: icon_large,
        hCursor: cursor,
        hbrBackground: HBRUSH(background.0),
        hIconSm: icon_small,
        lpszClassName: PCWSTR(settings_class.as_ptr()),
        ..Default::default()
    };
    if unsafe { RegisterClassExW(&settings) } == 0 {
        bail!("failed to register settings window class");
    }
    Ok(())
}

unsafe extern "system" fn pet_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let create = lparam.0 as *const windows::Win32::UI::WindowsAndMessaging::CREATESTRUCTW;
        if !create.is_null() {
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, (*create).lpCreateParams as isize);
            }
        }
    }
    let Some(state) = app_state_mut() else {
        return unsafe { DefWindowProcW(hwnd, message, wparam, lparam) };
    };
    match message {
        WM_SETCURSOR => {
            let cursor: Option<HCURSOR> = match state.drag {
                Some(DragGesture::Move { .. }) => Some(state.drag_cursors.grabbing()),
                Some(DragGesture::Resize { .. }) => unsafe {
                    LoadCursorW(None, state.resize_cursor()).ok()
                },
                None => {
                    let mut point = POINT::default();
                    let mut rect = RECT::default();
                    if unsafe { GetCursorPos(&mut point).is_ok() }
                        && unsafe { GetWindowRect(hwnd, &mut rect).is_ok() }
                    {
                        match state.hit_region(point.x - rect.left, point.y - rect.top) {
                            HitRegion::Dog => Some(state.drag_cursors.grab()),
                            HitRegion::Scale => unsafe {
                                LoadCursorW(None, state.resize_cursor()).ok()
                            },
                            HitRegion::Outside => None,
                        }
                    } else {
                        None
                    }
                }
            };
            if let Some(cursor) = cursor {
                unsafe { SetCursor(Some(cursor)) };
                return LRESULT(1);
            }
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }
        WM_NCHITTEST => {
            let (x, y) = point_from_lparam(lparam);
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect).is_ok() }
                && state.hit_region(x - rect.left, y - rect.top) != HitRegion::Outside
            {
                LRESULT(HTCLIENT as isize)
            } else {
                LRESULT(HTTRANSPARENT as isize)
            }
        }
        WM_MOUSEMOVE => {
            let mut cursor = POINT::default();
            if unsafe { GetCursorPos(&mut cursor).is_ok() } {
                if state.drag.is_some() {
                    state.update_drag(cursor);
                } else {
                    let mut rect = RECT::default();
                    if unsafe { GetWindowRect(hwnd, &mut rect).is_ok() } {
                        match state.hit_region(cursor.x - rect.left, cursor.y - rect.top) {
                            HitRegion::Scale => state.animator.set_scale_hover(true),
                            HitRegion::Dog => {
                                state.animator.set_scale_hover(false);
                                state.animator.hover_dog();
                            }
                            HitRegion::Outside => state.animator.set_scale_hover(false),
                        }
                    }
                }
            }
            if !state.tracking_mouse {
                let mut tracking = TRACKMOUSEEVENT {
                    cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                state.tracking_mouse = unsafe { TrackMouseEvent(&mut tracking).is_ok() };
            }
            LRESULT(0)
        }
        WM_MOUSELEAVE => {
            state.tracking_mouse = false;
            if state.drag.is_none() {
                state.animator.set_scale_hover(false);
            }
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            let mut cursor = POINT::default();
            if unsafe { GetCursorPos(&mut cursor).is_ok() } {
                state.begin_drag(cursor);
            }
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            state.end_drag();
            LRESULT(0)
        }
        WM_RBUTTONUP | WM_APP_SHOW_SETTINGS => {
            state.show_settings();
            LRESULT(0)
        }
        WM_TIMER if wparam.0 == TIMER_ANIMATION => {
            state.release_stale_keys();
            state.maintain_audio();
            state.maintain_topmost();
            state.poll_update();
            state.render();
            LRESULT(0)
        }
        WM_APP_KEY => {
            let virtual_key = wparam.0 as u32;
            let packed = lparam.0 as u32;
            state.handle_key(
                virtual_key,
                packed & 0xffff,
                packed & (1 << 16) != 0,
                packed & (1 << 17) != 0,
            );
            LRESULT(0)
        }
        WM_APP_TRAY => {
            let event = lparam.0 as u32;
            if event == WM_RBUTTONUP || event == WM_CONTEXTMENU {
                state.show_tray_menu();
            } else if event == WM_LBUTTONUP {
                state.show_settings();
            }
            LRESULT(0)
        }
        WM_HOTKEY if wparam.0 as i32 == HOTKEY_CLICK_THROUGH => {
            let mut settings = state.settings().clone();
            settings.click_through = !settings.click_through;
            state.apply_settings(settings);
            LRESULT(0)
        }
        WM_DISPLAYCHANGE | WM_SETTINGCHANGE | WM_SHOWWINDOW => {
            state.reassert_topmost();
            LRESULT(0)
        }
        WM_DEVICECHANGE => {
            state.request_audio_restart();
            LRESULT(1)
        }
        WM_POWERBROADCAST => {
            let event = wparam.0 as u32;
            if event == PBT_APMSUSPEND || event == PBT_APMRESUMEAUTOMATIC {
                state.release_all_keys();
            }
            if event == PBT_APMRESUMEAUTOMATIC {
                state.reassert_topmost();
                state.request_audio_restart();
            }
            LRESULT(1)
        }
        WM_QUERYENDSESSION => LRESULT(1),
        WM_CLOSE => {
            if state.quitting {
                unsafe {
                    let _ = windows::Win32::UI::WindowsAndMessaging::DestroyWindow(hwnd);
                }
            } else {
                unsafe {
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            unsafe {
                PostQuitMessage(0);
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

unsafe extern "system" fn settings_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_ERASEBKGND => {
            if let Some(state) = app_state_mut()
                && let Some(ui) = state.settings_ui.as_ref()
            {
                let mut client = RECT::default();
                if unsafe { GetClientRect(hwnd, &mut client).is_ok() } {
                    ui.paint_background(HDC(wparam.0 as *mut c_void), client);
                    return LRESULT(1);
                }
            }
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }
        WM_CTLCOLORSTATIC | WM_CTLCOLORBTN => unsafe {
            let device_context = HDC(wparam.0 as *mut c_void);
            SetBkMode(device_context, TRANSPARENT);
            SetTextColor(device_context, COLORREF(0x0020_2020));
            LRESULT(GetStockObject(WHITE_BRUSH).0 as isize)
        },
        WM_DRAWITEM => {
            if let Some(state) = app_state_mut()
                && state
                    .settings_ui
                    .as_ref()
                    .is_some_and(|ui| ui.draw_item(lparam))
            {
                return LRESULT(1);
            }
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }
        WM_NOTIFY => {
            if let Some(state) = app_state_mut()
                && let Some(result) = state.settings_ui.as_ref().and_then(|ui| ui.notify(lparam))
            {
                return result;
            }
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }
        WM_CREATE => {
            if let Some(state) = app_state_mut() {
                state.settings_window = hwnd;
                match SettingsUi::create(hwnd, state.instance, state.icon_small) {
                    Ok(mut ui) => {
                        ui.refresh(state.settings(), state.capture_key);
                        state.settings_ui = Some(ui);
                        return LRESULT(0);
                    }
                    Err(_) => return LRESULT(-1),
                }
            }
            LRESULT(-1)
        }
        WM_COMMAND => {
            if let Some(state) = app_state_mut() {
                let id = (wparam.0 & 0xffff) as i32;
                let settings = state.settings().clone();
                if let Some(ui) = state.settings_ui.as_mut() {
                    let action = ui.command(id, &settings);
                    state.handle_settings_action(action);
                }
            }
            LRESULT(0)
        }
        WM_HSCROLL => {
            if let Some(state) = app_state_mut() {
                let control = HWND(lparam.0 as *mut c_void);
                let settings = state.settings().clone();
                if let Some(ui) = state.settings_ui.as_ref() {
                    let action = ui.scroll(control, &settings);
                    state.handle_settings_action(action);
                }
            }
            LRESULT(0)
        }
        WM_CLOSE => {
            if let Some(state) = app_state_mut() {
                state.capture_key = false;
                state.refresh_settings_window();
            }
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            if let Some(state) = app_state_mut() {
                state.settings_window = HWND::default();
                state.settings_ui = None;
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let message = wparam.0 as u32;
        if matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN | WM_KEYUP | WM_SYSKEYUP) {
            let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let released = matches!(message, WM_KEYUP | WM_SYSKEYUP);
            let extended = event.flags.0 & LLKHF_EXTENDED.0 != 0;
            let packed = (event.scanCode & 0xffff)
                | if extended { 1 << 16 } else { 0 }
                | if released { 1 << 17 } else { 0 };
            let pointer = APP_STATE.load(Ordering::Relaxed);
            if !pointer.is_null() {
                let hwnd = unsafe { (*pointer).pet_window };
                if !hwnd.0.is_null() {
                    let _ = unsafe {
                        PostMessageW(
                            Some(hwnd),
                            WM_APP_KEY,
                            WPARAM(event.vkCode as usize),
                            LPARAM(packed as isize),
                        )
                    };
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn app_state_mut() -> Option<&'static mut AppState> {
    let pointer = APP_STATE.load(Ordering::SeqCst);
    if pointer.is_null() {
        None
    } else {
        Some(unsafe { &mut *pointer })
    }
}

fn point_from_lparam(lparam: LPARAM) -> (i32, i32) {
    let value = lparam.0 as u32;
    (
        (value & 0xffff) as u16 as i16 as i32,
        ((value >> 16) & 0xffff) as u16 as i16 as i32,
    )
}

fn tray_data(hwnd: HWND, icon: HICON) -> NOTIFYICONDATAW {
    let mut data = NOTIFYICONDATAW {
        cbSize: size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: TRAY_ID,
        uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP,
        uCallbackMessage: WM_APP_TRAY,
        hIcon: icon,
        ..Default::default()
    };
    let tooltip: Vec<u16> = "大狗桌宠".encode_utf16().collect();
    for (destination, source) in data.szTip.iter_mut().zip(tooltip) {
        *destination = source;
    }
    data
}

unsafe fn append_menu(
    menu: HMENU,
    flags: windows::Win32::UI::WindowsAndMessaging::MENU_ITEM_FLAGS,
    id: u32,
    text: &str,
) {
    if flags.0 & MF_SEPARATOR.0 != 0 {
        let _ = unsafe { AppendMenuW(menu, flags, id as usize, PCWSTR::null()) };
        return;
    }
    let text = wide(text);
    let _ = unsafe { AppendMenuW(menu, flags, id as usize, PCWSTR(text.as_ptr())) };
}

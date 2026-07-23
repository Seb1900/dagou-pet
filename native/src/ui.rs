use crate::settings::{
    AppSettings, DEFAULT_JIAO_KEY_CODES, GROOVE_BPM_MAX, GROOVE_BPM_MIN, PET_SCALE_MAX,
    PET_SCALE_MIN, PlaybackMode, SoundMode, VOLUME_MAX,
};
use crate::window::wide;
use anyhow::Result;
use std::ffi::c_void;
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CLEARTYPE_QUALITY, CLIP_DEFAULT_PRECIS, CreateFontW, CreatePen, CreateSolidBrush,
    DEFAULT_CHARSET, DT_CENTER, DT_LEFT, DT_SINGLELINE, DT_VCENTER, DeleteObject, DrawTextW,
    Ellipse, FF_DONTCARE, FW_NORMAL, FW_SEMIBOLD, FillRect, GetStockObject, HDC, HFONT, HGDIOBJ,
    InvalidateRect, NULL_BRUSH, NULL_PEN, OUT_DEFAULT_PRECIS, PS_SOLID, RoundRect, SelectObject,
    SetBkMode, SetTextColor, TRANSPARENT,
};
use windows::Win32::UI::Controls::{
    DRAWITEMSTRUCT, NMCUSTOMDRAW, NMHDR, ODS_DISABLED, ODS_HOTLIGHT, ODS_SELECTED, SetWindowTheme,
    TBM_SETPOS, TBM_SETRANGE, TBS_NOTICKS, TRACKBAR_CLASSW,
};
use windows::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    BS_OWNERDRAW, CreateWindowExW, DestroyWindow, GetDlgCtrlID, HICON, HMENU, IMAGE_ICON,
    STM_SETIMAGE, SW_HIDE, SW_SHOW, SendMessageW, SetWindowTextW, ShowWindow, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_SETFONT, WS_CHILD, WS_GROUP, WS_TABSTOP, WS_VISIBLE,
};
use windows::core::{PCWSTR, w};

pub const ID_TAB_SOUND: i32 = 100;
pub const ID_TAB_PET: i32 = 101;
pub const ID_TAB_ABOUT: i32 = 102;
pub const ID_CAPTURE_KEY: i32 = 207;
pub const ID_RESET_KEYS: i32 = 208;
pub const ID_CHECK_UPDATE: i32 = 403;
pub const ID_FEEDBACK: i32 = 404;
pub const ID_PROJECT: i32 = 405;
pub const ID_PRIVACY: i32 = 406;

const ID_VOLUME: i32 = 200;
const ID_SOUND_MODE: i32 = 202;
const ID_SOUND_MODE_DAGOU: i32 = 209;
const ID_MELODY: i32 = 203;
const ID_BPM: i32 = 204;

const ID_SCALE: i32 = 300;
const ID_REACTION: i32 = 302;
const ID_FLIP_HORIZONTAL: i32 = 304;
const ID_FLIP_VERTICAL: i32 = 305;
const ID_ALWAYS_ON_TOP: i32 = 306;
const ID_CLICK_THROUGH: i32 = 307;
const ID_KEY_BASE: i32 = 500;

const TBM_GETPOS: u32 = 1024;
const TBM_GETRANGEMIN: u32 = 1025;
const TBM_GETRANGEMAX: u32 = 1026;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsTab {
    Sound,
    Pet,
    About,
}

#[derive(Debug)]
pub enum SettingsAction {
    None,
    Apply(AppSettings),
    CaptureKey,
    ResetKeys,
    CheckUpdate,
    Feedback,
    Project,
    Privacy,
}

pub struct SettingsUi {
    parent: HWND,
    instance: HINSTANCE,
    font: HFONT,
    emphasis_font: HFONT,
    sound_controls: Vec<HWND>,
    pet_controls: Vec<HWND>,
    about_controls: Vec<HWND>,
    tabs: [HWND; 3],
    volume: HWND,
    volume_value: HWND,
    sound_mode_buttons: [HWND; 2],
    melody: HWND,
    bpm: HWND,
    bpm_value: HWND,
    key_buttons: Vec<(HWND, u32)>,
    key_codes: Vec<u32>,
    capture_key: HWND,
    scale: HWND,
    scale_value: HWND,
    reaction: HWND,
    reaction_value: HWND,
    flip_horizontal: HWND,
    flip_vertical: HWND,
    always_on_top: HWND,
    click_through: HWND,
    update_status: HWND,
    selected_tab: SettingsTab,
    sound_mode: SoundMode,
    melody_enabled: bool,
    flip_horizontal_enabled: bool,
    flip_vertical_enabled: bool,
    always_on_top_enabled: bool,
    click_through_enabled: bool,
    capturing: bool,
}

impl SettingsUi {
    pub fn create(parent: HWND, instance: HINSTANCE, icon: HICON) -> Result<Self> {
        unsafe {
            let font = CreateFontW(
                -14,
                0,
                0,
                0,
                FW_NORMAL.0 as i32,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                CLEARTYPE_QUALITY,
                FF_DONTCARE.0 as u32,
                w!("Segoe UI"),
            );
            let emphasis_font = CreateFontW(
                -14,
                0,
                0,
                0,
                FW_SEMIBOLD.0 as i32,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_DEFAULT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                CLEARTYPE_QUALITY,
                FF_DONTCARE.0 as u32,
                w!("Segoe UI"),
            );

            let tab_style = WINDOW_STYLE(BS_OWNERDRAW as u32) | WS_TABSTOP;
            let tabs = [
                control_with_style(
                    parent,
                    instance,
                    w!("BUTTON"),
                    "声音",
                    0,
                    0,
                    120,
                    42,
                    ID_TAB_SOUND,
                    tab_style | WS_GROUP,
                )?,
                control_with_style(
                    parent,
                    instance,
                    w!("BUTTON"),
                    "桌宠",
                    120,
                    0,
                    120,
                    42,
                    ID_TAB_PET,
                    tab_style,
                )?,
                control_with_style(
                    parent,
                    instance,
                    w!("BUTTON"),
                    "关于",
                    240,
                    0,
                    120,
                    42,
                    ID_TAB_ABOUT,
                    tab_style,
                )?,
            ];

            let mut emphasized = Vec::new();
            let mut sound = Vec::new();
            emphasized.push(label(parent, instance, "音量", 18, 58, 90, 20, &mut sound)?);
            let volume_value = label(parent, instance, "50%", 278, 58, 58, 20, &mut sound)?;
            let volume = trackbar(parent, instance, 18, 78, 318, 22, ID_VOLUME, 0, 100)?;
            sound.push(volume);

            emphasized.push(label(
                parent,
                instance,
                "声音模式",
                18,
                118,
                100,
                18,
                &mut sound,
            )?);
            label(parent, instance, "大狗 按键", 18, 140, 100, 18, &mut sound)?;
            let sound_mode_alternate = control_with_style(
                parent,
                instance,
                w!("BUTTON"),
                "大 / 狗",
                18,
                158,
                159,
                30,
                ID_SOUND_MODE,
                WINDOW_STYLE(BS_OWNERDRAW as u32) | WS_TABSTOP,
            )?;
            let sound_mode_dagou = control_with_style(
                parent,
                instance,
                w!("BUTTON"),
                "大狗",
                177,
                158,
                159,
                30,
                ID_SOUND_MODE_DAGOU,
                WINDOW_STYLE(BS_OWNERDRAW as u32) | WS_TABSTOP,
            )?;
            sound.push(sound_mode_alternate);
            sound.push(sound_mode_dagou);

            let melody = checkbox(parent, instance, "狗叫旋律", 18, 199, 318, 25, ID_MELODY)?;
            sound.push(melody);
            label(parent, instance, "速度", 18, 228, 50, 18, &mut sound)?;
            let bpm_value = label(parent, instance, "128", 278, 228, 58, 18, &mut sound)?;
            let bpm = trackbar(
                parent,
                instance,
                18,
                246,
                318,
                20,
                ID_BPM,
                GROOVE_BPM_MIN as i32,
                GROOVE_BPM_MAX as i32,
            )?;
            sound.push(bpm);

            emphasized.push(label(
                parent,
                instance,
                "叫 按键",
                18,
                282,
                100,
                18,
                &mut sound,
            )?);
            let capture_key = control(
                parent,
                instance,
                w!("BUTTON"),
                "添加按键",
                18,
                365,
                154,
                30,
                ID_CAPTURE_KEY,
                WS_TABSTOP,
            )?;
            sound.push(capture_key);
            sound.push(control(
                parent,
                instance,
                w!("BUTTON"),
                "恢复默认",
                182,
                365,
                154,
                30,
                ID_RESET_KEYS,
                WS_TABSTOP,
            )?);

            let mut pet = Vec::new();
            emphasized.push(label(parent, instance, "大小", 18, 64, 90, 20, &mut pet)?);
            let scale_value = label(parent, instance, "100%", 278, 64, 58, 20, &mut pet)?;
            let scale = trackbar(
                parent,
                instance,
                18,
                84,
                318,
                24,
                ID_SCALE,
                (PET_SCALE_MIN * 100.0) as i32,
                (PET_SCALE_MAX * 100.0) as i32,
            )?;
            pet.push(scale);

            emphasized.push(label(
                parent,
                instance,
                "反应强度",
                18,
                132,
                100,
                20,
                &mut pet,
            )?);
            let reaction_value = label(parent, instance, "125%", 278, 132, 58, 20, &mut pet)?;
            let reaction = trackbar(parent, instance, 18, 152, 318, 24, ID_REACTION, 50, 200)?;
            pet.push(reaction);

            let flip_horizontal = checkbox(
                parent,
                instance,
                "左右镜像",
                18,
                202,
                318,
                30,
                ID_FLIP_HORIZONTAL,
            )?;
            pet.push(flip_horizontal);
            let flip_vertical = checkbox(
                parent,
                instance,
                "上下镜像",
                18,
                238,
                318,
                30,
                ID_FLIP_VERTICAL,
            )?;
            pet.push(flip_vertical);
            let always_on_top = checkbox(
                parent,
                instance,
                "强制置顶",
                18,
                274,
                318,
                30,
                ID_ALWAYS_ON_TOP,
            )?;
            pet.push(always_on_top);
            let click_through = checkbox(
                parent,
                instance,
                "鼠标穿透",
                18,
                310,
                318,
                30,
                ID_CLICK_THROUGH,
            )?;
            pet.push(click_through);
            label(
                parent,
                instance,
                "鼠标穿透后可按 Ctrl + Alt + D 恢复。",
                18,
                356,
                318,
                38,
                &mut pet,
            )?;

            let mut about = Vec::new();
            let icon_control = control_with_style(
                parent,
                instance,
                w!("STATIC"),
                "大狗桌宠图标",
                20,
                64,
                52,
                52,
                0,
                WINDOW_STYLE(3),
            )?;
            SendMessageW(
                icon_control,
                STM_SETIMAGE,
                Some(WPARAM(IMAGE_ICON.0 as usize)),
                Some(LPARAM(icon.0 as isize)),
            );
            about.push(icon_control);
            emphasized.push(label(
                parent,
                instance,
                "大狗桌宠",
                86,
                64,
                220,
                22,
                &mut about,
            )?);
            label(
                parent,
                instance,
                &format!("版本 {}", env!("CARGO_PKG_VERSION")),
                86,
                88,
                220,
                20,
                &mut about,
            )?;
            label(
                parent,
                instance,
                "开发者：冰冰赚大钱",
                20,
                134,
                316,
                22,
                &mut about,
            )?;
            label(
                parent,
                instance,
                "未经许可禁止商业使用",
                20,
                162,
                316,
                22,
                &mut about,
            )?;
            emphasized.push(label(
                parent,
                instance,
                "软件更新",
                20,
                204,
                160,
                22,
                &mut about,
            )?);
            let update_status = label(parent, instance, "等待检查", 20, 228, 196, 20, &mut about)?;
            about.push(control(
                parent,
                instance,
                w!("BUTTON"),
                "检查更新",
                224,
                202,
                112,
                30,
                ID_CHECK_UPDATE,
                WS_TABSTOP,
            )?);
            about.push(control(
                parent,
                instance,
                w!("BUTTON"),
                "反馈问题",
                20,
                262,
                150,
                32,
                ID_FEEDBACK,
                WS_TABSTOP,
            )?);
            about.push(control(
                parent,
                instance,
                w!("BUTTON"),
                "项目地址",
                186,
                262,
                150,
                32,
                ID_PROJECT,
                WS_TABSTOP,
            )?);
            about.push(control(
                parent,
                instance,
                w!("BUTTON"),
                "隐私说明",
                20,
                306,
                150,
                32,
                ID_PRIVACY,
                WS_TABSTOP,
            )?);
            let all_controls = tabs
                .iter()
                .copied()
                .chain(sound.iter().copied())
                .chain(pet.iter().copied())
                .chain(about.iter().copied());
            for control in all_controls {
                SendMessageW(
                    control,
                    WM_SETFONT,
                    Some(WPARAM(font.0 as usize)),
                    Some(LPARAM(1)),
                );
                let _ = SetWindowTheme(control, w!("Explorer"), PCWSTR::null());
            }
            for control in tabs.iter().copied().chain(emphasized.iter().copied()) {
                SendMessageW(
                    control,
                    WM_SETFONT,
                    Some(WPARAM(emphasis_font.0 as usize)),
                    Some(LPARAM(1)),
                );
            }

            let mut ui = Self {
                parent,
                instance,
                font,
                emphasis_font,
                sound_controls: sound,
                pet_controls: pet,
                about_controls: about,
                tabs,
                volume,
                volume_value,
                sound_mode_buttons: [sound_mode_alternate, sound_mode_dagou],
                melody,
                bpm,
                bpm_value,
                key_buttons: Vec::new(),
                key_codes: Vec::new(),
                capture_key,
                scale,
                scale_value,
                reaction,
                reaction_value,
                flip_horizontal,
                flip_vertical,
                always_on_top,
                click_through,
                update_status,
                selected_tab: SettingsTab::Sound,
                sound_mode: SoundMode::Alternate,
                melody_enabled: false,
                flip_horizontal_enabled: false,
                flip_vertical_enabled: false,
                always_on_top_enabled: false,
                click_through_enabled: false,
                capturing: false,
            };
            ui.select_tab(SettingsTab::Sound);
            Ok(ui)
        }
    }

    pub fn refresh(&mut self, settings: &AppSettings, capturing: bool) {
        unsafe {
            set_trackbar(
                self.volume,
                (settings.volume / VOLUME_MAX * 100.0).round() as i32,
            );
            set_text(
                self.volume_value,
                &format!("{:.0}%", settings.volume / VOLUME_MAX * 100.0),
            );
            self.sound_mode = settings.sound_mode;
            for button in self.sound_mode_buttons {
                let _ = InvalidateRect(Some(button), None, true);
            }
            self.melody_enabled = settings.playback_mode == PlaybackMode::Groove;
            let _ = InvalidateRect(Some(self.melody), None, true);
            let _ = EnableWindow(self.bpm, settings.playback_mode == PlaybackMode::Groove);
            set_trackbar(self.bpm, settings.groove_bpm as i32);
            set_text(self.bpm_value, &settings.groove_bpm.to_string());
            self.refresh_key_buttons(&settings.jiao_key_codes);
            set_text(
                self.capture_key,
                if capturing {
                    "请按一个键..."
                } else {
                    "添加按键"
                },
            );
            self.capturing = capturing;

            set_trackbar(self.scale, (settings.scale * 100.0).round() as i32);
            set_text(self.scale_value, &format!("{:.0}%", settings.scale * 100.0));
            set_trackbar(
                self.reaction,
                (settings.reaction_intensity * 100.0).round() as i32,
            );
            set_text(
                self.reaction_value,
                &format!("{:.0}%", settings.reaction_intensity * 100.0),
            );
            self.flip_horizontal_enabled = settings.flip_horizontal;
            self.flip_vertical_enabled = settings.flip_vertical;
            self.always_on_top_enabled = settings.always_on_top;
            self.click_through_enabled = settings.click_through;
            for toggle in [
                self.flip_horizontal,
                self.flip_vertical,
                self.always_on_top,
                self.click_through,
            ] {
                let _ = InvalidateRect(Some(toggle), None, true);
            }
        }
    }

    pub fn command(&mut self, id: i32, settings: &AppSettings) -> SettingsAction {
        if let Some((_, key_code)) = self
            .key_buttons
            .iter()
            .find(|(button, _)| unsafe { GetDlgCtrlID(*button) } == id)
        {
            let mut next = settings.clone();
            next.jiao_key_codes.retain(|code| code != key_code);
            return SettingsAction::Apply(next);
        }
        match id {
            ID_TAB_SOUND => {
                self.select_tab(SettingsTab::Sound);
                SettingsAction::None
            }
            ID_TAB_PET => {
                self.select_tab(SettingsTab::Pet);
                SettingsAction::None
            }
            ID_TAB_ABOUT => {
                self.select_tab(SettingsTab::About);
                SettingsAction::None
            }
            ID_MELODY => {
                let mut next = settings.clone();
                next.playback_mode = if settings.playback_mode == PlaybackMode::Groove {
                    PlaybackMode::Instant
                } else {
                    PlaybackMode::Groove
                };
                SettingsAction::Apply(next)
            }
            ID_SOUND_MODE | ID_SOUND_MODE_DAGOU => {
                let mut next = settings.clone();
                next.sound_mode = if id == ID_SOUND_MODE {
                    SoundMode::Alternate
                } else {
                    SoundMode::DaGou
                };
                SettingsAction::Apply(next)
            }
            ID_FLIP_HORIZONTAL => {
                let mut next = settings.clone();
                next.flip_horizontal = !settings.flip_horizontal;
                SettingsAction::Apply(next)
            }
            ID_FLIP_VERTICAL => {
                let mut next = settings.clone();
                next.flip_vertical = !settings.flip_vertical;
                SettingsAction::Apply(next)
            }
            ID_ALWAYS_ON_TOP => {
                let mut next = settings.clone();
                next.always_on_top = !settings.always_on_top;
                SettingsAction::Apply(next)
            }
            ID_CLICK_THROUGH => {
                let mut next = settings.clone();
                next.click_through = !settings.click_through;
                SettingsAction::Apply(next)
            }
            ID_CAPTURE_KEY => SettingsAction::CaptureKey,
            ID_RESET_KEYS => SettingsAction::ResetKeys,
            ID_CHECK_UPDATE => SettingsAction::CheckUpdate,
            ID_FEEDBACK => SettingsAction::Feedback,
            ID_PROJECT => SettingsAction::Project,
            ID_PRIVACY => SettingsAction::Privacy,
            _ => SettingsAction::None,
        }
    }

    fn refresh_key_buttons(&mut self, key_codes: &[u32]) {
        if self.key_codes == key_codes {
            return;
        }
        unsafe {
            for (button, _) in self.key_buttons.drain(..) {
                self.sound_controls.retain(|control| *control != button);
                let _ = DestroyWindow(button);
            }
            self.key_codes = key_codes.to_vec();
            let mut x = 18;
            let mut y = 304;
            for (index, key_code) in key_codes.iter().copied().enumerate() {
                let text = describe_key(key_code);
                let width = (text.chars().count() as i32 * 7 + 28).clamp(49, 100);
                if x + width > 336 {
                    x = 18;
                    y = 334;
                }
                if y > 334 {
                    break;
                }
                let Ok(button) = control_with_style(
                    self.parent,
                    self.instance,
                    w!("BUTTON"),
                    &text,
                    x,
                    y,
                    width,
                    25,
                    ID_KEY_BASE + index as i32,
                    WINDOW_STYLE(BS_OWNERDRAW as u32) | WS_TABSTOP,
                ) else {
                    continue;
                };
                SendMessageW(
                    button,
                    WM_SETFONT,
                    Some(WPARAM(self.font.0 as usize)),
                    Some(LPARAM(1)),
                );
                let _ = SetWindowTheme(button, w!("Explorer"), PCWSTR::null());
                if self.selected_tab != SettingsTab::Sound {
                    let _ = ShowWindow(button, SW_HIDE);
                }
                self.sound_controls.push(button);
                self.key_buttons.push((button, key_code));
                x += width + 6;
            }
        }
    }

    pub fn paint_background(&self, hdc: HDC, client: RECT) {
        unsafe {
            fill(hdc, client, rgb(255, 255, 255));
            fill(
                hdc,
                RECT {
                    bottom: 42,
                    ..client
                },
                rgb(250, 250, 250),
            );
            fill(
                hdc,
                RECT {
                    top: 41,
                    bottom: 42,
                    ..client
                },
                rgb(226, 226, 228),
            );
            let separators: &[i32] = match self.selected_tab {
                SettingsTab::Sound => &[108, 272],
                SettingsTab::Pet => &[184],
                SettingsTab::About => &[194, 250],
            };
            for y in separators {
                fill(
                    hdc,
                    RECT {
                        left: 18,
                        top: *y,
                        right: client.right - 18,
                        bottom: *y + 1,
                    },
                    rgb(232, 232, 234),
                );
            }
        }
    }

    pub fn set_update_status(&self, status: &str) {
        set_text(self.update_status, status);
    }

    pub fn draw_item(&self, pointer: LPARAM) -> bool {
        if pointer.0 == 0 {
            return false;
        }
        let item = unsafe { &*(pointer.0 as *const DRAWITEMSTRUCT) };
        let id = item.CtlID as i32;
        let tab = match id {
            ID_TAB_SOUND => Some((SettingsTab::Sound, "声音")),
            ID_TAB_PET => Some((SettingsTab::Pet, "桌宠")),
            ID_TAB_ABOUT => Some((SettingsTab::About, "关于")),
            _ => None,
        };
        if let Some((tab, text)) = tab {
            self.draw_tab(item, tab, text);
            return true;
        }
        let text = match id {
            ID_SOUND_MODE => Some("大 / 狗"),
            ID_SOUND_MODE_DAGOU => Some("大狗"),
            _ => None,
        };
        if let Some(text) = text {
            draw_segment(
                item,
                self.font,
                text,
                matches!(
                    (id, self.sound_mode),
                    (ID_SOUND_MODE, SoundMode::Alternate) | (ID_SOUND_MODE_DAGOU, SoundMode::DaGou)
                ),
            );
            return true;
        }
        let text = match id {
            ID_MELODY => Some("狗叫旋律"),
            ID_FLIP_HORIZONTAL => Some("左右镜像"),
            ID_FLIP_VERTICAL => Some("上下镜像"),
            ID_ALWAYS_ON_TOP => Some("强制置顶"),
            ID_CLICK_THROUGH => Some("鼠标穿透"),
            _ => None,
        };
        if let Some(text) = text {
            let checked = match id {
                ID_MELODY => self.melody_enabled,
                ID_FLIP_HORIZONTAL => self.flip_horizontal_enabled,
                ID_FLIP_VERTICAL => self.flip_vertical_enabled,
                ID_ALWAYS_ON_TOP => self.always_on_top_enabled,
                ID_CLICK_THROUGH => self.click_through_enabled,
                _ => false,
            };
            draw_toggle(item, self.font, text, checked);
            return true;
        }
        if let Some((_, key_code)) = self
            .key_buttons
            .iter()
            .find(|(button, _)| unsafe { GetDlgCtrlID(*button) } == id)
        {
            draw_keycap(item, self.font, &format!("{}  ×", describe_key(*key_code)));
            return true;
        }
        let text = match id {
            ID_CAPTURE_KEY if self.capturing => Some("请按一个键..."),
            ID_CAPTURE_KEY => Some("添加按键"),
            ID_RESET_KEYS => Some("恢复默认"),
            ID_CHECK_UPDATE => Some("检查更新"),
            ID_FEEDBACK => Some("反馈问题"),
            ID_PROJECT => Some("项目地址"),
            ID_PRIVACY => Some("隐私说明"),
            _ => None,
        };
        if let Some(text) = text {
            draw_action_button(item, self.font, text, id, self.capturing);
            return true;
        }
        false
    }

    fn draw_tab(&self, item: &DRAWITEMSTRUCT, tab: SettingsTab, text: &str) {
        let selected = tab == self.selected_tab;
        let pressed = item.itemState.0 & ODS_SELECTED.0 != 0;
        let background = if pressed {
            rgb(244, 244, 245)
        } else {
            rgb(250, 250, 250)
        };
        unsafe {
            let background_brush = CreateSolidBrush(background);
            FillRect(item.hDC, &item.rcItem, background_brush);
            let mut underline = item.rcItem;
            underline.top = underline.bottom - if selected { 2 } else { 1 };
            let line_brush = CreateSolidBrush(if selected {
                rgb(198, 43, 43)
            } else {
                rgb(226, 226, 228)
            });
            FillRect(item.hDC, &underline, line_brush);

            let previous_font = SelectObject(item.hDC, HGDIOBJ(self.emphasis_font.0));
            SetBkMode(item.hDC, TRANSPARENT);
            SetTextColor(
                item.hDC,
                if selected {
                    rgb(180, 35, 35)
                } else {
                    rgb(107, 107, 112)
                },
            );
            let mut text = wide(text);
            let text_length = text.len() - 1;
            let mut text_rect = item.rcItem;
            DrawTextW(
                item.hDC,
                &mut text[..text_length],
                &mut text_rect,
                DT_CENTER | DT_VCENTER | DT_SINGLELINE,
            );
            SelectObject(item.hDC, previous_font);
            let _ = DeleteObject(HGDIOBJ(background_brush.0));
            let _ = DeleteObject(HGDIOBJ(line_brush.0));
        }
    }

    pub fn notify(&self, pointer: LPARAM) -> Option<LRESULT> {
        if pointer.0 == 0 {
            return None;
        }
        let header = unsafe { &*(pointer.0 as *const NMHDR) };
        if header.code as i32 != -12
            || !matches!(
                header.idFrom as i32,
                ID_VOLUME | ID_BPM | ID_SCALE | ID_REACTION
            )
        {
            return None;
        }
        let custom = unsafe { &*(pointer.0 as *const NMCUSTOMDRAW) };
        match custom.dwDrawStage.0 {
            1 => Some(LRESULT(0x20)),
            0x10001 => {
                match custom.dwItemSpec {
                    2 => draw_slider_thumb(
                        custom.hdc,
                        custom.rc,
                        header.idFrom as i32 != ID_BPM || self.melody_enabled,
                    ),
                    3 => draw_slider_channel(
                        custom.hdc,
                        custom.rc,
                        header.hwndFrom,
                        header.idFrom as i32 != ID_BPM || self.melody_enabled,
                    ),
                    _ => return Some(LRESULT(0)),
                }
                Some(LRESULT(0x4))
            }
            _ => Some(LRESULT(0)),
        }
    }

    pub fn scroll(&self, control: HWND, settings: &AppSettings) -> SettingsAction {
        let id = unsafe { GetDlgCtrlID(control) };
        let value = trackbar_value(control);
        let mut next = settings.clone();
        match id {
            ID_VOLUME => next.volume = value as f32 / 100.0 * VOLUME_MAX,
            ID_BPM => {
                next.groove_bpm = value.clamp(GROOVE_BPM_MIN as i32, GROOVE_BPM_MAX as i32) as u32
            }
            ID_SCALE => next.scale = value as f32 / 100.0,
            ID_REACTION => next.reaction_intensity = value as f32 / 100.0,
            _ => return SettingsAction::None,
        }
        SettingsAction::Apply(next)
    }

    fn select_tab(&mut self, tab: SettingsTab) {
        self.selected_tab = tab;
        show_group(&self.sound_controls, tab == SettingsTab::Sound);
        show_group(&self.pet_controls, tab == SettingsTab::Pet);
        show_group(&self.about_controls, tab == SettingsTab::About);
        for button in self.tabs {
            unsafe {
                let _ = InvalidateRect(Some(button), None, true);
            }
        }
        unsafe {
            let _ = InvalidateRect(Some(self.parent), None, true);
        }
    }
}

impl Drop for SettingsUi {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(HGDIOBJ(self.font.0));
            let _ = DeleteObject(HGDIOBJ(self.emphasis_font.0));
        }
    }
}

fn draw_segment(item: &DRAWITEMSTRUCT, font: HFONT, text: &str, selected: bool) {
    let pressed = item.itemState.0 & ODS_SELECTED.0 != 0;
    let hot = item.itemState.0 & ODS_HOTLIGHT.0 != 0;
    let background = if pressed {
        rgb(235, 235, 237)
    } else if selected {
        rgb(255, 255, 255)
    } else if hot {
        rgb(246, 246, 247)
    } else {
        rgb(242, 242, 243)
    };
    let border = if selected {
        rgb(198, 43, 43)
    } else {
        rgb(215, 215, 218)
    };
    unsafe {
        fill(item.hDC, item.rcItem, rgb(255, 255, 255));
        rounded_fill(item.hDC, item.rcItem, background, 8);
        rounded_border(item.hDC, item.rcItem, border, 8);
        draw_control_text(
            item.hDC,
            item.rcItem,
            font,
            text,
            if selected {
                rgb(152, 32, 32)
            } else {
                rgb(104, 104, 109)
            },
            DT_CENTER,
        );
    }
}

fn draw_toggle(item: &DRAWITEMSTRUCT, font: HFONT, text: &str, checked: bool) {
    let pressed = item.itemState.0 & ODS_SELECTED.0 != 0;
    let hot = item.itemState.0 & ODS_HOTLIGHT.0 != 0;
    unsafe {
        fill(
            item.hDC,
            item.rcItem,
            if pressed {
                rgb(246, 246, 247)
            } else if hot {
                rgb(250, 250, 250)
            } else {
                rgb(255, 255, 255)
            },
        );
        let mut label_rect = item.rcItem;
        label_rect.left += 2;
        label_rect.right -= 42;
        draw_control_text(item.hDC, label_rect, font, text, rgb(51, 51, 54), DT_LEFT);

        let center_y = (item.rcItem.top + item.rcItem.bottom) / 2;
        let switch_rect = RECT {
            left: item.rcItem.right - 34,
            top: center_y - 9,
            right: item.rcItem.right - 2,
            bottom: center_y + 9,
        };
        rounded_fill(
            item.hDC,
            switch_rect,
            if checked {
                rgb(198, 43, 43)
            } else {
                rgb(184, 184, 188)
            },
            18,
        );
        let knob_left = if checked {
            switch_rect.right - 15
        } else {
            switch_rect.left + 3
        };
        ellipse_fill(
            item.hDC,
            RECT {
                left: knob_left,
                top: switch_rect.top + 3,
                right: knob_left + 12,
                bottom: switch_rect.bottom - 3,
            },
            rgb(255, 255, 255),
        );
    }
}

fn draw_keycap(item: &DRAWITEMSTRUCT, font: HFONT, text: &str) {
    let pressed = item.itemState.0 & ODS_SELECTED.0 != 0;
    let hot = item.itemState.0 & ODS_HOTLIGHT.0 != 0;
    unsafe {
        fill(item.hDC, item.rcItem, rgb(255, 255, 255));
        rounded_fill(
            item.hDC,
            item.rcItem,
            if pressed || hot {
                rgb(245, 245, 246)
            } else {
                rgb(255, 255, 255)
            },
            6,
        );
        rounded_border(
            item.hDC,
            item.rcItem,
            if hot {
                rgb(165, 165, 170)
            } else {
                rgb(210, 210, 213)
            },
            6,
        );
        draw_control_text(
            item.hDC,
            item.rcItem,
            font,
            text,
            rgb(53, 53, 56),
            DT_CENTER,
        );
    }
}

fn draw_action_button(item: &DRAWITEMSTRUCT, font: HFONT, text: &str, id: i32, capturing: bool) {
    let pressed = item.itemState.0 & ODS_SELECTED.0 != 0;
    let hot = item.itemState.0 & ODS_HOTLIGHT.0 != 0;
    let disabled = item.itemState.0 & ODS_DISABLED.0 != 0;
    let primary = matches!(id, ID_CAPTURE_KEY | ID_CHECK_UPDATE);
    let (background, border, foreground) = if primary {
        (
            if disabled {
                rgb(214, 161, 161)
            } else if capturing || pressed {
                rgb(152, 37, 37)
            } else if hot {
                rgb(175, 34, 34)
            } else {
                rgb(198, 43, 43)
            },
            if disabled {
                rgb(214, 161, 161)
            } else {
                rgb(170, 32, 32)
            },
            rgb(255, 255, 255),
        )
    } else {
        (
            if pressed || hot {
                rgb(245, 245, 246)
            } else {
                rgb(255, 255, 255)
            },
            if hot {
                rgb(165, 165, 170)
            } else {
                rgb(210, 210, 213)
            },
            rgb(61, 61, 64),
        )
    };
    unsafe {
        fill(item.hDC, item.rcItem, rgb(255, 255, 255));
        rounded_fill(item.hDC, item.rcItem, background, 7);
        rounded_border(item.hDC, item.rcItem, border, 7);
        draw_control_text(item.hDC, item.rcItem, font, text, foreground, DT_CENTER);
    }
}

fn draw_slider_channel(hdc: HDC, rect: RECT, control: HWND, enabled: bool) {
    let center = (rect.top + rect.bottom) / 2;
    unsafe {
        let track = RECT {
            left: rect.left,
            top: center - 2,
            right: rect.right,
            bottom: center + 2,
        };
        rounded_fill(hdc, track, rgb(220, 220, 223), 4);
        if !enabled {
            return;
        }
        let minimum = SendMessageW(control, TBM_GETRANGEMIN, None, None).0 as i32;
        let maximum = SendMessageW(control, TBM_GETRANGEMAX, None, None).0 as i32;
        let value = trackbar_value(control).clamp(minimum, maximum);
        let progress = if maximum > minimum {
            (value - minimum) as f32 / (maximum - minimum) as f32
        } else {
            0.0
        };
        rounded_fill(
            hdc,
            RECT {
                left: track.left,
                top: center - 2,
                right: track.left + ((track.right - track.left) as f32 * progress).round() as i32,
                bottom: center + 2,
            },
            rgb(198, 43, 43),
            4,
        );
    }
}

fn draw_slider_thumb(hdc: HDC, rect: RECT, enabled: bool) {
    let center_x = (rect.left + rect.right) / 2;
    let center_y = (rect.top + rect.bottom) / 2;
    unsafe {
        ellipse_fill(
            hdc,
            RECT {
                left: center_x - 7,
                top: center_y - 7,
                right: center_x + 7,
                bottom: center_y + 7,
            },
            if enabled {
                rgb(210, 32, 48)
            } else {
                rgb(184, 187, 192)
            },
        );
    }
}

unsafe fn draw_control_text(
    hdc: HDC,
    mut rect: RECT,
    font: HFONT,
    text: &str,
    color: COLORREF,
    alignment: windows::Win32::Graphics::Gdi::DRAW_TEXT_FORMAT,
) {
    unsafe {
        let previous_font = SelectObject(hdc, HGDIOBJ(font.0));
        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, color);
        let mut wide_text = wide(text);
        let text_length = wide_text.len() - 1;
        DrawTextW(
            hdc,
            &mut wide_text[..text_length],
            &mut rect,
            alignment | DT_VCENTER | DT_SINGLELINE,
        );
        SelectObject(hdc, previous_font);
    }
}

unsafe fn fill(hdc: HDC, rect: RECT, color: COLORREF) {
    unsafe {
        let brush = CreateSolidBrush(color);
        FillRect(hdc, &rect, brush);
        let _ = DeleteObject(HGDIOBJ(brush.0));
    }
}

unsafe fn rounded_fill(hdc: HDC, rect: RECT, color: COLORREF, radius: i32) {
    unsafe {
        let brush = CreateSolidBrush(color);
        let previous_brush = SelectObject(hdc, HGDIOBJ(brush.0));
        let previous_pen = SelectObject(hdc, GetStockObject(NULL_PEN));
        let _ = RoundRect(
            hdc,
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            radius,
            radius,
        );
        SelectObject(hdc, previous_pen);
        SelectObject(hdc, previous_brush);
        let _ = DeleteObject(HGDIOBJ(brush.0));
    }
}

unsafe fn rounded_border(hdc: HDC, rect: RECT, color: COLORREF, radius: i32) {
    unsafe {
        let pen = CreatePen(PS_SOLID, 1, color);
        let previous_pen = SelectObject(hdc, HGDIOBJ(pen.0));
        let previous_brush = SelectObject(hdc, GetStockObject(NULL_BRUSH));
        let _ = RoundRect(
            hdc,
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            radius,
            radius,
        );
        SelectObject(hdc, previous_brush);
        SelectObject(hdc, previous_pen);
        let _ = DeleteObject(HGDIOBJ(pen.0));
    }
}

unsafe fn ellipse_fill(hdc: HDC, rect: RECT, color: COLORREF) {
    unsafe {
        let brush = CreateSolidBrush(color);
        let previous_brush = SelectObject(hdc, HGDIOBJ(brush.0));
        let previous_pen = SelectObject(hdc, GetStockObject(NULL_PEN));
        let _ = Ellipse(hdc, rect.left, rect.top, rect.right, rect.bottom);
        SelectObject(hdc, previous_pen);
        SelectObject(hdc, previous_brush);
        let _ = DeleteObject(HGDIOBJ(brush.0));
    }
}

#[allow(clippy::too_many_arguments)]
fn control(
    parent: HWND,
    instance: HINSTANCE,
    class: PCWSTR,
    text: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    id: i32,
    extra_style: WINDOW_STYLE,
) -> Result<HWND> {
    control_with_style(
        parent,
        instance,
        class,
        text,
        x,
        y,
        width,
        height,
        id,
        WINDOW_STYLE(BS_OWNERDRAW as u32) | extra_style,
    )
}

#[allow(clippy::too_many_arguments)]
fn control_with_style(
    parent: HWND,
    instance: HINSTANCE,
    class: PCWSTR,
    text: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    id: i32,
    style: WINDOW_STYLE,
) -> Result<HWND> {
    let text = wide(text);
    unsafe {
        Ok(CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class,
            PCWSTR(text.as_ptr()),
            WS_CHILD | WS_VISIBLE | style,
            x,
            y,
            width,
            height,
            Some(parent),
            Some(HMENU(id as isize as *mut c_void)),
            Some(instance),
            None,
        )?)
    }
}

#[allow(clippy::too_many_arguments)]
fn label(
    parent: HWND,
    instance: HINSTANCE,
    text: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    group: &mut Vec<HWND>,
) -> Result<HWND> {
    let label = control_with_style(
        parent,
        instance,
        w!("STATIC"),
        text,
        x,
        y,
        width,
        height,
        0,
        WINDOW_STYLE(0),
    )?;
    group.push(label);
    Ok(label)
}

#[allow(clippy::too_many_arguments)]
fn checkbox(
    parent: HWND,
    instance: HINSTANCE,
    text: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    id: i32,
) -> Result<HWND> {
    control_with_style(
        parent,
        instance,
        w!("BUTTON"),
        text,
        x,
        y,
        width,
        height,
        id,
        WINDOW_STYLE(BS_OWNERDRAW as u32) | WS_TABSTOP,
    )
}

#[allow(clippy::too_many_arguments)]
fn trackbar(
    parent: HWND,
    instance: HINSTANCE,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    id: i32,
    minimum: i32,
    maximum: i32,
) -> Result<HWND> {
    let trackbar = control_with_style(
        parent,
        instance,
        TRACKBAR_CLASSW,
        "",
        x,
        y,
        width,
        height,
        id,
        WINDOW_STYLE(TBS_NOTICKS) | WS_TABSTOP,
    )?;
    unsafe {
        SendMessageW(
            trackbar,
            TBM_SETRANGE,
            Some(WPARAM(1)),
            Some(LPARAM(
                (((maximum as u32) << 16) | (minimum as u32 & 0xffff)) as isize,
            )),
        );
    }
    Ok(trackbar)
}

fn show_group(controls: &[HWND], visible: bool) {
    unsafe {
        for control in controls {
            let _ = ShowWindow(*control, if visible { SW_SHOW } else { SW_HIDE });
        }
    }
}

fn trackbar_value(control: HWND) -> i32 {
    unsafe { SendMessageW(control, TBM_GETPOS, None, None).0 as i32 }
}

fn set_trackbar(control: HWND, value: i32) {
    unsafe {
        SendMessageW(
            control,
            TBM_SETPOS,
            Some(WPARAM(1)),
            Some(LPARAM(value as isize)),
        );
    }
}

fn set_text(control: HWND, text: &str) {
    let text = wide(text);
    unsafe {
        let _ = SetWindowTextW(control, PCWSTR(text.as_ptr()));
    }
}

fn rgb(red: u8, green: u8, blue: u8) -> COLORREF {
    COLORREF(red as u32 | ((green as u32) << 8) | ((blue as u32) << 16))
}

fn describe_key(code: u32) -> String {
    match code {
        0x0001 => "Esc".into(),
        0x000e => "Backspace".into(),
        0x001c => "Enter".into(),
        0x0e1c => "Num Enter".into(),
        0x0039 => "Space".into(),
        0x0e53 => "Delete".into(),
        0xee53 => "Num Delete".into(),
        _ => format!("0x{code:04X}"),
    }
}

pub fn default_jiao_keys() -> Vec<u32> {
    DEFAULT_JIAO_KEY_CODES.to_vec()
}

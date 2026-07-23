use anyhow::{Context, Result, bail};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconFromResourceEx, HICON, IMAGE_FLAGS, LR_DEFAULTCOLOR,
};

pub const PET_CLASS_NAME: &str = "DagouPetNativeWindow";
pub const SETTINGS_CLASS_NAME: &str = "DagouPetNativeSettingsWindow";
pub const SETTINGS_WIDTH: i32 = 360;
pub const SETTINGS_HEIGHT: i32 = 440;
pub const EDGE_MARGIN: i32 = 22;

const APP_ICON: &[u8] = include_bytes!("../../assets/branding/app-icon.ico");

pub fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn load_icon(size: i32) -> Result<HICON> {
    let frames = ico_frames(APP_ICON)?;
    let frame = frames
        .iter()
        .min_by_key(|frame| (frame.size as i32 - size).unsigned_abs())
        .context("ICO contains no frames")?;
    unsafe {
        Ok(CreateIconFromResourceEx(
            frame.bytes,
            true,
            0x0003_0000,
            size,
            size,
            IMAGE_FLAGS(LR_DEFAULTCOLOR.0),
        )?)
    }
}

struct IcoFrame<'a> {
    size: u32,
    bytes: &'a [u8],
}

fn ico_frames(bytes: &[u8]) -> Result<Vec<IcoFrame<'_>>> {
    if bytes.len() < 6 || read_u16(bytes, 0)? != 0 || read_u16(bytes, 2)? != 1 {
        bail!("invalid ICO header");
    }
    let count = read_u16(bytes, 4)? as usize;
    let mut frames = Vec::with_capacity(count);
    for index in 0..count {
        let offset = 6 + index * 16;
        if offset + 16 > bytes.len() {
            bail!("truncated ICO directory");
        }
        let width = if bytes[offset] == 0 {
            256
        } else {
            bytes[offset] as u32
        };
        let height = if bytes[offset + 1] == 0 {
            256
        } else {
            bytes[offset + 1] as u32
        };
        let length = read_u32(bytes, offset + 8)? as usize;
        let image_offset = read_u32(bytes, offset + 12)? as usize;
        let end = image_offset
            .checked_add(length)
            .context("ICO frame overflow")?;
        let frame = bytes
            .get(image_offset..end)
            .context("truncated ICO frame")?;
        frames.push(IcoFrame {
            size: width.max(height),
            bytes: frame,
        });
    }
    Ok(frames)
}

pub fn monitor_work_area_for_point(point: POINT) -> RECT {
    unsafe {
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        monitor_work_area(monitor)
    }
}

fn monitor_work_area(monitor: windows::Win32::Graphics::Gdi::HMONITOR) -> RECT {
    unsafe {
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            info.rcWork
        } else {
            RECT {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1080,
            }
        }
    }
}

pub fn default_pet_position(size: i32) -> POINT {
    let work = monitor_work_area_for_point(POINT { x: 0, y: 0 });
    POINT {
        x: work.right - size - EDGE_MARGIN,
        y: work.bottom - size - EDGE_MARGIN,
    }
}

pub fn constrain_position(position: POINT, size: i32) -> POINT {
    let work = monitor_work_area_for_point(POINT {
        x: position.x + size / 2,
        y: position.y + size / 2,
    });
    POINT {
        x: position
            .x
            .clamp(work.left - size / 3, work.right - size * 2 / 3),
        y: position
            .y
            .clamp(work.top - size / 3, work.bottom - size * 2 / 3),
    }
}

pub fn position_settings_above(pet: RECT) -> POINT {
    let work = monitor_work_area_for_point(POINT {
        x: (pet.left + pet.right) / 2,
        y: (pet.top + pet.bottom) / 2,
    });
    let preferred_x = (pet.left + pet.right - SETTINGS_WIDTH) / 2;
    let above = pet.top - SETTINGS_HEIGHT - 8;
    let below = pet.bottom + 8;
    let y = if above >= work.top {
        above
    } else if below + SETTINGS_HEIGHT <= work.bottom {
        below
    } else {
        work.bottom - SETTINGS_HEIGHT
    };
    POINT {
        x: preferred_x.clamp(work.left, work.right - SETTINGS_WIDTH),
        y: y.clamp(work.top, work.bottom - SETTINGS_HEIGHT),
    }
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    let value = bytes.get(offset..offset + 2).context("truncated ICO u16")?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let value = bytes.get(offset..offset + 4).context("truncated ICO u32")?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_icon_contains_all_windows_sizes_through_256() {
        let frames = ico_frames(APP_ICON).unwrap();
        let sizes: Vec<u32> = frames.iter().map(|frame| frame.size).collect();
        assert_eq!(sizes, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
    }
}

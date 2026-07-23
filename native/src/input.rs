use crate::settings::{AppSettings, PlaybackMode};

#[cfg(test)]
pub const VK_RETURN: u32 = 0x0d;
#[cfg(test)]
pub const VK_SPACE: u32 = 0x20;
pub const VK_DELETE: u32 = 0x2e;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DogKeyRole {
    Normal,
    Jiao,
}

#[derive(Debug, Clone, Copy)]
pub struct KeyExpression {
    pub key_code: u32,
    pub role: DogKeyRole,
    pub pitch_step: i32,
    pub pan: f32,
}

pub fn legacy_key_code(scan_code: u32, extended: bool) -> u32 {
    if extended {
        0x0e00 | (scan_code & 0xff)
    } else {
        scan_code & 0xff
    }
}

pub fn resolve_key_expression(
    virtual_key: u32,
    scan_code: u32,
    extended: bool,
    settings: &AppSettings,
) -> Option<KeyExpression> {
    let position = physical_key_position(scan_code, extended)?;
    let key_code = if virtual_key == VK_DELETE && scan_code == 0x53 && !extended {
        0xee53
    } else {
        legacy_key_code(scan_code, extended)
    };
    let gradient = (position.0 * 0.85 + position.1 * 0.15).clamp(0.0, 1.0);
    const PITCHES: [i32; 8] = [-5, -4, -3, -1, 0, 2, 3, 4];
    let pitch_index = (gradient * (PITCHES.len() - 1) as f32).round() as usize;
    Some(KeyExpression {
        key_code,
        role: if settings.jiao_key_codes.contains(&key_code) {
            DogKeyRole::Jiao
        } else {
            DogKeyRole::Normal
        },
        pitch_step: if settings.playback_mode == PlaybackMode::Groove {
            PITCHES[pitch_index]
        } else {
            0
        },
        pan: (position.0 * 2.0 - 1.0) * 0.22,
    })
}

fn physical_key_position(scan_code: u32, extended: bool) -> Option<(f32, f32)> {
    if extended {
        let (x, y, width, height) = match scan_code {
            0x1c => (2.5, 2.0, 3.0, 4.0),
            0x1d => (13.95, 4.0, 15.0, 5.0),
            0x35 => (0.5, -2.0, 3.0, 4.0),
            0x38 => (10.95, 4.0, 15.0, 5.0),
            0x47 => (1.5, 0.0, 3.0, 4.0),
            0x48 => (1.5, 2.0, 3.0, 4.0),
            0x49 => (2.5, 0.0, 3.0, 4.0),
            0x4b => (0.5, 3.0, 3.0, 4.0),
            0x4d => (2.5, 3.0, 3.0, 4.0),
            0x4f => (1.5, 1.0, 3.0, 4.0),
            0x50 => (1.5, 3.0, 3.0, 4.0),
            0x51 => (2.5, 1.0, 3.0, 4.0),
            0x52 => (0.5, 0.0, 3.0, 4.0),
            0x53 => (0.5, 1.0, 3.0, 4.0),
            0x5b => (2.15, 4.0, 15.0, 5.0),
            0x5c => (12.25, 4.0, 15.0, 5.0),
            _ => return None,
        };
        return Some(normalize_position(x, y, width, height));
    }

    let (x, y, width, height) = match scan_code {
        0x01 => (0.5, 0.0, 14.0, 1.0),
        0x02..=0x0b => (scan_code as f32 - 0.5, 0.0, 15.0, 5.0),
        0x0c => (11.5, 0.0, 15.0, 5.0),
        0x0d => (12.5, 0.0, 15.0, 5.0),
        0x0e => (14.0, 0.0, 15.0, 5.0),
        0x0f => (0.75, 1.0, 15.0, 5.0),
        0x10..=0x19 => (scan_code as f32 - 14.0, 1.0, 15.0, 5.0),
        0x1a => (12.0, 1.0, 15.0, 5.0),
        0x1b => (13.0, 1.0, 15.0, 5.0),
        0x1c => (13.9, 2.0, 15.0, 5.0),
        0x1d => (0.75, 4.0, 15.0, 5.0),
        0x1e..=0x26 => (scan_code as f32 - 27.7, 2.0, 15.0, 5.0),
        0x27 => (11.3, 2.0, 15.0, 5.0),
        0x28 => (12.3, 2.0, 15.0, 5.0),
        0x29 => (0.5, 0.0, 15.0, 5.0),
        0x2a => (1.15, 3.0, 15.0, 5.0),
        0x2b => (14.25, 1.0, 15.0, 5.0),
        0x2c..=0x32 => (scan_code as f32 - 41.2, 3.0, 15.0, 5.0),
        0x33 => (9.8, 3.0, 15.0, 5.0),
        0x34 => (10.8, 3.0, 15.0, 5.0),
        0x35 => (11.8, 3.0, 15.0, 5.0),
        0x36 => (13.65, 3.0, 15.0, 5.0),
        0x37 => (0.5, -1.0, 3.0, 4.0),
        0x38 => (3.45, 4.0, 15.0, 5.0),
        0x39 => (7.2, 4.0, 15.0, 5.0),
        0x3a => (0.9, 2.0, 15.0, 5.0),
        0x3b..=0x44 => (scan_code as f32 - 56.5, 0.0, 14.0, 1.0),
        0x47 => (0.5, 0.0, 3.0, 4.0),
        0x48 => (1.5, 0.0, 3.0, 4.0),
        0x49 => (2.5, 0.0, 3.0, 4.0),
        0x4a => (1.5, -1.0, 3.0, 4.0),
        0x4b => (0.5, 1.0, 3.0, 4.0),
        0x4c => (1.5, 1.0, 3.0, 4.0),
        0x4d => (2.5, 1.0, 3.0, 4.0),
        0x4e => (2.5, -1.0, 3.0, 4.0),
        0x4f => (0.5, 2.0, 3.0, 4.0),
        0x50 => (1.5, 2.0, 3.0, 4.0),
        0x51 => (2.5, 2.0, 3.0, 4.0),
        0x52 => (1.0, 3.0, 3.0, 4.0),
        0x53 => (2.5, 3.0, 3.0, 4.0),
        0x57 => (12.5, 0.0, 14.0, 1.0),
        0x58 => (13.5, 0.0, 14.0, 1.0),
        _ => return None,
    };
    Some(normalize_position(x, y, width, height))
}

fn normalize_position(x: f32, y: f32, width: f32, height: f32) -> (f32, f32) {
    (
        (x / width).clamp(0.0, 1.0),
        ((height - 1.0 - y) / (height - 1.0).max(1.0)).clamp(0.0, 1.0),
    )
}

#[cfg(test)]
fn pitch_for(virtual_key: u32, scan_code: u32, extended: bool) -> i32 {
    resolve_key_expression(virtual_key, scan_code, extended, &AppSettings::default())
        .unwrap()
        .pitch_step
}

#[cfg(test)]
fn pan_for(virtual_key: u32, scan_code: u32, extended: bool) -> f32 {
    resolve_key_expression(virtual_key, scan_code, extended, &AppSettings::default())
        .unwrap()
        .pan
}

#[cfg(test)]
fn approximately_equal(left: f32, right: f32) -> bool {
    (left - right).abs() < 0.0001
}

#[cfg(test)]
mod legacy_pitch_tests {
    use super::*;

    #[test]
    fn physical_key_geometry_matches_the_previous_pitch_map() {
        assert_eq!(pitch_for(b'Q' as u32, 0x10, false), -3);
        assert_eq!(pitch_for(b'P' as u32, 0x19, false), 2);
        assert_eq!(pitch_for(b'A' as u32, 0x1e, false), -4);
        assert_eq!(pitch_for(VK_SPACE, 0x39, false), -1);
        assert_eq!(pitch_for(VK_RETURN, 0x1c, false), 3);
        assert!(approximately_equal(pan_for(VK_SPACE, 0x39, false), -0.0088));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extended_scan_codes_match_legacy_settings() {
        assert_eq!(legacy_key_code(0x1c, false), 0x001c);
        assert_eq!(legacy_key_code(0x1c, true), 0x0e1c);
        assert_eq!(legacy_key_code(0x53, true), 0x0e53);
    }

    #[test]
    fn rejects_hidden_function_and_media_keys() {
        let settings = AppSettings::default();
        assert!(resolve_key_expression(0x7b, 0x58, false, &settings).is_some());
        for virtual_key in 0x7c..=0x87 {
            assert!(resolve_key_expression(virtual_key, 0, false, &settings).is_none());
        }
        assert!(resolve_key_expression(0xb3, 0, true, &settings).is_none());
    }

    #[test]
    fn instant_mode_disables_pitch_map_without_changing_role() {
        let mut settings = AppSettings {
            playback_mode: PlaybackMode::Instant,
            ..AppSettings::default()
        };
        let expression = resolve_key_expression(VK_SPACE, 0x39, false, &settings).unwrap();
        assert_eq!(expression.role, DogKeyRole::Jiao);
        assert_eq!(expression.pitch_step, 0);

        settings.jiao_key_codes.clear();
        let expression = resolve_key_expression(VK_SPACE, 0x39, false, &settings).unwrap();
        assert_eq!(expression.role, DogKeyRole::Normal);
    }

    #[test]
    fn numpad_delete_keeps_legacy_binding_code() {
        let expression =
            resolve_key_expression(VK_DELETE, 0x53, false, &AppSettings::default()).unwrap();
        assert_eq!(expression.key_code, 0xee53);
        assert_eq!(expression.role, DogKeyRole::Jiao);
    }
}

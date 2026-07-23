use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SETTINGS_SCHEMA_VERSION: u32 = 3;
pub const PET_WINDOW_BASE_SIZE: i32 = 310;
pub const PET_SCALE_MIN: f32 = 0.65;
pub const PET_SCALE_MAX: f32 = 5.0;
pub const REACTION_INTENSITY_MIN: f32 = 0.5;
pub const REACTION_INTENSITY_MAX: f32 = 2.0;
pub const VOLUME_MAX: f32 = 1.6;
pub const GROOVE_BPM_MIN: u32 = 96;
pub const GROOVE_BPM_MAX: u32 = 168;

pub const DEFAULT_JIAO_KEY_CODES: [u32; 7] =
    [0x0001, 0x001c, 0x0e1c, 0x0039, 0x000e, 0x0e53, 0xee53];
const LEGACY_DEFAULT_JIAO_KEY_CODES: [u32; 6] = [0x001c, 0x0e1c, 0x0039, 0x000e, 0x0e53, 0xee53];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SoundMode {
    Alternate,
    DaGou,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackMode {
    Groove,
    Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub volume: f32,
    pub listening: bool,
    pub click_through: bool,
    pub always_on_top: bool,
    pub scale: f32,
    pub reaction_intensity: f32,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub playback_mode: PlaybackMode,
    pub groove_bpm: u32,
    pub sound_mode: SoundMode,
    pub jiao_key_codes: Vec<u32>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            volume: 0.8,
            listening: true,
            click_through: false,
            always_on_top: true,
            scale: 1.0,
            reaction_intensity: 1.25,
            flip_horizontal: false,
            flip_vertical: false,
            x: None,
            y: None,
            playback_mode: PlaybackMode::Groove,
            groove_bpm: 128,
            sound_mode: SoundMode::Alternate,
            jiao_key_codes: DEFAULT_JIAO_KEY_CODES.to_vec(),
        }
    }
}

impl AppSettings {
    pub fn normalize(mut self) -> Self {
        self.volume = finite_clamp(self.volume, 0.8, 0.0, VOLUME_MAX);
        self.scale = finite_clamp(self.scale, 1.0, PET_SCALE_MIN, PET_SCALE_MAX);
        self.reaction_intensity = finite_clamp(
            self.reaction_intensity,
            1.25,
            REACTION_INTENSITY_MIN,
            REACTION_INTENSITY_MAX,
        );
        self.groove_bpm = self.groove_bpm.clamp(GROOVE_BPM_MIN, GROOVE_BPM_MAX);
        self.jiao_key_codes
            .retain(|code| *code <= 0xffff && *code != 0);
        self.jiao_key_codes.sort_unstable();
        self.jiao_key_codes.dedup();
        self.jiao_key_codes.truncate(64);
        self
    }
}

fn finite_clamp(value: f32, fallback: f32, minimum: f32, maximum: f32) -> f32 {
    if value.is_finite() {
        value.clamp(minimum, maximum)
    } else {
        fallback
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub output_device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettingsV3 {
    schema_version: u32,
    settings: AppSettings,
    audio: AudioSettings,
}

#[derive(Debug)]
pub struct SettingsStore {
    path: PathBuf,
    backup_path: PathBuf,
    settings: AppSettings,
    audio: AudioSettings,
}

impl SettingsStore {
    pub fn load_default_location() -> Result<Self> {
        if let Some(path) = std::env::var_os("DAGOU_SETTINGS_PATH") {
            return Self::load(PathBuf::from(path));
        }
        let app_data = std::env::var_os("APPDATA").context("APPDATA is unavailable")?;
        Self::load(
            PathBuf::from(app_data)
                .join("dagou-pet")
                .join("settings.json"),
        )
    }

    pub fn load(path: PathBuf) -> Result<Self> {
        let backup_path = path.with_extension("json.bak");
        let (settings, audio, rewrite) = match read_and_migrate(&path) {
            Ok(value) => value,
            Err(primary_error) if path.exists() => {
                preserve_corrupt_file(&path);
                match read_and_migrate(&backup_path) {
                    Ok((settings, audio, _)) => (settings, audio, true),
                    Err(_) => {
                        eprintln!("settings recovery failed: {primary_error:#}");
                        (AppSettings::default(), AudioSettings::default(), true)
                    }
                }
            }
            Err(_) => (AppSettings::default(), AudioSettings::default(), true),
        };
        let mut store = Self {
            path,
            backup_path,
            settings,
            audio,
        };
        if rewrite {
            store.save().context("failed to write migrated settings")?;
        }
        Ok(store)
    }

    pub fn settings(&self) -> &AppSettings {
        &self.settings
    }

    pub fn audio(&self) -> &AudioSettings {
        &self.audio
    }

    pub fn replace(&mut self, settings: AppSettings) -> Result<()> {
        self.settings = settings.normalize();
        self.save()
    }

    pub fn preview(&mut self, settings: AppSettings) {
        self.settings = settings.normalize();
    }

    pub fn save(&mut self) -> Result<()> {
        let parent = self.path.parent().context("settings path has no parent")?;
        fs::create_dir_all(parent).context("failed to create settings directory")?;
        let temporary_path = self.path.with_extension("json.tmp");
        let payload = StoredSettingsV3 {
            schema_version: SETTINGS_SCHEMA_VERSION,
            settings: self.settings.clone().normalize(),
            audio: self.audio.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&payload)?;
        {
            let mut file =
                File::create(&temporary_path).context("failed to create settings temp")?;
            file.write_all(&bytes)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
        }
        if self.path.exists() {
            let _ = fs::copy(&self.path, &self.backup_path);
            fs::remove_file(&self.path).context("failed to replace settings")?;
        }
        fs::rename(&temporary_path, &self.path).context("failed to commit settings")?;
        Ok(())
    }
}

fn read_and_migrate(path: &Path) -> Result<(AppSettings, AudioSettings, bool)> {
    let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    let value: Value = serde_json::from_slice(&bytes)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    migrate_value(value)
}

fn migrate_value(value: Value) -> Result<(AppSettings, AudioSettings, bool)> {
    let object = value
        .as_object()
        .context("settings root must be an object")?;
    match object.get("schemaVersion").and_then(Value::as_u64) {
        Some(3) => {
            let stored: StoredSettingsV3 = serde_json::from_value(value)?;
            Ok((stored.settings.normalize(), stored.audio, false))
        }
        Some(1 | 2) => {
            let settings_value = object.get("settings").cloned().unwrap_or(Value::Null);
            let mut settings = deserialize_compatible_settings(settings_value)?;
            migrate_legacy_jiao_defaults(&mut settings);
            Ok((settings.normalize(), AudioSettings::default(), true))
        }
        Some(version) => bail!("unsupported settings schema {version}"),
        None => {
            let settings = deserialize_compatible_settings(Value::Object(object.clone()))?;
            Ok((settings.normalize(), AudioSettings::default(), true))
        }
    }
}

fn deserialize_compatible_settings(value: Value) -> Result<AppSettings> {
    let defaults = serde_json::to_value(AppSettings::default())?;
    let mut merged = defaults
        .as_object()
        .cloned()
        .context("default settings must be an object")?;
    if let Some(source) = value.as_object() {
        copy_known_fields(source, &mut merged);
        if !source.contains_key("playbackMode")
            && source.get("melodyEnabled").and_then(Value::as_bool) == Some(false)
        {
            merged.insert("playbackMode".into(), Value::String("instant".into()));
        }
    }
    Ok(serde_json::from_value(Value::Object(merged))?)
}

fn copy_known_fields(source: &Map<String, Value>, destination: &mut Map<String, Value>) {
    for key in [
        "volume",
        "listening",
        "clickThrough",
        "alwaysOnTop",
        "scale",
        "reactionIntensity",
        "flipHorizontal",
        "flipVertical",
        "x",
        "y",
        "playbackMode",
        "grooveBpm",
        "soundMode",
        "jiaoKeyCodes",
    ] {
        if let Some(value) = source.get(key) {
            destination.insert(key.to_owned(), value.clone());
        }
    }
}

fn migrate_legacy_jiao_defaults(settings: &mut AppSettings) {
    let mut actual = settings.jiao_key_codes.clone();
    actual.sort_unstable();
    let mut legacy = LEGACY_DEFAULT_JIAO_KEY_CODES.to_vec();
    legacy.sort_unstable();
    if actual == legacy {
        settings.jiao_key_codes = DEFAULT_JIAO_KEY_CODES.to_vec();
    }
}

fn preserve_corrupt_file(path: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let corrupt = path.with_file_name(format!("settings.corrupt-{timestamp}.json"));
    let _ = fs::rename(path, corrupt);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_flat_legacy_settings_to_schema_three() {
        let value = serde_json::json!({
            "volume": 9,
            "scale": 0.1,
            "soundMode": "da-gou",
            "melodyEnabled": false
        });
        let (settings, audio, rewrite) = migrate_value(value).unwrap();
        assert!(rewrite);
        assert_eq!(settings.volume, VOLUME_MAX);
        assert_eq!(settings.scale, PET_SCALE_MIN);
        assert_eq!(settings.sound_mode, SoundMode::DaGou);
        assert_eq!(settings.playback_mode, PlaybackMode::Instant);
        assert_eq!(audio, AudioSettings::default());
    }

    #[test]
    fn store_round_trip_uses_schema_three() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let mut store = SettingsStore::load(path.clone()).unwrap();
        let mut settings = store.settings().clone();
        settings.volume = 1.2;
        store.replace(settings).unwrap();

        let json: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(json["schemaVersion"], SETTINGS_SCHEMA_VERSION);
        assert_eq!(json["settings"]["volume"], 1.2);
        assert!(json["audio"]["outputDeviceId"].is_null());
    }
}

use crate::input::{DogKeyRole, KeyExpression};
use crate::settings::{AppSettings, PlaybackMode, SoundMode, VOLUME_MAX};
use anyhow::{Context, Result, bail};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig};
use crossbeam_channel::{Receiver, Sender, bounded};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const INTERNAL_SAMPLE_RATE: u32 = 48_000;
#[allow(dead_code)]
pub const DEFAULT_BLOCK_FRAMES: usize = 128;
const MAX_VOICES: usize = 36;
const OUTPUT_GAIN_CALIBRATION: f32 = 1.12;
const INITIAL_FADE_SECONDS: f32 = 0.004;
const PITCH_SMOOTH_SECONDS: f32 = 0.035;
const JIAO_VIBRATO_HZ: f64 = 1.2;
const JIAO_VIBRATO_SEMITONES: f64 = 0.14;
const BREATH_HZ: f32 = 0.67;
const BREATH_DEPTH: f32 = 0.025;
const GROOVE_FIRST_HIT_DELAY_SECONDS: f64 = 0.012;
const GROOVE_LOOKAHEAD_SECONDS: f64 = 0.024;
const GROOVE_IDLE_RESET_SECONDS: f64 = 3.0;
const GROOVE_STEPS_PER_BAR: u64 = 8;
const MELODY_PITCH_STEPS: [i32; 8] = [-5, -4, -3, -1, 0, 2, 3, 4];
const GROOVE_PITCH_CONTOUR: [i32; 12] = [0, 1, 2, 1, -1, 0, 2, 1, -2, 0, 1, 0];
const GROOVE_CHORDS: [[i32; 3]; 4] = [[0, 4, 7], [7, 11, 2], [9, 0, 4], [5, 9, 0]];
const DA_SOURCE_MIDI: f32 = 70.899_04;
const GOU_SOURCE_MIDI: f32 = 62.842_426;
const JIAO_SOURCE_MIDI: f32 = 71.08;
const DA_TARGET_MIDI: [f32; 8] = [65.0, 67.0, 69.0, 71.0, 72.0, 74.0, 76.0, 77.0];
const GOU_TARGET_MIDI: [f32; 8] = [57.0, 59.0, 60.0, 62.0, 64.0, 65.0, 67.0, 69.0];
const JIAO_TARGET_MIDI: [f32; 8] = [65.0, 67.0, 69.0, 71.0, 72.0, 74.0, 76.0, 77.0];

const DA_WAV: &[u8] = include_bytes!("../../assets/dagou/sounds/da.wav");
const GOU_WAV: &[u8] = include_bytes!("../../assets/dagou/sounds/gou.wav");
const JIAO_WAV: &[u8] = include_bytes!("../../assets/dagou/sounds/jiao.wav");
const EI_WAV: &[u8] = include_bytes!("../../assets/dagou/sounds/ei.wav");

#[allow(dead_code)]
pub trait AudioInput: Send {
    fn read(&mut self, output: &mut [f32]) -> usize;
}

#[allow(dead_code)]
pub trait AudioSource: Send {
    fn render(&mut self, output: &mut [f32]);
}

#[allow(dead_code)]
pub trait AudioProcessor: Send {
    fn process(&mut self, input: &[f32], output: &mut [f32]);
}

pub trait AudioOutput {
    fn start(&mut self) -> Result<()>;
    fn stop(&mut self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleName {
    Da,
    Gou,
    Jiao,
    Ei,
}

#[derive(Debug, Clone, Copy)]
pub struct VoiceSpec {
    pub sample: SampleName,
    pub pitch_semitones: f32,
    pub gain: f32,
    pub pan: f32,
    pub sustain: bool,
}

impl VoiceSpec {
    fn keyboard(sample: SampleName, input: KeyExpression) -> Self {
        Self {
            sample,
            pitch_semitones: input.pitch_step as f32,
            gain: if sample == SampleName::Jiao {
                1.0
            } else {
                0.92
            },
            pan: input.pan,
            sustain: true,
        }
    }

    fn ei() -> Self {
        Self {
            sample: SampleName::Ei,
            pitch_semitones: 0.0,
            gain: 0.92,
            pan: 0.0,
            sustain: false,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct VoiceGroup {
    specs: [VoiceSpec; 3],
    len: usize,
}

impl VoiceGroup {
    fn single(spec: VoiceSpec) -> Self {
        Self {
            specs: [spec; 3],
            len: 1,
        }
    }

    fn one_shot(mut self) -> Self {
        for spec in self.specs.iter_mut().take(self.len) {
            spec.sustain = false;
        }
        self
    }
}

#[derive(Clone)]
struct SampleBuffer {
    frames: Arc<[f32]>,
    sample_rate: u32,
}

#[derive(Clone)]
struct SampleBank {
    da: SampleBuffer,
    gou: SampleBuffer,
    jiao: SampleBuffer,
    ei: SampleBuffer,
}

impl SampleBank {
    fn decode() -> Result<Self> {
        Ok(Self {
            da: decode_wav(DA_WAV).context("failed to decode da.wav")?,
            gou: decode_wav(GOU_WAV).context("failed to decode gou.wav")?,
            jiao: decode_wav(JIAO_WAV).context("failed to decode jiao.wav")?,
            ei: decode_wav(EI_WAV).context("failed to decode ei.wav")?,
        })
    }

    fn get(&self, name: SampleName) -> SampleBuffer {
        match name {
            SampleName::Da => self.da.clone(),
            SampleName::Gou => self.gou.clone(),
            SampleName::Jiao => self.jiao.clone(),
            SampleName::Ei => self.ei.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct SustainProfile {
    loop_start_seconds: f64,
    loop_end_seconds: f64,
    crossfade_seconds: f64,
}

fn sustain_profile(sample: SampleName) -> Option<SustainProfile> {
    match sample {
        SampleName::Da => Some(SustainProfile {
            loop_start_seconds: 0.0635,
            loop_end_seconds: 0.1195,
            crossfade_seconds: 0.01,
        }),
        SampleName::Gou => Some(SustainProfile {
            loop_start_seconds: 0.145,
            loop_end_seconds: 0.197,
            crossfade_seconds: 0.01,
        }),
        SampleName::Jiao => Some(SustainProfile {
            loop_start_seconds: 0.139,
            loop_end_seconds: 0.220,
            crossfade_seconds: 0.014,
        }),
        SampleName::Ei => None,
    }
}

#[derive(Debug)]
enum AudioCommand {
    NoteOn {
        owner_id: u32,
        group: VoiceGroup,
        delay_frames: usize,
    },
    NoteOff {
        owner_id: u32,
        follow_up: Option<VoiceGroup>,
    },
    OneShot(VoiceSpec),
    SetVolume(f32),
    StopAll,
}

pub struct WasapiSpeakerOutput {
    stream: Option<Stream>,
}

impl AudioOutput for WasapiSpeakerOutput {
    fn start(&mut self) -> Result<()> {
        if let Some(stream) = &self.stream {
            stream.play()?;
        }
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(stream) = &self.stream {
            let _ = stream.pause();
        }
    }
}

pub struct DogAudio {
    sender: Sender<AudioCommand>,
    output: WasapiSpeakerOutput,
    sample_rate: u32,
    device_name: String,
    healthy: Arc<AtomicBool>,
}

impl DogAudio {
    pub fn start(output_device_name: Option<&str>, volume: f32) -> Result<Self> {
        let bank = SampleBank::decode()?;
        let host = cpal::default_host();
        let device = if let Some(requested) = output_device_name {
            host.output_devices()?
                .find(|device| device.name().ok().as_deref() == Some(requested))
                .or_else(|| host.default_output_device())
        } else {
            host.default_output_device()
        }
        .context("no WASAPI output device is available")?;

        let device_name = device.name().unwrap_or_else(|_| "未知设备".into());
        let supported = select_output_config(&device)?;
        let sample_format = supported.sample_format();
        let config: StreamConfig = supported.into();
        let sample_rate = config.sample_rate.0;
        let channels = config.channels as usize;
        let (sender, receiver) = bounded(256);
        let mixer = RealtimeMixer::new(bank, receiver, sample_rate, channels, volume);
        let healthy = Arc::new(AtomicBool::new(true));
        let stream = match sample_format {
            SampleFormat::F32 => build_stream::<f32>(&device, &config, mixer, healthy.clone())?,
            SampleFormat::I16 => build_stream::<i16>(&device, &config, mixer, healthy.clone())?,
            SampleFormat::U16 => build_stream::<u16>(&device, &config, mixer, healthy.clone())?,
            other => bail!("unsupported WASAPI sample format {other}"),
        };
        let mut output = WasapiSpeakerOutput {
            stream: Some(stream),
        };
        output.start()?;
        Ok(Self {
            sender,
            output,
            sample_rate,
            device_name,
            healthy,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn device_name(&self) -> &str {
        &self.device_name
    }

    pub fn is_healthy(&self) -> bool {
        self.healthy.load(Ordering::Acquire)
    }

    fn note_on(&self, owner_id: u32, group: VoiceGroup, delay_frames: usize) {
        let _ = self.sender.try_send(AudioCommand::NoteOn {
            owner_id,
            group,
            delay_frames,
        });
    }

    fn note_off(&self, owner_id: u32, follow_up: Option<VoiceGroup>) {
        let _ = self.sender.try_send(AudioCommand::NoteOff {
            owner_id,
            follow_up,
        });
    }

    pub fn play_pet_sound(&self) {
        let _ = self.sender.try_send(AudioCommand::OneShot(VoiceSpec::ei()));
    }

    pub fn set_volume(&self, volume: f32) {
        let _ = self
            .sender
            .try_send(AudioCommand::SetVolume(volume.clamp(0.0, VOLUME_MAX)));
    }

    pub fn stop_all(&self) {
        let _ = self.sender.try_send(AudioCommand::StopAll);
    }
}

impl Drop for DogAudio {
    fn drop(&mut self) {
        self.stop_all();
        self.output.stop();
    }
}

fn select_output_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig> {
    if let Ok(configs) = device.supported_output_configs() {
        for range in configs {
            if range.sample_format() == SampleFormat::F32
                && range.channels() >= 2
                && range.min_sample_rate().0 <= INTERNAL_SAMPLE_RATE
                && range.max_sample_rate().0 >= INTERNAL_SAMPLE_RATE
            {
                return Ok(range.with_sample_rate(cpal::SampleRate(INTERNAL_SAMPLE_RATE)));
            }
        }
    }
    Ok(device.default_output_config()?)
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut mixer: RealtimeMixer,
    healthy: Arc<AtomicBool>,
) -> Result<Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let stream = device.build_output_stream(
        config,
        move |output: &mut [T], _| mixer.write(output),
        move |error| {
            healthy.store(false, Ordering::Release);
            eprintln!("WASAPI output stream failed: {error}");
        },
        None,
    )?;
    Ok(stream)
}

struct Voice {
    owner_id: u32,
    spec: VoiceSpec,
    sample: SampleBuffer,
    profile: Option<SustainProfile>,
    position: f64,
    current_rate: f64,
    base_rate: f64,
    target_rate: f64,
    delay_frames: usize,
    age_frames: usize,
    release_requested: bool,
    reached_sustain: bool,
    state: VoiceState,
    release_pending: bool,
    follow_up: Option<VoiceGroup>,
    sustain_frames: usize,
    phase_seed: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VoiceState {
    Forward,
    Sustain,
    Tail,
}

impl Voice {
    fn new(
        owner_id: u32,
        spec: VoiceSpec,
        sample: SampleBuffer,
        output_rate: u32,
        delay_frames: usize,
        phase_seed: f32,
    ) -> Self {
        let base_rate = 2f64.powf(spec.pitch_semitones as f64 / 12.0) * sample.sample_rate as f64
            / output_rate as f64;
        Self {
            owner_id,
            spec,
            sample,
            profile: if spec.sustain {
                sustain_profile(spec.sample)
            } else {
                None
            },
            position: 0.0,
            current_rate: base_rate,
            base_rate,
            target_rate: base_rate,
            delay_frames,
            age_frames: 0,
            release_requested: false,
            reached_sustain: false,
            state: VoiceState::Forward,
            release_pending: false,
            follow_up: None,
            sustain_frames: 0,
            phase_seed,
        }
    }

    fn request_release(&mut self, follow_up: Option<VoiceGroup>) {
        self.release_requested = true;
        if follow_up.is_some() {
            self.follow_up = follow_up;
        }
        if self.state == VoiceState::Sustain {
            self.release_pending = true;
            if self.spec.sample == SampleName::Jiao {
                self.target_rate = self.current_rate;
            }
        }
    }

    fn render_sample(&mut self, output_rate: u32) -> Option<(f32, f32)> {
        if self.delay_frames > 0 {
            self.delay_frames -= 1;
            return Some((0.0, 0.0));
        }
        if self.position >= self.sample.frames.len() as f64 - 1.0 {
            return None;
        }

        let smoothing = 1.0 - (-1.0 / (PITCH_SMOOTH_SECONDS as f64 * output_rate as f64)).exp();
        self.current_rate += (self.target_rate - self.current_rate) * smoothing;

        let value = match self.state {
            VoiceState::Forward => {
                let value = linear_sample(&self.sample.frames, self.position);
                self.position += self.current_rate;
                if self.position >= self.sample.frames.len() as f64 - 1.0 {
                    return None;
                }
                if self.spec.sustain
                    && !self.release_requested
                    && let Some(profile) = self.profile
                {
                    let loop_end = profile.loop_end_seconds * self.sample.sample_rate as f64;
                    let crossfade = profile.crossfade_seconds * self.sample.sample_rate as f64;
                    if self.position >= loop_end - crossfade {
                        self.state = VoiceState::Sustain;
                        self.reached_sustain = true;
                    }
                }
                value
            }
            VoiceState::Sustain => {
                let profile = self.profile.expect("sustain voice has no loop profile");
                let loop_start = profile.loop_start_seconds * self.sample.sample_rate as f64;
                let loop_end = profile.loop_end_seconds * self.sample.sample_rate as f64;
                let crossfade = profile.crossfade_seconds * self.sample.sample_rate as f64;
                let crossfade_start = loop_end - crossfade;
                if self.release_pending && self.position < crossfade_start {
                    self.state = VoiceState::Tail;
                    let value = linear_sample(&self.sample.frames, self.position);
                    self.position += self.current_rate;
                    value
                } else {
                    let value = if self.position >= crossfade_start {
                        let mix = ((self.position - crossfade_start) / crossfade).clamp(0.0, 1.0);
                        let wrapped = loop_start + self.position - crossfade_start;
                        linear_sample(&self.sample.frames, self.position) * (1.0 - mix) as f32
                            + linear_sample(&self.sample.frames, wrapped) * mix as f32
                    } else {
                        linear_sample(&self.sample.frames, self.position)
                    };
                    self.position += self.current_rate;
                    if self.position >= loop_end {
                        self.position = loop_start + crossfade + (self.position - loop_end);
                        if self.release_pending {
                            self.state = VoiceState::Tail;
                        }
                    }
                    value
                }
            }
            VoiceState::Tail => {
                let value = linear_sample(&self.sample.frames, self.position);
                self.position += self.current_rate;
                if self.position >= self.sample.frames.len() as f64 - 1.0 {
                    return None;
                }
                value
            }
        };

        if self.state == VoiceState::Sustain {
            if !self.release_pending {
                let sustain_seconds = self.sustain_frames as f64 / output_rate as f64;
                let vibrato_semitones = if self.spec.sample == SampleName::Jiao {
                    (sustain_seconds * JIAO_VIBRATO_HZ * std::f64::consts::TAU).cos()
                        * JIAO_VIBRATO_SEMITONES
                } else {
                    0.0
                };
                self.target_rate = self.base_rate * 2f64.powf(vibrato_semitones / 12.0);
            }
            self.sustain_frames += 1;
        }

        let fade_in_frames = (INITIAL_FADE_SECONDS * output_rate as f32).max(1.0) as usize;
        let fade_in = (self.age_frames as f32 / fade_in_frames as f32).min(1.0);
        let pan = self.spec.pan.clamp(-1.0, 1.0);
        let angle = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
        let breath = if self.reached_sustain {
            let phase = self.age_frames as f32 / output_rate as f32 * BREATH_HZ + self.phase_seed;
            1.0 + (phase * std::f32::consts::TAU).sin() * BREATH_DEPTH
        } else {
            1.0
        };
        let amplitude = value * self.spec.gain * fade_in * breath;
        self.age_frames += 1;
        Some((amplitude * angle.cos(), amplitude * angle.sin()))
    }
}

struct CompressorLimiter {
    envelope: f32,
}

impl CompressorLimiter {
    fn new() -> Self {
        Self { envelope: 0.0 }
    }

    fn process_frame(&mut self, left: f32, right: f32, sample_rate: u32) -> (f32, f32) {
        let peak = left.abs().max(right.abs());
        let coefficient = if peak > self.envelope {
            (-1.0 / (0.002 * sample_rate as f32)).exp()
        } else {
            (-1.0 / (0.12 * sample_rate as f32)).exp()
        };
        self.envelope = peak + coefficient * (self.envelope - peak);
        let threshold = 10f32.powf(-8.0 / 20.0);
        let gain = if self.envelope > threshold {
            let compressed = threshold * (self.envelope / threshold).powf(1.0 / 8.0);
            compressed / self.envelope.max(0.000_001)
        } else {
            1.0
        };
        (
            (left * gain).clamp(-0.995, 0.995),
            (right * gain).clamp(-0.995, 0.995),
        )
    }
}

struct RealtimeMixer {
    bank: SampleBank,
    receiver: Receiver<AudioCommand>,
    voices: Vec<Voice>,
    output_rate: u32,
    channels: usize,
    master_gain: f32,
    target_gain: f32,
    compressor: CompressorLimiter,
    voice_age: u64,
}

impl RealtimeMixer {
    fn new(
        bank: SampleBank,
        receiver: Receiver<AudioCommand>,
        output_rate: u32,
        channels: usize,
        volume: f32,
    ) -> Self {
        Self {
            bank,
            receiver,
            voices: Vec::with_capacity(MAX_VOICES),
            output_rate,
            channels,
            master_gain: volume,
            target_gain: volume,
            compressor: CompressorLimiter::new(),
            voice_age: 0,
        }
    }

    fn write<T>(&mut self, output: &mut [T])
    where
        T: Sample + FromSample<f32>,
    {
        self.receive_commands();
        for frame in output.chunks_mut(self.channels) {
            self.receive_commands();
            let mut left = 0.0;
            let mut right = 0.0;
            let mut finished = [false; MAX_VOICES];
            for (index, voice) in self.voices.iter_mut().enumerate() {
                if let Some((voice_left, voice_right)) = voice.render_sample(self.output_rate) {
                    left += voice_left;
                    right += voice_right;
                } else {
                    finished[index] = true;
                }
            }
            let polyphony = self.voices.len().max(1) as f32;
            let polyphony_gain = 1.0 / (polyphony * 0.82).sqrt();
            let gain_step = 1.0 - (-1.0 / (0.012 * self.output_rate as f32)).exp();
            self.master_gain += (self.target_gain - self.master_gain) * gain_step;
            let (left, right) = self.compressor.process_frame(
                left * polyphony_gain * self.master_gain * OUTPUT_GAIN_CALIBRATION,
                right * polyphony_gain * self.master_gain * OUTPUT_GAIN_CALIBRATION,
                self.output_rate,
            );
            for (channel, sample) in frame.iter_mut().enumerate() {
                *sample = T::from_sample(if channel % 2 == 0 { left } else { right });
            }
            self.remove_finished(&finished);
        }
    }

    fn receive_commands(&mut self) {
        while let Ok(command) = self.receiver.try_recv() {
            match command {
                AudioCommand::NoteOn {
                    owner_id,
                    group,
                    delay_frames,
                } => self.spawn_group(owner_id, group, delay_frames),
                AudioCommand::NoteOff {
                    owner_id,
                    follow_up,
                } => {
                    let mut follow_up = follow_up;
                    for voice in self
                        .voices
                        .iter_mut()
                        .filter(|voice| voice.owner_id == owner_id)
                    {
                        voice.request_release(follow_up.take());
                    }
                }
                AudioCommand::OneShot(spec) => self.spawn(u32::MAX, spec, 0),
                AudioCommand::SetVolume(volume) => self.target_gain = volume,
                AudioCommand::StopAll => self.voices.clear(),
            }
        }
    }

    fn spawn(&mut self, owner_id: u32, spec: VoiceSpec, delay_frames: usize) {
        if self.voices.len() == MAX_VOICES {
            self.voices.remove(0);
        }
        self.voice_age = self.voice_age.wrapping_add(1);
        let phase_seed = (self.voice_age as f64 * 1.618_033_988_75).fract() as f32;
        self.voices.push(Voice::new(
            owner_id,
            spec,
            self.bank.get(spec.sample),
            self.output_rate,
            delay_frames,
            phase_seed,
        ));
    }

    fn spawn_group(&mut self, owner_id: u32, group: VoiceGroup, delay_frames: usize) {
        for spec in group.specs.into_iter().take(group.len) {
            self.spawn(owner_id, spec, delay_frames);
        }
    }

    fn remove_finished(&mut self, finished: &[bool; MAX_VOICES]) {
        let mut follow_ups = [(u32::MAX, None); MAX_VOICES];
        let mut follow_up_count = 0;
        for (index, voice) in self.voices.iter().enumerate() {
            if finished[index]
                && let Some(spec) = voice.follow_up
            {
                follow_ups[follow_up_count] = (voice.owner_id, Some(spec));
                follow_up_count += 1;
            }
        }
        let mut index = 0;
        self.voices.retain(|_| {
            let keep = !finished[index];
            index += 1;
            keep
        });
        for (owner_id, group) in follow_ups.into_iter().take(follow_up_count) {
            if let Some(group) = group {
                self.spawn_group(owner_id, group, 0);
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ActiveNote {
    input: KeyExpression,
    groove_pitch_index: Option<usize>,
    groove_step: u64,
}

pub struct SoundController {
    audio: DogAudio,
    settings: AppSettings,
    active: HashMap<u32, ActiveNote>,
    next_alternate: SampleName,
    alternate_da_expression: Option<KeyExpression>,
    alternate_pitch_index: Option<usize>,
    groove_origin: Instant,
    groove_last_input: Option<Instant>,
    groove_next_step: u64,
    groove_pair: u64,
}

impl SoundController {
    pub fn default_output_device_name() -> Option<String> {
        cpal::default_host().default_output_device()?.name().ok()
    }

    pub fn start(settings: &AppSettings, output_device_name: Option<&str>) -> Result<Self> {
        Ok(Self {
            audio: DogAudio::start(output_device_name, settings.volume)?,
            settings: settings.clone(),
            active: HashMap::new(),
            next_alternate: SampleName::Da,
            alternate_da_expression: None,
            alternate_pitch_index: None,
            groove_origin: Instant::now(),
            groove_last_input: None,
            groove_next_step: 0,
            groove_pair: 0,
        })
    }

    pub fn configure(&mut self, settings: &AppSettings) {
        let reset = settings.sound_mode != self.settings.sound_mode
            || settings.playback_mode != self.settings.playback_mode
            || settings.groove_bpm != self.settings.groove_bpm;
        self.audio.set_volume(settings.volume);
        self.settings = settings.clone();
        if reset {
            self.reset();
        }
    }

    pub fn output_device_name(&self) -> &str {
        self.audio.device_name()
    }

    pub fn is_healthy(&self) -> bool {
        self.audio.is_healthy()
    }

    pub fn key_down(&mut self, press_id: u32, input: KeyExpression) {
        if self.active.contains_key(&press_id) || !self.settings.listening {
            return;
        }
        let (delay_frames, groove_step) = self.groove_schedule();
        let (group, groove_pitch_index) = self.create_key_group(input, groove_step);
        self.active.insert(
            press_id,
            ActiveNote {
                input,
                groove_pitch_index,
                groove_step,
            },
        );
        self.audio.note_on(press_id, group, delay_frames);
    }

    pub fn key_up(&mut self, press_id: u32) {
        let Some(active) = self.active.remove(&press_id) else {
            return;
        };
        let follow_up = if active.input.role == DogKeyRole::Normal
            && self.settings.sound_mode == SoundMode::DaGou
        {
            if self.settings.playback_mode == PlaybackMode::Groove {
                Some(
                    groove_voice_group(
                        SampleName::Gou,
                        active.input,
                        active.groove_step + 1,
                        active
                            .groove_pitch_index
                            .unwrap_or_else(|| closest_pitch_index(active.input.pitch_step)),
                    )
                    .one_shot(),
                )
            } else {
                Some(
                    VoiceGroup::single(VoiceSpec::keyboard(SampleName::Gou, active.input))
                        .one_shot(),
                )
            }
        } else {
            None
        };
        self.audio.note_off(press_id, follow_up);
    }

    pub fn play_pet_sound(&self) {
        if self.settings.listening {
            self.audio.play_pet_sound();
        }
    }

    pub fn reset(&mut self) {
        self.active.clear();
        self.reset_phrase();
        self.groove_origin = Instant::now();
        self.groove_last_input = None;
        self.groove_next_step = 0;
        self.audio.stop_all();
    }

    fn create_key_group(
        &mut self,
        input: KeyExpression,
        groove_step: u64,
    ) -> (VoiceGroup, Option<usize>) {
        if input.role == DogKeyRole::Jiao {
            let pitch_index = closest_pitch_index(input.pitch_step);
            return if self.settings.playback_mode == PlaybackMode::Groove {
                (
                    groove_voice_group(SampleName::Jiao, input, groove_step, pitch_index),
                    Some(pitch_index),
                )
            } else {
                (
                    VoiceGroup::single(VoiceSpec::keyboard(SampleName::Jiao, input)),
                    None,
                )
            };
        }
        if self.settings.sound_mode == SoundMode::DaGou {
            return if self.settings.playback_mode == PlaybackMode::Groove {
                let pitch_index = self.next_groove_pitch_index(input.pitch_step);
                (
                    groove_voice_group(SampleName::Da, input, groove_step, pitch_index),
                    Some(pitch_index),
                )
            } else {
                (
                    VoiceGroup::single(VoiceSpec::keyboard(SampleName::Da, input)),
                    None,
                )
            };
        }
        self.take_alternate_group(input, groove_step)
    }

    fn take_alternate_group(
        &mut self,
        input: KeyExpression,
        groove_step: u64,
    ) -> (VoiceGroup, Option<usize>) {
        if self.next_alternate == SampleName::Da {
            self.next_alternate = SampleName::Gou;
            self.alternate_da_expression = Some(input);
            if self.settings.playback_mode == PlaybackMode::Groove {
                let pitch_index = self.next_groove_pitch_index(input.pitch_step);
                self.alternate_pitch_index = Some(pitch_index);
                return (
                    groove_voice_group(SampleName::Da, input, groove_step, pitch_index),
                    Some(pitch_index),
                );
            }
            return (
                VoiceGroup::single(VoiceSpec::keyboard(SampleName::Da, input)),
                None,
            );
        }

        self.next_alternate = SampleName::Da;
        let expression = self.alternate_da_expression.take().unwrap_or(input);
        if self.settings.playback_mode == PlaybackMode::Groove {
            let pitch_index = self
                .alternate_pitch_index
                .take()
                .unwrap_or_else(|| closest_pitch_index(expression.pitch_step));
            (
                groove_voice_group(SampleName::Gou, expression, groove_step, pitch_index),
                Some(pitch_index),
            )
        } else {
            (
                VoiceGroup::single(VoiceSpec::keyboard(SampleName::Gou, expression)),
                None,
            )
        }
    }

    fn next_groove_pitch_index(&mut self, pitch_step: i32) -> usize {
        let pitch_index = resolve_groove_pitch_index(self.groove_pair, pitch_step);
        self.groove_pair += 1;
        pitch_index
    }

    fn groove_schedule(&mut self) -> (usize, u64) {
        if self.settings.playback_mode != PlaybackMode::Groove {
            return (0, 0);
        }
        let now = Instant::now();
        let idle = self
            .groove_last_input
            .is_none_or(|last| now.duration_since(last).as_secs_f64() >= GROOVE_IDLE_RESET_SECONDS);
        if idle {
            self.reset_phrase();
            self.groove_origin = now + Duration::from_secs_f64(GROOVE_FIRST_HIT_DELAY_SECONDS);
            self.groove_last_input = Some(now);
            self.groove_next_step = 1;
            return (
                (GROOVE_FIRST_HIT_DELAY_SECONDS * self.audio.sample_rate() as f64).round() as usize,
                0,
            );
        }

        let step_seconds = 60.0 / self.settings.groove_bpm as f64 / 2.0;
        let elapsed = now
            .checked_duration_since(self.groove_origin)
            .unwrap_or_default()
            .as_secs_f64();
        let base_step = ((elapsed + GROOVE_LOOKAHEAD_SECONDS) / step_seconds).ceil() as u64;
        let step = self
            .groove_next_step
            .max(base_step)
            .min(base_step.saturating_add(1));
        self.groove_next_step = step.saturating_add(1);
        self.groove_last_input = Some(now);
        let target = self.groove_origin + Duration::from_secs_f64(step as f64 * step_seconds);
        let delay = target
            .checked_duration_since(now)
            .unwrap_or_default()
            .as_secs_f64();
        (
            (delay * self.audio.sample_rate() as f64).round() as usize,
            step,
        )
    }

    fn reset_phrase(&mut self) {
        self.next_alternate = SampleName::Da;
        self.alternate_da_expression = None;
        self.alternate_pitch_index = None;
        self.groove_pair = 0;
    }
}

fn closest_pitch_index(pitch_step: i32) -> usize {
    MELODY_PITCH_STEPS
        .iter()
        .enumerate()
        .min_by_key(|(_, candidate)| (pitch_step - **candidate).abs())
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn resolve_groove_pitch_index(pair: u64, pitch_step: i32) -> usize {
    let base = closest_pitch_index(pitch_step) as i32;
    let offset = GROOVE_PITCH_CONTOUR[(pair as usize) % GROOVE_PITCH_CONTOUR.len()];
    (base + offset).clamp(0, MELODY_PITCH_STEPS.len() as i32 - 1) as usize
}

fn sample_pitch_map(sample: SampleName) -> (f32, &'static [f32; 8]) {
    match sample {
        SampleName::Da => (DA_SOURCE_MIDI, &DA_TARGET_MIDI),
        SampleName::Gou => (GOU_SOURCE_MIDI, &GOU_TARGET_MIDI),
        SampleName::Jiao => (JIAO_SOURCE_MIDI, &JIAO_TARGET_MIDI),
        SampleName::Ei => (0.0, &DA_TARGET_MIDI),
    }
}

fn groove_voice_group(
    sample: SampleName,
    input: KeyExpression,
    step: u64,
    pitch_index: usize,
) -> VoiceGroup {
    let (source_midi, targets) = sample_pitch_map(sample);
    let chord = GROOVE_CHORDS[((step / GROOVE_STEPS_PER_BAR) as usize) % GROOVE_CHORDS.len()];
    let requested = targets[pitch_index.min(targets.len() - 1)];
    let strong_beat = step.is_multiple_of(2);
    let primary_midi = if strong_beat || input.role == DogKeyRole::Jiao {
        closest_chord_tone(requested, source_midi, chord)
    } else {
        requested
    };
    let accent = match step % GROOVE_STEPS_PER_BAR {
        0 => 1.24,
        4 => 1.17,
        value if value.is_multiple_of(2) => 1.1,
        _ => 0.92,
    };
    let mut primary = VoiceSpec::keyboard(sample, input);
    primary.pitch_semitones = primary_midi - source_midi;
    primary.gain *= 0.88 * accent;
    primary.pan = (input.pan * 1.55).clamp(-0.72, 0.72);
    let mut group = VoiceGroup::single(primary);

    let harmony_count = if strong_beat || input.role == DogKeyRole::Jiao {
        2
    } else {
        1
    };
    for (index, midi) in harmony_tones(primary_midi, source_midi, chord)
        .into_iter()
        .take(harmony_count)
        .enumerate()
    {
        let mut harmony = primary;
        harmony.pitch_semitones = midi - source_midi;
        harmony.gain = primary.gain * if index == 0 { 0.14 } else { 0.08 };
        harmony.pan = if index == 0 {
            if primary.pan <= 0.0 { 0.28 } else { -0.28 }
        } else {
            0.0
        };
        group.specs[group.len] = harmony;
        group.len += 1;
    }
    group
}

fn pitch_class(midi: i32) -> i32 {
    midi.rem_euclid(12)
}

fn chord_candidates(source_midi: f32, chord: [i32; 3]) -> Vec<f32> {
    let minimum = (source_midi - 7.0).ceil() as i32;
    let maximum = (source_midi + 7.0).floor() as i32;
    (minimum..=maximum)
        .filter(|midi| chord.contains(&pitch_class(*midi)))
        .map(|midi| midi as f32)
        .collect()
}

fn closest_chord_tone(target_midi: f32, source_midi: f32, chord: [i32; 3]) -> f32 {
    chord_candidates(source_midi, chord)
        .into_iter()
        .min_by(|left, right| {
            (left - target_midi)
                .abs()
                .total_cmp(&(right - target_midi).abs())
                .then_with(|| {
                    (left - source_midi)
                        .abs()
                        .total_cmp(&(right - source_midi).abs())
                })
        })
        .unwrap_or(target_midi.round())
}

fn harmony_tones(primary_midi: f32, source_midi: f32, chord: [i32; 3]) -> Vec<f32> {
    let mut candidates: Vec<f32> = chord_candidates(source_midi, chord)
        .into_iter()
        .filter(|midi| (*midi - primary_midi).abs() > f32::EPSILON)
        .filter(|midi| {
            matches!(
                (*midi - primary_midi).abs().round() as i32,
                3 | 4 | 5 | 7 | 8 | 9
            )
        })
        .collect();
    candidates.sort_by(|left, right| {
        (left - primary_midi)
            .abs()
            .total_cmp(&(right - primary_midi).abs())
            .then_with(|| {
                (left - source_midi)
                    .abs()
                    .total_cmp(&(right - source_midi).abs())
            })
    });
    candidates
}

fn linear_sample(samples: &[f32], position: f64) -> f32 {
    let index = position.floor() as usize;
    let fraction = (position - index as f64) as f32;
    let left = samples.get(index).copied().unwrap_or(0.0);
    let right = samples.get(index + 1).copied().unwrap_or(left);
    left + (right - left) * fraction
}

fn decode_wav(bytes: &[u8]) -> Result<SampleBuffer> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        bail!("invalid RIFF/WAVE header");
    }
    let mut offset = 12;
    let mut format: Option<(u16, u16, u32, u16)> = None;
    let mut data: Option<&[u8]> = None;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = read_u32(bytes, offset + 4)? as usize;
        let start = offset + 8;
        let end = start.checked_add(size).context("WAV chunk overflow")?;
        if end > bytes.len() {
            bail!("truncated WAV chunk");
        }
        match id {
            b"fmt " if size >= 16 => {
                format = Some((
                    read_u16(bytes, start)?,
                    read_u16(bytes, start + 2)?,
                    read_u32(bytes, start + 4)?,
                    read_u16(bytes, start + 14)?,
                ));
            }
            b"data" => data = Some(&bytes[start..end]),
            _ => {}
        }
        offset = end + (size & 1);
    }
    let (format_tag, channels, sample_rate, bits_per_sample) =
        format.context("WAV has no fmt chunk")?;
    let data = data.context("WAV has no data chunk")?;
    if format_tag != 1 || bits_per_sample != 16 || channels == 0 {
        bail!("only 16-bit PCM WAV assets are supported");
    }
    let frame_bytes = channels as usize * 2;
    let mut mono = Vec::with_capacity(data.len() / frame_bytes);
    for frame in data.chunks_exact(frame_bytes) {
        let mut mixed = 0.0;
        for channel in 0..channels as usize {
            let index = channel * 2;
            mixed += i16::from_le_bytes([frame[index], frame[index + 1]]) as f32 / 32768.0;
        }
        mono.push(mixed / channels as f32);
    }
    Ok(SampleBuffer {
        frames: mono.into(),
        sample_rate,
    })
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    let value = bytes.get(offset..offset + 2).context("truncated u16")?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let value = bytes.get(offset..offset + 4).context("truncated u32")?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_wav_assets_decode_to_mono() {
        for bytes in [DA_WAV, GOU_WAV, JIAO_WAV, EI_WAV] {
            let decoded = decode_wav(bytes).unwrap();
            assert_eq!(decoded.sample_rate, 44_100);
            assert!(!decoded.frames.is_empty());
            assert!(decoded.frames.iter().all(|sample| sample.is_finite()));
        }
    }

    #[test]
    fn pitch_rate_uses_equal_temperament() {
        let octave = 2f64.powf(12.0 / 12.0);
        assert!((octave - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn groove_contour_repeats_and_stays_in_the_pitch_ladder() {
        assert_eq!(GROOVE_PITCH_CONTOUR, [0, 1, 2, 1, -1, 0, 2, 1, -2, 0, 1, 0]);
        for pair in 0..48 {
            for pitch in MELODY_PITCH_STEPS {
                let index = resolve_groove_pitch_index(pair, pitch);
                assert!(index < MELODY_PITCH_STEPS.len());
                assert_eq!(
                    index,
                    resolve_groove_pitch_index(pair + GROOVE_PITCH_CONTOUR.len() as u64, pitch)
                );
            }
        }
    }

    #[test]
    fn groove_da_and_gou_share_one_calibrated_pitch_index() {
        let input = KeyExpression {
            key_code: 0x1e,
            role: DogKeyRole::Normal,
            pitch_step: -3,
            pan: -0.2,
        };
        let da = groove_voice_group(SampleName::Da, input, 1, 3);
        let gou = groove_voice_group(SampleName::Gou, input, 1, 3);
        assert!((da.specs[0].pitch_semitones + DA_SOURCE_MIDI - DA_TARGET_MIDI[3]).abs() < 0.001);
        assert!(
            (gou.specs[0].pitch_semitones + GOU_SOURCE_MIDI - GOU_TARGET_MIDI[3]).abs() < 0.001
        );
    }

    #[test]
    fn strong_groove_hits_add_quiet_consonant_harmony() {
        let input = KeyExpression {
            key_code: 0x1e,
            role: DogKeyRole::Normal,
            pitch_step: 0,
            pan: 0.0,
        };
        let group = groove_voice_group(SampleName::Da, input, 0, 4);
        assert_eq!(group.len, 3);
        let primary = group.specs[0];
        let harmony_gain: f32 = group.specs[1..group.len]
            .iter()
            .map(|voice| voice.gain)
            .sum();
        assert!(harmony_gain < primary.gain * 0.3);
    }

    #[test]
    fn follow_up_group_cannot_enter_a_sustain_loop() {
        let input = KeyExpression {
            key_code: 0x1e,
            role: DogKeyRole::Normal,
            pitch_step: 0,
            pan: 0.0,
        };
        let group = groove_voice_group(SampleName::Gou, input, 1, 4).one_shot();
        assert!(group.specs[..group.len].iter().all(|voice| !voice.sustain));
    }

    #[test]
    fn releasing_a_sustained_note_plays_the_original_tail_to_completion() {
        let bank = SampleBank::decode().unwrap();
        let input = KeyExpression {
            key_code: 0x1e,
            role: DogKeyRole::Normal,
            pitch_step: 0,
            pan: 0.0,
        };
        for sample_name in [SampleName::Da, SampleName::Gou, SampleName::Jiao] {
            let sample = bank.get(sample_name);
            let sample_length = sample.frames.len() as f64;
            let mut voice = Voice::new(
                1,
                VoiceSpec::keyboard(sample_name, input),
                sample,
                INTERNAL_SAMPLE_RATE,
                0,
                0.0,
            );
            for _ in 0..INTERNAL_SAMPLE_RATE {
                assert!(voice.render_sample(INTERNAL_SAMPLE_RATE).is_some());
                if voice.reached_sustain {
                    break;
                }
            }
            assert!(voice.reached_sustain);

            voice.request_release(None);
            for _ in 0..(sample_length as usize * 2) {
                if voice.render_sample(INTERNAL_SAMPLE_RATE).is_none() {
                    break;
                }
            }
            assert!(
                voice.position >= sample_length - 1.0,
                "{sample_name:?} ended before its source tail"
            );
        }
    }
}

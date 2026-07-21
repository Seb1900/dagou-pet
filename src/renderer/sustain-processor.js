const MAX_VOICES = 12;
const INITIAL_FADE_SECONDS = 0.004;
const FORCED_FADE_SECONDS = 0.018;
const SUSTAIN_RELEASE_FADE_SECONDS = 0.2;
const RATE_SMOOTH_SECONDS = 0.035;
const JIAO_VIBRATO_HZ = 1.2;
const JIAO_VIBRATO_SEMITONES = 0.14;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pitchRate(semitones) {
  return 2 ** (semitones / 12);
}

class DagouSustainProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Map();
    this.profiles = new Map();
    this.voices = new Map();
    this.voiceAge = 0;
    this.jiaoSustainPitch = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(message) {
    switch (message.type) {
      case "initialize":
        for (const [name, samples] of Object.entries(message.samples)) {
          this.samples.set(name, samples);
        }
        for (const [name, profile] of Object.entries(message.profiles)) {
          this.profiles.set(name, {
            loopStart: Math.round(profile.loopStart * sampleRate),
            loopEnd: Math.round(profile.loopEnd * sampleRate),
            crossfade: Math.max(1, Math.round(profile.crossfade * sampleRate))
          });
        }
        break;
      case "note-on":
        this.startVoice(message.pressId, message.spec, true);
        break;
      case "one-shot":
        this.startVoice(message.pressId, message.spec, false);
        break;
      case "note-off":
        this.releaseVoice(message.pressId, message.release, message.followUp);
        break;
      case "jiao-pitch":
        this.jiaoSustainPitch = clamp(Number(message.semitones) || 0, -7, 7);
        for (const voice of this.voices.values()) {
          if (voice.spec.sample === "jiao" && voice.state === "sustain") {
            voice.targetRate = voice.baseRate * pitchRate(this.jiaoSustainPitch);
          }
        }
        break;
      case "stop-all":
        this.voices.clear();
        break;
    }
  }

  startVoice(pressId, spec, held) {
    const samples = this.samples.get(spec.sample);
    const profile = this.profiles.get(spec.sample);
    if (!samples || !profile) return;
    this.reclaimVoice(spec.role);
    const baseRate = pitchRate(spec.pitchSemitones);
    this.voices.set(pressId, {
      id: pressId,
      spec,
      samples,
      profile,
      held,
      released: !held,
      state: "forward",
      position: 0,
      baseRate,
      currentRate: baseRate,
      targetRate: baseRate,
      rendered: 0,
      age: this.voiceAge++,
      forcedFadeRemaining: 0,
      forcedFadeTotal: 0,
      followUp: null,
      sustainRendered: 0,
      phaseSeed: (this.voiceAge * 1.61803398875) % 1
    });
  }

  releaseVoice(pressId, release, followUp) {
    const voice = this.voices.get(pressId);
    if (!voice) return;
    voice.held = false;
    voice.released = true;
    voice.followUp = followUp || null;
    if (release === "fade") {
      this.startFade(voice, FORCED_FADE_SECONDS);
      return;
    }
    if (voice.state === "sustain") {
      this.startFade(voice, SUSTAIN_RELEASE_FADE_SECONDS);
    }
  }

  startFade(voice, seconds) {
    voice.forcedFadeTotal = Math.max(1, Math.round(seconds * sampleRate));
    voice.forcedFadeRemaining = voice.forcedFadeTotal;
  }

  reclaimVoice(incomingRole) {
    if (this.voices.size < MAX_VOICES) return;
    const voices = [...this.voices.values()].sort((left, right) => left.age - right.age);
    const candidate =
      voices.find((voice) => voice.released) ||
      voices.find((voice) => voice.spec.role === "normal") ||
      (incomingRole === "jiao" ? voices[0] : voices.find((voice) => voice.spec.role !== "jiao")) ||
      voices[0];
    if (candidate) this.voices.delete(candidate.id);
  }

  read(samples, position) {
    if (position < 0 || position >= samples.length - 1) return 0;
    const index = Math.floor(position);
    const fraction = position - index;
    return samples[index] + (samples[index + 1] - samples[index]) * fraction;
  }

  renderLoop(voice) {
    const { loopStart, loopEnd, crossfade } = voice.profile;
    const crossfadeStart = loopEnd - crossfade;
    let value;
    if (voice.position >= crossfadeStart) {
      const progress = clamp((voice.position - crossfadeStart) / crossfade, 0, 1);
      const wrappedPosition = loopStart + (voice.position - crossfadeStart);
      value =
        this.read(voice.samples, voice.position) * (1 - progress) +
        this.read(voice.samples, wrappedPosition) * progress;
    } else {
      value = this.read(voice.samples, voice.position);
    }
    voice.position += voice.currentRate;
    if (voice.position >= loopEnd) {
      voice.position = loopStart + crossfade + (voice.position - loopEnd);
    }
    return value;
  }

  renderVoice(voice) {
    const smoothing = 1 - Math.exp(-1 / (sampleRate * RATE_SMOOTH_SECONDS));
    voice.currentRate += (voice.targetRate - voice.currentRate) * smoothing;

    let value = 0;
    if (voice.state === "forward") {
      value = this.read(voice.samples, voice.position);
      voice.position += voice.currentRate;
      if (voice.position >= voice.samples.length - 1) return null;
      if (voice.held && !voice.released && voice.position >= voice.profile.loopEnd) {
        voice.state = "sustain";
        voice.position = voice.profile.loopStart + voice.profile.crossfade;
        if (voice.spec.sample === "jiao") {
          voice.targetRate = voice.baseRate * pitchRate(this.jiaoSustainPitch);
        }
      }
    } else if (voice.state === "sustain") {
      value = this.renderLoop(voice);
      const sustainElapsed = voice.sustainRendered / sampleRate;
      const vibratoSemitones = voice.spec.sample === "jiao"
        ? Math.cos(sustainElapsed * JIAO_VIBRATO_HZ * Math.PI * 2) *
          JIAO_VIBRATO_SEMITONES
        : 0;
      const sustainRate = voice.baseRate * pitchRate(
        (voice.spec.sample === "jiao" ? this.jiaoSustainPitch : 0) +
        vibratoSemitones
      );
      voice.targetRate = sustainRate;
      voice.sustainRendered += 1;
    }

    const initialFade = Math.min(
      1,
      voice.rendered / Math.max(1, INITIAL_FADE_SECONDS * sampleRate)
    );
    let envelope = initialFade;
    if (voice.forcedFadeRemaining > 0) {
      const remaining = voice.forcedFadeRemaining / voice.forcedFadeTotal;
      envelope *= remaining * remaining * (3 - 2 * remaining);
      voice.forcedFadeRemaining -= 1;
      if (voice.forcedFadeRemaining <= 0) return null;
    }
    if (voice.state === "sustain") {
      const breath = Math.sin(
        (voice.rendered / sampleRate * 0.67 + voice.phaseSeed) * Math.PI * 2
      );
      envelope *= 1 + breath * 0.025;
    }
    voice.rendered += 1;
    return value * envelope * voice.spec.gain;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] || output[0];
    left.fill(0);
    if (right !== left) right.fill(0);

    const voices = [...this.voices.values()];
    const mixScale = 1 / Math.sqrt(Math.max(1, voices.length * 0.82));
    const finished = new Set();
    for (let frame = 0; frame < left.length; frame += 1) {
      for (const voice of voices) {
        if (finished.has(voice.id)) continue;
        const value = this.renderVoice(voice);
        if (value === null) {
          finished.add(voice.id);
          continue;
        }
        const pan = clamp(voice.spec.pan, -1, 1);
        const angle = (pan + 1) * Math.PI / 4;
        left[frame] += value * Math.cos(angle) * mixScale;
        right[frame] += value * Math.sin(angle) * mixScale;
      }
    }
    const followUps = [];
    for (const id of finished) {
      const voice = this.voices.get(id);
      if (voice?.followUp) followUps.push(voice.followUp);
      this.voices.delete(id);
    }
    for (const followUp of followUps) {
      this.startVoice(followUp.pressId, followUp.spec, false);
    }
    return true;
  }
}

registerProcessor("dagou-sustain-processor", DagouSustainProcessor);

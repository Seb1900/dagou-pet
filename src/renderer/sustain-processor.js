const MAX_VOICES = 36;
const INITIAL_FADE_SECONDS = 0.004;
const FORCED_FADE_SECONDS = 0.018;
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
    this.pendingGroups = new Map();
    this.voiceAge = 0;
    this.jiaoSustainPitch = 0;
    this.frameCursor = typeof currentFrame === "number" ? currentFrame : 0;
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
      case "schedule-voices":
        if ([...this.voices.values()].some(
          (voice) => voice.groupId === message.groupId
        )) break;
        this.pendingGroups.set(message.groupId, {
          startFrame: Math.max(
            this.frameCursor,
            Number(message.startFrame) || 0
          ),
          voices: message.voices,
          held: message.held === true
        });
        break;
      case "note-off":
        this.releaseVoice(message.pressId, message.release, message.followUp);
        break;
      case "release-group":
        this.releaseGroup(message.groupId, message.release);
        break;
      case "jiao-pitch":
        this.jiaoSustainPitch = clamp(Number(message.semitones) || 0, -7, 7);
        for (const voice of this.voices.values()) {
          if (
            voice.spec.sample === "jiao" &&
            voice.state === "sustain" &&
            !voice.releasePending
          ) {
            voice.targetRate = voice.baseRate * pitchRate(this.jiaoSustainPitch);
          }
        }
        break;
      case "stop-all":
        this.voices.clear();
        this.pendingGroups.clear();
        break;
    }
  }

  startVoice(
    pressId,
    spec,
    held,
    startFrame = this.frameCursor,
    groupId = null
  ) {
    const samples = this.samples.get(spec.sample);
    const profile = this.profiles.get(spec.sample);
    if (!samples || (held && !profile)) return;
    this.reclaimVoice(spec.role);
    const baseRate = pitchRate(spec.pitchSemitones);
    const voice = {
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
      releasePending: false,
      hasSustained: false,
      sustainRendered: 0,
      phaseSeed: (this.voiceAge * 1.61803398875) % 1,
      startFrame: Math.max(this.frameCursor, Number(startFrame) || 0),
      groupId
    };
    this.voices.set(pressId, voice);
    return voice;
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
      voice.releasePending = true;
      if (voice.spec.sample === "jiao") {
        voice.targetRate = voice.currentRate;
      }
    }
  }

  releaseGroup(groupId, release = "tail") {
    const pending = this.pendingGroups.get(groupId);
    if (pending) {
      pending.held = false;
      return;
    }
    for (const voice of this.voices.values()) {
      if (voice.groupId === groupId) {
        this.releaseVoice(voice.id, release);
      }
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
    if (!candidate) return;
    if (candidate.groupId !== null) {
      for (const [id, voice] of this.voices) {
        if (voice.groupId === candidate.groupId) this.voices.delete(id);
      }
      return;
    }
    this.voices.delete(candidate.id);
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
    if (voice.releasePending && voice.position < crossfadeStart) {
      voice.state = "tail";
      const value = this.read(voice.samples, voice.position);
      voice.position += voice.currentRate;
      return value;
    }
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
      if (voice.releasePending) voice.state = "tail";
    }
    return value;
  }

  renderVoice(voice, frame) {
    if (frame < voice.startFrame) return 0;
    const smoothing = 1 - Math.exp(-1 / (sampleRate * RATE_SMOOTH_SECONDS));
    voice.currentRate += (voice.targetRate - voice.currentRate) * smoothing;

    let value = 0;
    if (voice.state === "forward") {
      value = this.read(voice.samples, voice.position);
      voice.position += voice.currentRate;
      if (voice.position >= voice.samples.length - 1) return null;
      const crossfadeStart = voice.profile
        ? voice.profile.loopEnd - voice.profile.crossfade
        : Number.POSITIVE_INFINITY;
      if (
        voice.held &&
        !voice.released &&
        voice.profile &&
        voice.position >= crossfadeStart
      ) {
        voice.state = "sustain";
        voice.hasSustained = true;
        if (voice.spec.sample === "jiao") {
          voice.targetRate = voice.baseRate * pitchRate(this.jiaoSustainPitch);
        }
      }
    } else if (voice.state === "sustain") {
      value = this.renderLoop(voice);
      if (!voice.releasePending) {
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
      }
      voice.sustainRendered += 1;
    } else if (voice.state === "tail") {
      value = this.read(voice.samples, voice.position);
      voice.position += voice.currentRate;
      if (voice.position >= voice.samples.length - 1) return null;
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
    if (voice.hasSustained) {
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

    const blockEnd = this.frameCursor + left.length;
    for (const [groupId, group] of this.pendingGroups) {
      if (group.startFrame >= blockEnd) continue;
      this.pendingGroups.delete(groupId);
      for (const voice of group.voices) {
        this.startVoice(
          voice.pressId,
          voice.spec,
          group.held,
          group.startFrame,
          groupId
        );
      }
    }

    const voices = [...this.voices.values()];
    const audibleVoiceCount = voices.filter(
      (voice) => voice.startFrame < blockEnd
    ).length;
    const mixScale = 1 / Math.sqrt(Math.max(1, audibleVoiceCount * 0.82));
    const finished = new Set();
    for (let frame = 0; frame < left.length; frame += 1) {
      for (const voice of voices) {
        if (finished.has(voice.id)) continue;
        const value = this.renderVoice(voice, this.frameCursor + frame);
        if (value === null) {
          finished.add(voice.id);
          this.voices.delete(voice.id);
          if (voice.followUp) {
            const followUp = this.startVoice(
              voice.followUp.pressId,
              voice.followUp.spec,
              false,
              this.frameCursor + frame + 1
            );
            if (followUp) voices.push(followUp);
          }
          continue;
        }
        const pan = clamp(voice.spec.pan, -1, 1);
        const angle = (pan + 1) * Math.PI / 4;
        left[frame] += value * Math.cos(angle) * mixScale;
        right[frame] += value * Math.sin(angle) * mixScale;
      }
    }
    this.frameCursor += left.length;
    return true;
  }
}

registerProcessor("dagou-sustain-processor", DagouSustainProcessor);

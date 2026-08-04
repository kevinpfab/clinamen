import * as THREE from "three";
import { debugSettings } from "../settings";
import type { ActiveAudioVoice, HoldableAudioParam } from "./types";
import { scaleSteps } from "./scale";

// Procedural singing-bowl synthesis: each collision spawns a short-lived voice
// of detuned sine partials plus a noise transient, with voice limiting and a
// feedback-delay tail for a soft, non-repetitive sound field.
export type BasinAudio = {
  readonly isRunning: boolean;
  resume: () => Promise<void>;
  setMasterVolume: (volume: number) => void;
  setToneGain: (gain: number) => void;
  play: (sizeRatio: number, strength: number, sustain?: number) => void;
  dispose: () => Promise<void>;
};

export function createBasinAudio(): BasinAudio {
  return new BasinAudioEngine();
}

class BasinAudioEngine implements BasinAudio {
  private context: AudioContext;
  private output: GainNode;
  private delay: DelayNode;
  private delayGain: GainNode;
  private toneGain = debugSettings.toneGain;
  private activeVoices: ActiveAudioVoice[] = [];
  private readonly maxVoices = 20;

  constructor() {
    this.context = new AudioContext();
    this.output = this.context.createGain();
    this.output.gain.value = debugSettings.masterVolume;

    this.delay = this.context.createDelay(2);
    this.delay.delayTime.value = 0.18;
    this.delayGain = this.context.createGain();
    this.delayGain.gain.value = 0.045;

    const lowpass = this.context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 5200;
    lowpass.Q.value = 0.55;

    this.output.connect(lowpass);
    lowpass.connect(this.context.destination);
    lowpass.connect(this.delay);
    this.delay.connect(this.delayGain);
    this.delayGain.connect(lowpass);
  }

  get isRunning() {
    return this.context.state === "running";
  }

  async resume() {
    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  setMasterVolume(volume: number) {
    const nextVolume = THREE.MathUtils.clamp(volume, 0, 1.8);
    this.output.gain.setTargetAtTime(nextVolume, this.context.currentTime, 0.018);
  }

  setToneGain(gain: number) {
    this.toneGain = THREE.MathUtils.clamp(gain, 0.25, 3);
  }

  async dispose() {
    for (const voice of this.activeVoices.splice(0)) {
      window.clearTimeout(voice.timeoutId);
      voice.gain.disconnect();
    }
    if (this.context.state !== "closed") {
      await this.context.close();
    }
  }

  private releaseVoice(voice: ActiveAudioVoice, time = this.context.currentTime, fadeTime = 0.024) {
    const voiceIndex = this.activeVoices.indexOf(voice);
    if (voiceIndex >= 0) {
      this.activeVoices.splice(voiceIndex, 1);
    }

    window.clearTimeout(voice.timeoutId);
    const gain = voice.gain.gain as HoldableAudioParam;
    if (gain.cancelAndHoldAtTime) {
      gain.cancelAndHoldAtTime(time);
    } else {
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(Math.max(gain.value, 0.0001), time);
    }
    gain.setTargetAtTime(0.0001, time, fadeTime);
    window.setTimeout(() => {
      voice.gain.disconnect();
    }, Math.ceil((fadeTime * 4 + 0.04) * 1000));
  }

  play(sizeRatio: number, strength: number, sustain = 1) {
    if (this.context.state !== "running") {
      return;
    }

    const now = this.context.currentTime;
    while (this.activeVoices.length >= this.maxVoices) {
      const oldestVoice = this.activeVoices[0];
      if (!oldestVoice) {
        break;
      }
      this.releaseVoice(oldestVoice, now, 0.014);
    }

    const index = Math.round(THREE.MathUtils.clamp(sizeRatio, 0, 1) * (scaleSteps.length - 1));
    const base = 280;
    const frequency = base * Math.pow(2, scaleSteps[index] / 19);
    const gainAmount = THREE.MathUtils.clamp(
      (0.016 + strength * 0.076) * this.toneGain,
      0.012,
      0.12,
    );
    const attack = 0.0024;
    const duration = (3.10 + (1 - sizeRatio) * 1.35) * THREE.MathUtils.clamp(sustain, 0.25, 3);
    const microtonalShimmer = Math.pow(2, 1 / 19);

    const voice = this.context.createGain();
    voice.gain.setValueAtTime(0.0001, now);
    voice.gain.exponentialRampToValueAtTime(gainAmount, now + attack);
    voice.gain.exponentialRampToValueAtTime(gainAmount * 0.48, now + 0.070);
    voice.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    voice.connect(this.output);

    const partials = [
      { ratio: 1, gain: 0.58, decay: 0.86 },
      { ratio: microtonalShimmer, gain: 0.085, decay: 1 },
      { ratio: 2.01, gain: 0.42, decay: 0.92 },
      { ratio: 2.72, gain: 0.34, decay: 0.74 },
      { ratio: 4.08, gain: 0.20, decay: 0.54 },
      { ratio: 5.31, gain: 0.08, decay: 0.36 },
    ];

    for (const partial of partials) {
      const oscillator = this.context.createOscillator();
      const partialGain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency * partial.ratio, now);
      oscillator.detune.setValueAtTime((Math.random() - 0.5) * 8, now);
      partialGain.gain.setValueAtTime(partial.gain, now);
      partialGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * partial.decay);
      oscillator.connect(partialGain);
      partialGain.connect(voice);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.1);
    }

    const noiseBuffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.024), this.context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 5.0);
    }

    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const noiseGain = this.context.createGain();
    noise.buffer = noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = THREE.MathUtils.clamp(frequency * 6.8, 1300, 4200);
    filter.Q.value = 6.2;
    noiseGain.gain.setValueAtTime(gainAmount * 0.085, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(voice);
    noise.start(now);
    noise.stop(now + 0.038);

    const activeVoice: ActiveAudioVoice = {
      gain: voice,
      timeoutId: 0,
    };
    this.activeVoices.push(activeVoice);
    activeVoice.timeoutId = window.setTimeout(() => {
      this.releaseVoice(activeVoice, this.context.currentTime, 0.018);
    }, (duration + 0.16) * 1000);
  }
}

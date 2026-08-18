// Audio source for the visualiser.
//
// Four sources, in descending order of "is this really the music":
//   'system' — getDisplayMedia with system audio. Captured at the OS mixer, so
//              it hears the Spotify DESKTOP app and is not affected by DRM.
//              Best option, but Chrome shows a picker and needs a click.
//   'tab'    — chrome.tabCapture of another tab. Real audio for YouTube etc.
//              Spotify's web player is Widevine-protected and yields silence.
//   'mic'    — a real FFT of whatever the microphone hears.
//   'sim'    — synthesised from playback position and BPM. Not analysis; a
//              stand-in for when no capture is granted.

import { smoothNoise, hashNoise, clamp } from './util.js';

export const BANDS = 128;

// Bands are log-spaced 40Hz..16kHz, so this index lands at roughly 215Hz —
// the boundary between "beat" (kick, bass line) and everything a voice does.
export const BASS_BANDS = Math.round(BANDS * 0.28);

// Presence is measured over ~500Hz-4kHz, not the whole non-bass range. A low
// sawtooth (synth bass, distorted bass guitar) sprays harmonics across the
// spectrum and would otherwise register as vocals; up here its 8th-66th
// harmonics are weak, while vowel formants are strong.
const bandOf = f => Math.round(BANDS * Math.log(f / 40) / Math.log(16000 / 40));
const VOICE_LO = bandOf(500), VOICE_HI = bandOf(4000);

/** The slice of spectrum the visualiser gives to the vocal flanks. Wider than
 *  the detection window above, because this is what actually gets drawn and
 *  vowel formants run roughly 300Hz-5kHz — the same range Vocal emphasis
 *  lifts. The flanks used to be handed everything above 215Hz, all the way to
 *  16kHz; the top of that is silent in most music, so the visible vocals never
 *  reached the outer edge and sat floating with a dead gap beside them. */
export const VOICE_BAND_LO = bandOf(300);
export const VOICE_BAND_HI = bandOf(5000);

// Linear-amplitude ratio of the loudest vocal-range peak to the loudest bass
// peak. Vocals in a mix typically sit 6-12dB under the kick, i.e. 0.25-0.5.
const VP_LOW = 0.10, VP_HIGH = 0.45;

/* Smoothing time constants, in milliseconds.
   Everything here used to be a per-frame multiplier, which made the response
   depend on the frame rate rather than on time: identical code settles twice
   as fast at 120fps as at 60fps. Each tau below is the equivalent of the
   original constant at 60fps — k = 1 - exp(-16.67/tau) — so the feel is
   unchanged on a 60Hz display and no longer drifts with refresh rate or with
   how much work the rest of the page happens to be doing. */
const FRAME_MS = 1000 / 60;
const ATTACK_TAU = 20.9;    // was k = 0.55 per frame
const RELEASE_TAU = 130.4;  // was k = 0.12
const VP_RISE_TAU = 362;    // was k = 0.045
const VP_FALL_TAU = 825;    // was k = 0.020

/* Telling a voice from a drum kit.
   Frequency alone cannot do it: a snare's body is 1-6kHz and a hi-hat sits
   above that, both inside the 500Hz-4kHz window used to look for singing, so
   a peak measurement there reports a kick/snare/hat loop with no vocal in it
   as ~78% vocal. What actually separates them is duration — a hit decays in
   tens of milliseconds, a sung note holds for hundreds.

   The measure is a crest factor: the sustained level over the recent peak,
   near 1 for continuous content and near 0 for a burst train. It has to be
   the PEAK and not a fast envelope — a fast envelope collapses between hits,
   which inverts the ratio and makes a burst train look perfectly sustained
   for most of its cycle. A peak-hold stays up across the gaps, so the score
   is stable rather than flapping with the beat. */
const V_SLOW_TAU = 340;     // ms; only sustained content moves this
const V_PEAK_TAU = 620;     // ms; peak-hold decay, longer than a beat period
const TONAL_LOW = 0.34;     // at or below this, treat as percussion
const TONAL_HIGH = 0.68;    // at or above this, treat as fully sustained

/** Multiplier peaking near 2kHz — roughly where vowel formants and consonant
 *  energy sit — and rolling off into deep bass and hiss. Centred on 1 so an
 *  emphasis of 0 leaves the spectrum untouched. */
function vocalWeight(f) {
  const x = Math.log10(Math.max(20, f));
  const peak = Math.exp(-Math.pow((x - 3.3) / 0.8, 2));   // 1 at ~2kHz
  return 0.6 + 1.15 * peak;                               // 0.6 deep bass, ~1.75 mids
}

class Engine {
  constructor() {
    this.mode = 'sim';
    this.data = new Float32Array(BANDS);
    this.smooth = new Float32Array(BANDS);
    this.ctx = null; this.analyser = null; this.stream = null;
    this.bytes = null; this.time = null;
    this.playing = false;
    this.position = 0;
    this.bpm = 120;
    this.seed = 1;
    this.error = null;
    this.label = '';
    this._amp = 0;
    this.sensitivity = 1;      // set from Settings → Music
    this.vocalEmphasis = 0.55;
    this.prev = new Float32Array(BANDS);   // previous frame, for spectral flux
    this.raw = new Float32Array(BANDS);    // pre-weighting, for presence maths
    this.vp = 0;                           // smoothed vocal presence, 0..1
    this.vSlow = 0; this.vPeak = 0;        // vocal-band envelope + peak-hold
    this.bSlow = 0;                        // bass envelope, the reference level

    // Per-band constants. These depend only on the band index and the sample
    // rate, so recomputing them inside the render loop meant ~380 pow/log/exp
    // calls per frame — 23,000 a second — for values that never change.
    // Rebuilt by buildBandTables() whenever a source connects.
    this.binLo = new Int32Array(BANDS);
    this.binHi = new Int32Array(BANDS);
    this.weight = new Float32Array(BANDS); // vocalWeight(centre) - 1
    this.simTilt = new Float32Array(BANDS);
    this.simLow = new Float32Array(BANDS);
    this.buildSimTables();
  }

  /** Log-spaced band edges in FFT bins, plus the vocal-emphasis curve. */
  buildBandTables() {
    const n = this.analyser ? this.analyser.frequencyBinCount : 1024;
    const nyquist = (this.ctx?.sampleRate || 48000) / 2;
    const F_LO = 40, F_HI = Math.min(16000, nyquist);
    for (let i = 0; i < BANDS; i++) {
      const f0 = F_LO * Math.pow(F_HI / F_LO, i / BANDS);
      const f1 = F_LO * Math.pow(F_HI / F_LO, (i + 1) / BANDS);
      const lo = Math.min(n - 1, Math.floor(f0 / nyquist * n));
      this.binLo[i] = lo;
      this.binHi[i] = Math.max(lo + 1, Math.min(n, Math.ceil(f1 / nyquist * n)));
      this.weight[i] = vocalWeight(Math.sqrt(f0 * f1)) - 1;
    }
  }

  buildSimTables() {
    for (let i = 0; i < BANDS; i++) {
      const f = i / BANDS;
      this.simTilt[i] = Math.pow(1 - f, 1.35) * 0.85 + 0.15;
      this.simLow[i] = Math.pow(1 - f, 4) * 1.15;
    }
  }

  /** How much of what's playing right now is voice rather than beat.
   *  Drives the adaptive layout: 0 hands the whole bar to the beat. */
  get vocalPresence() { return this.vp; }

  updatePresence(dt = FRAME_MS) {
    // The simulated source needs its own answer. The ratio test below is
    // calibrated for a dB-scaled capture, where a vocal sits 6-12dB under the
    // kick. The synthesised spectrum is not dB-scaled — its tilt only falls
    // from 1.0 to 0.15 across the whole range — so that test reads it as
    // permanently vocal-heavy: measured 1.0 while playing, which pinned the
    // layout at its 34% floor and left the jittery sparkle bands spread across
    // most of the bar. Synthesise the presence instead, on the same seeded
    // clock as the rest of the simulation, so the split drifts between
    // drums-only and vocals the way a real arrangement does.
    if (!this.live) {
      let target = 0;
      if (this.playing) {
        const beat = (this.position / 1000) * (this.bpm / 60);
        // A new section every 8 beats (two bars), stable per track via seed.
        const section = smoothNoise(Math.floor(beat / 8) * 1.3 + this.seed + 41);
        target = clamp((section - 0.38) / 0.34, 0, 1);
      }
      this.vp += (target - this.vp) *
        (1 - Math.exp(-dt / (target > this.vp ? VP_RISE_TAU : VP_FALL_TAU)));
      return;
    }

    // Uses `raw`, not `smooth`: smooth has already had vocalWeight applied, so
    // measuring the vocal/bass ratio there would count the emphasis twice and
    // report vocals during purely instrumental passages.
    // Peaks, in LINEAR amplitude. Two traps here:
    //  - means are biased by band count: log spacing gives a 60Hz tone only a
    //    couple of lit bands, while a harmonic series lights dozens up top;
    //  - the byte spectrum is dB-scaled, which squashes an 18dB-down harmonic
    //    into looking nearly as loud as the fundamental.
    // Peak-of-linear avoids both, so the ratio means "how loud is the
    // strongest vocal-range thing versus the strongest bass thing".
    // Only reached with a live analyser, so the byte values are always
    // dB-scaled and always need converting back to linear amplitude.
    const dbMin = this.analyser.minDecibels, dbMax = this.analyser.maxDecibels;
    const amp = v => (v <= 0.001 ? 0 : Math.pow(10, (dbMin + v * (dbMax - dbMin)) / 20));

    let bass = 0, voice = 0;
    for (let i = 0; i < BASS_BANDS; i++) bass = Math.max(bass, amp(this.raw[i]));
    for (let i = VOICE_LO; i < VOICE_HI; i++) voice = Math.max(voice, amp(this.raw[i]));

    // Envelopes, so the comparison is between sustained levels rather than
    // between whichever instant each transient happened to peak at.
    this.vSlow += (voice - this.vSlow) * (1 - Math.exp(-dt / V_SLOW_TAU));
    this.bSlow += (bass - this.bSlow) * (1 - Math.exp(-dt / V_SLOW_TAU));
    this.vPeak = Math.max(voice, this.vPeak * Math.exp(-dt / V_PEAK_TAU));

    // A burst train's slow envelope settles near its duty-cycle average while
    // the peak-hold stays at the hit level, so the ratio collapses. Sustained
    // singing keeps the two together.
    const tonality = this.vPeak > 1e-6 ? clamp(this.vSlow / this.vPeak, 0, 1) : 0;
    const sustained = this.vSlow * clamp((tonality - TONAL_LOW) / (TONAL_HIGH - TONAL_LOW), 0, 1);

    let target;
    if (this.bSlow + this.vSlow < 1e-4) target = this.vp;   // silence: hold, don't flap
    else {
      const ratio = this.bSlow > 1e-6 ? sustained / this.bSlow : 2;
      target = clamp((ratio - VP_LOW) / (VP_HIGH - VP_LOW), 0, 1);
    }
    // Deliberately sluggish. The layout is a shape, not a meter — snapping it
    // every frame would be unreadable.
    this.vp += (target - this.vp) *
      (1 - Math.exp(-dt / (target > this.vp ? VP_RISE_TAU : VP_FALL_TAU)));
  }

  /** Called by the Spotify widget on every state update. */
  sync({ playing, position, trackId }) {
    this.playing = playing;
    this.position = position;
    if (trackId && trackId !== this._trackId) {
      this._trackId = trackId;
      this.seed = [...String(trackId)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 99991, 7) || 7;
    }
  }

  /* ---------------- capture ---------------- */

  /** Shared wiring for any real MediaStream. */
  _connect(stream, { mode, label, monitor = false }) {
    this.stop(false);
    this.stream = stream;
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    // Heavier smoothing here flattens syllable onsets before the flux term in
    // readLive() can see them; the renderer does its own attack/release anyway.
    this.analyser.smoothingTimeConstant = 0.62;
    // The defaults (-100..-30 dBFS) are the reason a captured stream pins every
    // band to maximum: mixed music routinely sits well above -30 dBFS, so
    // everything clips. -85..-8 covers the real dynamic range of loud audio.
    this.analyser.minDecibels = -85;
    this.analyser.maxDecibels = -8;
    src.connect(this.analyser);

    // tabCapture redirects the tab's audio to us; without this the tab goes
    // silent while we're capturing it.
    if (monitor) src.connect(this.ctx.destination);

    this.bytes = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Uint8Array(this.analyser.fftSize);
    // Bin edges depend on this context's sample rate, so they are only correct
    // once the AudioContext exists.
    this.buildBandTables();
    this.mode = mode;
    this.label = label;
    this.error = null;

    // If the user hits "stop sharing" in Chrome's bar, fall back cleanly.
    for (const t of stream.getTracks()) {
      t.addEventListener('ended', () => { if (this.stream === stream) this.useSim(); });
    }
    return true;
  }

  async useMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      return this._connect(stream, { mode: 'mic', label: 'Microphone' });
    } catch (e) { return this._fail(e); }
  }

  /** Whole-system audio via the screen-share picker. Catches the desktop app. */
  async useSystem() {
    try {
      // Chrome requires a video track to be requested even when we only want
      // audio; we stop rendering it but must keep the track alive.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 1 },
        audio: {
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          suppressLocalAudioPlayback: false,
        },
      });
      if (!stream.getAudioTracks().length) {
        for (const t of stream.getTracks()) t.stop();
        throw new Error('No audio was shared — tick “Also share system audio” in the picker.');
      }
      return this._connect(stream, { mode: 'system', label: 'System audio' });
    } catch (e) { return this._fail(e); }
  }

  /** Another tab's audio, via a stream id minted by the service worker. */
  async useTab(streamId, label = 'Tab audio') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      });
      return this._connect(stream, { mode: 'tab', label, monitor: true });
    } catch (e) { return this._fail(e); }
  }

  _fail(e) {
    this.error = e?.message || String(e);
    this.mode = 'sim';
    this.label = '';
    return false;
  }

  useSim() {
    this.stop(true);
    this.mode = 'sim';
    this.label = '';
  }

  stop(reset = true) {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.ctx?.close?.().catch?.(() => {});
    this.ctx = null;
    this.analyser = null;
    if (reset) { this.bytes = null; this.time = null; }
  }

  get live() { return this.mode !== 'sim' && !!this.analyser; }

  /* ---------------- reading ---------------- */

  /** 0..1 loudness for this instant — drives the waveform bars. */
  amplitude() {
    if (this.live) {
      this.analyser.getByteTimeDomainData(this.time);
      let sum = 0;
      for (let i = 0; i < this.time.length; i++) {
        const v = (this.time[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.time.length);
      this._amp = clamp(rms * 1.9 * this.sensitivity, 0, 1);
      return this._amp;
    }
    return this.simAmplitude();
  }

  /** Envelope for the simulated source: beat pulses under a slow contour. */
  simAmplitude() {
    if (!this.playing) {
      return 0.05 + 0.035 * smoothNoise(Date.now() / 1100);
    }
    const t = this.position / 1000;
    const beat = t * (this.bpm / 60);
    const phase = beat - Math.floor(beat);
    const kick = Math.pow(1 - phase, 2.6);
    const bar = Math.floor(beat / 4);
    const section = 0.55 + 0.45 * smoothNoise(bar * 0.55 + this.seed);
    const detail = 0.6 + 0.4 * smoothNoise(t * 7 + this.seed);
    return clamp((0.42 + kick * 0.62) * section * detail + 0.07, 0, 1);
  }

  /** BANDS values in 0..1 — kept for anything wanting a spectrum. */
  read() {
    if (this.live) this.readLive(); else this.readSim();

    // Attack/release in milliseconds, not per-frame factors. These used to be
    // fixed per-call multipliers (0.55 rising, 0.12 falling), which ties the
    // smoothing rate to the frame rate: the same numbers settle twice as fast
    // on a 120Hz display as on a 60Hz one, and speed up again whenever the
    // page simply gets cheaper to render. The taus below reproduce the old
    // constants exactly at 60fps and hold that response at any rate.
    const now = performance.now();
    const dt = this._lastRead ? Math.min(64, now - this._lastRead) : FRAME_MS;
    this._lastRead = now;

    const attack = 1 - Math.exp(-dt / ATTACK_TAU);
    const release = 1 - Math.exp(-dt / RELEASE_TAU);
    for (let i = 0; i < BANDS; i++) {
      const target = this.data[i];
      const k = target > this.smooth[i] ? attack : release;
      this.smooth[i] += (target - this.smooth[i]) * k;
    }
    this.updatePresence(dt);
    return this.smooth;
  }

  readLive() {
    this.analyser.getByteFrequencyData(this.bytes);
    const em = this.vocalEmphasis;
    const bytes = this.bytes, lo_ = this.binLo, hi_ = this.binHi, wt = this.weight;
    const sens = this.sensitivity;

    for (let i = 0; i < BANDS; i++) {
      // Band edges are log-spaced 40Hz..16kHz and precomputed: a linear/power
      // split buries the 300Hz-4kHz range where voices live inside a handful
      // of bars, and recomputing the spacing per frame was pure waste.
      const lo = lo_[i], hi = hi_[i];
      let sum = 0;
      for (let j = lo; j < hi; j++) sum += bytes[j];
      let v = sum / (hi - lo) / 255;
      this.raw[i] = v;                      // untouched copy for updatePresence

      // Bass carries most of the energy, so without weighting the display is
      // all kick drum. Lift the vocal range toward parity with it.
      v *= 1 + wt[i] * em;

      // Spectral flux: reward bands that just got louder. Sustained notes sit
      // still while consonants and syllable onsets punch through.
      const flux = v > this.prev[i] ? v - this.prev[i] : 0;
      this.prev[i] = v;
      v += flux * 2.6 * em;

      this.data[i] = clamp(v * sens, 0, 1);
    }
  }

  readSim() {
    const t = this.position / 1000;
    const beat = t * (this.bpm / 60);
    const phase = beat - Math.floor(beat);
    const kick = Math.pow(1 - phase, 3.2);
    const barEnergy = 0.55 + 0.45 * smoothNoise(Math.floor(beat / 4) * 0.7 + this.seed);
    const idle = this.playing ? 0 : Date.now() / 900;
    const sparkleBase = Math.floor(beat * 4) * 13;
    for (let i = 0; i < BANDS; i++) {
      const f = i / BANDS;
      const wobble = smoothNoise(t * (1.6 + f * 5) + i * 0.31 + this.seed);
      const sparkle = f > 0.55 ? hashNoise(sparkleBase + i) * 0.5 : 0;
      let v = (this.simTilt[i] * (0.35 + wobble * 0.65) + kick * this.simLow[i] + sparkle * f) * barEnergy;
      if (!this.playing) v *= 0.12 + 0.05 * smoothNoise(idle + i * 0.4);
      this.data[i] = clamp(v, 0, 1);
      this.raw[i] = this.data[i];
    }
  }

  get level() {
    let s = 0;
    for (let i = 0; i < BANDS; i++) s += this.smooth[i];
    return s / BANDS;
  }
  get bass() {
    let s = 0;
    for (let i = 0; i < 8; i++) s += this.smooth[i];
    return s / 8;
  }
}

export const audio = new Engine();

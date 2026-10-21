export class Music {
  ctx: AudioContext | null = null;
  buffer: AudioBuffer | null = null;
  source: AudioBufferSourceNode | null = null;
  gain: GainNode | null = null;
  started = 0;
  offset = 0;
  playing = false;
  volume = 0.65;
  async init() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      this.buffer = this.compose(this.ctx);
    }
    await this.ctx.resume();
  }
  compose(ctx: AudioContext) {
    const sr = ctx.sampleRate,
      buffer = ctx.createBuffer(2, sr * 64, sr),
      data = buffer.getChannelData(0);
    let seed = 2781;
    const noise = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 2147483648 - 1;
    };
    const add = (
      time: number,
      len: number,
      fn: (t: number) => number,
      amp: number,
    ) => {
      const start = Math.floor(time * sr),
        count = Math.min(Math.floor(len * sr), data.length - start);
      for (let i = 0; i < count; i++) data[start + i] += fn(i / sr) * amp;
    };
    const chords = [
      [130.81, 155.56, 196],
      [103.83, 130.81, 155.56],
      [155.56, 196, 233.08],
      [116.54, 146.83, 174.61],
    ];
    for (let beat = 0; beat < 128; beat++) {
      const t = beat * 0.5,
        bar = Math.floor(beat / 4),
        chord = chords[Math.floor(bar / 2) % 4];
      add(
        t,
        0.32,
        (u) =>
          Math.sin(2 * Math.PI * (47 * u + 8 * (1 - Math.exp(-u * 32)))) *
          Math.exp(-u * 15),
        0.55,
      );
      if (beat % 2)
        add(
          t,
          0.18,
          (u) =>
            (noise() * 0.65 + Math.sin(u * 2 * Math.PI * 180) * 0.2) *
            Math.exp(-u * 27),
          0.25,
        );
      for (let h = 0; h < 2; h++)
        add(t + h * 0.25, 0.07, (u) => noise() * Math.exp(-u * 80), 0.045);
      const bass = chord[0] / 2;
      add(
        t,
        0.38,
        (u) =>
          (Math.sin(u * 2 * Math.PI * bass) +
            0.25 * Math.sin(u * 4 * Math.PI * bass)) *
          Math.min(1, u * 80) *
          Math.exp(-u * 5),
        0.18,
      );
      if (beat % 4 === 0)
        for (const f of chord)
          add(
            t,
            1.9,
            (u) =>
              Math.sin(2 * Math.PI * f * u) *
              Math.sin((Math.min(1, u * 2) * Math.PI) / 2) *
              Math.exp(-u * 1.8),
            0.035,
          );
      for (let n = 0; n < 2; n++) {
        const f = chord[(beat + n) % 3] * 2;
        add(
          t + n * 0.25,
          0.32,
          (u) =>
            (Math.sin(2 * Math.PI * f * u) +
              0.22 * Math.sin(4 * Math.PI * f * u)) *
            Math.min(1, u * 200) *
            Math.exp(-u * 13),
          0.065,
        );
      }
    }
    for (let i = 0; i < data.length; i++) {
      data[i] =
        Math.tanh(data[i] * 0.9) * Math.min(1, (i / sr) * 2, (64 - i / sr) * 2);
    }
    buffer.getChannelData(1).set(data);
    return buffer;
  }
  get time() {
    return this.playing && this.ctx
      ? this.offset + this.ctx.currentTime - this.started
      : this.offset;
  }
  play(offset = 0, delay = 0) {
    if (!this.ctx || !this.buffer) return;
    this.pause();
    this.offset = offset;
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gain!);
    this.started = this.ctx.currentTime + delay;
    this.source.start(this.started, offset);
    this.playing = true;
  }
  pause() {
    if (this.playing) {
      this.offset = Math.max(0, this.time);
      try {
        this.source?.stop();
      } catch {}
      this.playing = false;
    }
    this.source?.disconnect();
    this.source = null;
  }
  eventTime(perf: number) {
    if (!this.ctx) return 0;
    return this.time - (performance.now() - perf) / 1000;
  }
  hit(quality: string) {
    if (!this.ctx || quality === "Miss" || quality === "Protected") return;
    const osc = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(
      quality === "Perfect" ? 1046 : 783,
      this.ctx.currentTime,
    );
    g.gain.setValueAtTime(0.035, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.09);
    osc.connect(g);
    g.connect(this.gain!);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }
  impact(accent: boolean, targetTime: number, palm = false) {
    if (!this.ctx || !this.playing) return null;
    const at = Math.max(
      this.ctx.currentTime,
      this.started + targetTime - this.offset,
    );
    const osc = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(palm ? 784 : accent ? 196 : 392, at);
    osc.frequency.exponentialRampToValueAtTime(
      palm ? 523.2 : accent ? 65.4 : 261.6,
      at + 0.09,
    );
    g.gain.setValueAtTime(accent ? 0.13 : 0.07, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    osc.connect(g);
    g.connect(this.gain!);
    osc.start(at);
    osc.stop(at + 0.13);
    return this.offset + at - this.started;
  }
  setVolume(v: number) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }
}

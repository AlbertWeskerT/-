export function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export interface SpeechDetectorOptions {
  threshold: number;
  noiseFloor: number;
  attackSamples: number;
  releaseSamples: number;
}

const DEFAULT_SPEECH_OPTIONS: SpeechDetectorOptions = {
  threshold: 0.025,
  noiseFloor: 0.008,
  attackSamples: 2,
  releaseSamples: 6,
};

export class SpeechActivityDetector {
  private speaking = false;
  private aboveCount = 0;
  private belowCount = 0;
  private smoothedLevel = 0;
  private readonly options: SpeechDetectorOptions;

  constructor(options: Partial<SpeechDetectorOptions> = {}) {
    this.options = { ...DEFAULT_SPEECH_OPTIONS, ...options };
  }

  update(rawLevel: number): { level: number; speaking: boolean; changed: boolean } {
    const level = Math.max(0, Math.min(1, rawLevel));
    this.smoothedLevel = this.smoothedLevel * 0.72 + level * 0.28;
    const active = this.smoothedLevel >= Math.max(this.options.threshold, this.options.noiseFloor * 2);
    if (active) {
      this.aboveCount += 1;
      this.belowCount = 0;
    } else {
      this.belowCount += 1;
      this.aboveCount = 0;
    }
    const previous = this.speaking;
    if (!this.speaking && this.aboveCount >= this.options.attackSamples) this.speaking = true;
    if (this.speaking && this.belowCount >= this.options.releaseSamples) this.speaking = false;
    return { level: this.smoothedLevel, speaking: this.speaking, changed: previous !== this.speaking };
  }

  reset(): void {
    this.speaking = false;
    this.aboveCount = 0;
    this.belowCount = 0;
    this.smoothedLevel = 0;
  }
}

export class AudioLevelMonitor {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frameId: number | null = null;
  private readonly detector = new SpeechActivityDetector();

  start(stream: MediaStream, onSample: (level: number, speaking: boolean, changed: boolean) => void): void {
    this.stop();
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.65;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    const samples = new Float32Array(analyser.fftSize);

    const sample = () => {
      if (this.analyser !== analyser) return;
      analyser.getFloatTimeDomainData(samples);
      const result = this.detector.update(calculateRms(samples));
      onSample(Math.min(1, result.level * 8), result.speaking, result.changed);
      this.frameId = requestAnimationFrame(sample);
    };
    sample();
  }

  stop(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    const context = this.context;
    this.source = null;
    this.analyser = null;
    this.context = null;
    this.detector.reset();
    if (context && context.state !== 'closed') {
      void context.close().catch((error: unknown) => console.warn('[media] Could not close AudioContext.', error));
    }
  }

  resetActivity(): void {
    this.detector.reset();
  }
}

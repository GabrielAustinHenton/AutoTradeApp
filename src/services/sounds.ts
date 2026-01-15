// Sound effects using Web Audio API
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export type SoundType = 'buy' | 'sell' | 'notification';

interface SoundConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  volume: number;
  ramp?: 'up' | 'down';
}

const SOUNDS: Record<SoundType, SoundConfig[]> = {
  // Buy signal: ascending happy tone
  buy: [
    { frequency: 523.25, duration: 0.1, type: 'sine', volume: 0.3 }, // C5
    { frequency: 659.25, duration: 0.1, type: 'sine', volume: 0.3 }, // E5
    { frequency: 783.99, duration: 0.15, type: 'sine', volume: 0.3 }, // G5
  ],
  // Sell signal: descending warning tone
  sell: [
    { frequency: 783.99, duration: 0.1, type: 'sine', volume: 0.3 }, // G5
    { frequency: 659.25, duration: 0.1, type: 'sine', volume: 0.3 }, // E5
    { frequency: 523.25, duration: 0.15, type: 'sine', volume: 0.3 }, // C5
  ],
  // General notification: single beep
  notification: [
    { frequency: 880, duration: 0.15, type: 'sine', volume: 0.2 }, // A5
  ],
};

function playTone(config: SoundConfig, startTime: number): void {
  const ctx = getAudioContext();

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = config.type;
  oscillator.frequency.setValueAtTime(config.frequency, startTime);

  // Envelope for smooth sound
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(config.volume, startTime + 0.01);
  gainNode.gain.linearRampToValueAtTime(config.volume, startTime + config.duration - 0.02);
  gainNode.gain.linearRampToValueAtTime(0, startTime + config.duration);

  oscillator.start(startTime);
  oscillator.stop(startTime + config.duration);
}

export function playSound(type: SoundType): void {
  try {
    const ctx = getAudioContext();

    // Resume audio context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const tones = SOUNDS[type];
    let currentTime = ctx.currentTime;

    for (const tone of tones) {
      playTone(tone, currentTime);
      currentTime += tone.duration;
    }
  } catch (error) {
    console.warn('Could not play sound:', error);
  }
}

// Test sound on user interaction (needed for browsers that block autoplay)
export function initializeSounds(): void {
  try {
    getAudioContext();
  } catch (error) {
    console.warn('Could not initialize audio:', error);
  }
}

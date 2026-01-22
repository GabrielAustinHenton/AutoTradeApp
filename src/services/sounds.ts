// Sound effects using HTML5 Audio with base64 encoded WAV files
// This approach works better with Safari's strict autoplay policies

export type SoundType = 'buy' | 'sell' | 'notification';

// Generate a simple beep as a WAV file in base64
function generateBeepDataUrl(frequency: number, duration: number, volume: number = 0.3): string {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * duration);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * blockAlign;
  const fileSize = 36 + dataSize;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, fileSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Generate sine wave samples
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Apply envelope to avoid clicks
    let envelope = 1;
    const attackTime = 0.01;
    const releaseTime = 0.01;
    if (t < attackTime) {
      envelope = t / attackTime;
    } else if (t > duration - releaseTime) {
      envelope = (duration - t) / releaseTime;
    }
    const sample = Math.sin(2 * Math.PI * frequency * t) * volume * envelope;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(44 + i * 2, intSample, true);
  }

  // Convert to base64
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

// Pre-generate sound data URLs
const SOUND_URLS: Record<SoundType, string[]> = {
  buy: [
    generateBeepDataUrl(523.25, 0.12, 0.4), // C5
    generateBeepDataUrl(659.25, 0.12, 0.4), // E5
    generateBeepDataUrl(783.99, 0.15, 0.4), // G5
  ],
  sell: [
    generateBeepDataUrl(783.99, 0.12, 0.4), // G5
    generateBeepDataUrl(659.25, 0.12, 0.4), // E5
    generateBeepDataUrl(523.25, 0.15, 0.4), // C5
  ],
  notification: [
    generateBeepDataUrl(880, 0.2, 0.3), // A5
  ],
};

export async function playSound(type: SoundType): Promise<void> {
  try {
    const urls = SOUND_URLS[type];

    let delay = 0;
    for (const url of urls) {
      setTimeout(() => {
        const audio = new Audio(url);
        audio.volume = 1.0;
        audio.play().catch(() => {});
      }, delay);
      delay += 100; // 100ms between notes
    }
  } catch (error) {
    // Silently fail - sounds are not critical
  }
}

// No-op for compatibility
export function initializeSounds(): void {}

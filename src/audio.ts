// Used for microphone recordings and formats the desktop importer cannot read.
// Decoding straight to a 16 kHz context and downmixing by hand avoids holding a
// full-rate copy plus an OfflineAudioContext render of the whole file in memory.
export async function prepareAudio(blob: Blob) {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 3600)
      throw new Error(
        "Please split recordings longer than one hour before importing.",
      );
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) =>
      decoded.getChannelData(c),
    );
    const length = decoded.length;
    const buffer = new ArrayBuffer(44 + length * 2),
      view = new DataView(buffer, 0, 44),
      pcm = new Int16Array(buffer, 44, length);
    const string = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++)
        view.setUint8(offset + i, value.charCodeAt(i));
    };
    string(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    string(8, "WAVE");
    string(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    string(36, "data");
    view.setUint32(40, length * 2, true);
    const peaks = new Array(240).fill(0);
    for (let i = 0; i < length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      pcm[i] = sample * (sample < 0 ? 32768 : 32767);
      if ((i & 7) === 0) {
        const bucket = Math.min(239, Math.floor((i * 240) / length));
        if (Math.abs(sample) > peaks[bucket]) peaks[bucket] = Math.abs(sample);
      }
    }
    return { buffer, duration: decoded.duration, peaks };
  } finally {
    await context.close();
  }
}
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

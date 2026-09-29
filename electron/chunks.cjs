// Splits a recording for recognition. Cuts land on the quietest 50 ms near each boundary
// so no word is split. Two levels: ~5-minute pieces are the unit of progress, caching and
// resume; each piece is recognized as a batch of ~15-second utterances, because the ASR
// models stop emitting words partway through longer continuous speech (measured on a
// Vietnamese lecture: 153 words from a 5-minute input vs 1,121 from the same audio in
// 15-second pieces).
const fs = require("node:fs/promises");
const path = require("node:path");
const { findData, header, RATE } = require("./importer.cjs");
const CHUNK_SECONDS = 300;
const UTTERANCE_SECONDS = 15;
const WINDOW = RATE / 20;
async function quietestSample(handle, data, around, from, to) {
  const bytes = Buffer.alloc((to - from) * 2);
  await handle.read(bytes, 0, bytes.length, data.offset + from * 2);
  let best = around,
    lowest = Infinity;
  for (let w = 0; w + WINDOW <= to - from; w += WINDOW / 2) {
    let energy = 0;
    for (let i = w; i < w + WINDOW; i++)
      energy += bytes.readInt16LE(i * 2) ** 2;
    if (energy < lowest) {
      lowest = energy;
      best = from + w + WINDOW / 2;
    }
  }
  return best;
}
// Returns [{ start, end }] in samples covering [range.start, range.end) (default: the whole
// recording), cut about every `seconds`, searching ±`search` seconds for a pause.
async function planChunks(
  wavPath,
  { seconds = CHUNK_SECONDS, search = 4, start: first, end: last } = {},
) {
  const handle = await fs.open(wavPath, "r");
  try {
    const data = await findData(handle, (await handle.stat()).size);
    const end = last ?? data.size / 2,
      step = seconds * RATE,
      margin = search * RATE;
    const chunks = [];
    let start = first ?? 0;
    // Let the final piece run up to 20% long rather than leaving a short tail.
    while (end - start > step * 1.2) {
      const around = start + step;
      const cut = await quietestSample(
        handle,
        data,
        around,
        Math.max(start + 1, around - margin),
        Math.min(end, around + margin),
      );
      chunks.push({ start, end: cut });
      start = cut;
    }
    chunks.push({ start, end });
    return chunks;
  } finally {
    await handle.close();
  }
}
async function writeChunk(wavPath, chunk, destination) {
  const input = await fs.open(wavPath, "r");
  try {
    const data = await findData(input, (await input.stat()).size);
    const bytes = Buffer.alloc((chunk.end - chunk.start) * 2);
    await input.read(bytes, 0, bytes.length, data.offset + chunk.start * 2);
    await fs.writeFile(
      destination,
      Buffer.concat([header(bytes.length), bytes]),
    );
  } finally {
    await input.close();
  }
}
// Writes a piece as ~15-second utterance files (u0000.wav, …) into `directory`.
async function writeUtterances(wavPath, chunk, directory) {
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
  const utterances = await planChunks(wavPath, {
    seconds: UTTERANCE_SECONDS,
    search: 3,
    start: chunk.start,
    end: chunk.end,
  });
  const names = [];
  for (const [i, utterance] of utterances.entries()) {
    const name = `u${String(i).padStart(4, "0")}`;
    await writeChunk(wavPath, utterance, path.join(directory, `${name}.wav`));
    names.push({ name, ...utterance });
  }
  return names;
}
module.exports = { planChunks, writeChunk, writeUtterances, CHUNK_SECONDS };

// Converts imported audio to the 16 kHz mono PCM16 WAV the speech engine expects without
// loading it into memory: macOS afconvert streams the decode, then the data chunk is copied
// behind a canonical 44-byte header while waveform peaks are collected.
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const RATE = 16000;
const PEAK_COUNT = 240;
function convert(input, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/afconvert",
      ["-f", "WAVE", "-d", `LEI16@${RATE}`, "-c", "1", input, output],
      { shell: false },
    );
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors = (errors + chunk).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(errors.trim() || `afconvert exited with ${code}`)),
    );
  });
}
function header(dataBytes) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}
async function findData(handle, fileSize) {
  const { buffer, bytesRead } = await handle.read(
    Buffer.alloc(65536),
    0,
    65536,
    0,
  );
  const b = buffer.subarray(0, bytesRead);
  if (
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Converted audio is not a WAV file.");
  let format = null;
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString("ascii", i, i + 4),
      size = b.readUInt32LE(i + 4);
    if (id === "fmt ")
      format = {
        pcm: b.readUInt16LE(i + 8) === 1,
        channels: b.readUInt16LE(i + 10),
        rate: b.readUInt32LE(i + 12),
        bits: b.readUInt16LE(i + 22),
      };
    if (id === "data") {
      if (
        !format?.pcm ||
        format.channels !== 1 ||
        format.rate !== RATE ||
        format.bits !== 16
      )
        throw new Error("Converted audio has an unexpected format.");
      const offset = i + 8;
      return { offset, size: Math.min(size, fileSize - offset) & ~1 };
    }
    i += 8 + size + (size & 1);
  }
  throw new Error("Converted audio has no data.");
}
async function canonicalize(source, destination) {
  const input = await fs.open(source, "r");
  const output = await fs.open(destination, "w");
  try {
    const { offset, size } = await findData(input, (await input.stat()).size);
    const samples = size / 2;
    const peaks = new Array(PEAK_COUNT).fill(0);
    await output.write(header(size), 0, 44, 0);
    const chunk = Buffer.alloc(1 << 20);
    for (let done = 0; done < size;) {
      const { bytesRead } = await input.read(
        chunk,
        0,
        Math.min(chunk.length, size - done),
        offset + done,
      );
      if (!bytesRead) break;
      for (let j = 0; j < bytesRead; j += 16) {
        const index = done / 2 + j / 2,
          bucket = Math.min(
            PEAK_COUNT - 1,
            Math.floor((index * PEAK_COUNT) / samples),
          ),
          value = Math.abs(chunk.readInt16LE(j)) / 32768;
        if (value > peaks[bucket]) peaks[bucket] = value;
      }
      await output.write(chunk, 0, bytesRead, 44 + done);
      done += bytesRead;
    }
    await output.sync();
    return { duration: samples / RATE, peaks };
  } finally {
    await input.close();
    await output.close();
  }
}
// Returns null when afconvert cannot read the format (e.g. WebM/Ogg), so the caller can fall back.
async function importAudio(sourcePath, destination) {
  const converted = destination + ".convert.wav",
    staged = destination + ".stage.wav";
  try {
    try {
      await convert(sourcePath, converted);
    } catch {
      return null;
    }
    const result = await canonicalize(converted, staged);
    await fs.rename(staged, destination);
    return result;
  } finally {
    await fs.rm(converted, { force: true });
    await fs.rm(staged, { force: true });
  }
}
module.exports = { importAudio, canonicalize, findData, header, RATE };

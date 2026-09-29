const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { canonicalize } = require("../electron/importer.cjs");
test("rewrites afconvert-style WAV (with FLLR padding) to a 44-byte header and collects peaks", async () => {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "voices-"),
  );
  const samples = new Int16Array(16000).map((_, i) => (i === 8000 ? 16384 : 0));
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(16000, 12);
  fmt.writeUInt32LE(32000, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const fllr = Buffer.alloc(8 + 100);
  fllr.write("FLLR", 0);
  fllr.writeUInt32LE(100, 4);
  const dataHead = Buffer.alloc(8);
  dataHead.write("data", 0);
  dataHead.writeUInt32LE(samples.byteLength, 4);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0);
  riff.write("WAVE", 8);
  const source = path.join(dir, "in.wav"),
    output = path.join(dir, "out.wav");
  fs.writeFileSync(
    source,
    Buffer.concat([riff, fmt, fllr, dataHead, Buffer.from(samples.buffer)]),
  );
  try {
    const { duration, peaks } = await canonicalize(source, output);
    const written = fs.readFileSync(output);
    assert.equal(duration, 1);
    assert.equal(peaks.length, 240);
    assert.equal(Math.max(...peaks), 0.5);
    assert.equal(written.length, 44 + samples.byteLength);
    assert.equal(written.toString("ascii", 36, 40), "data");
    assert.deepEqual(written.subarray(44), Buffer.from(samples.buffer));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { header } = require("../electron/importer.cjs");
const {
  planChunks,
  writeChunk,
  writeUtterances,
} = require("../electron/chunks.cjs");
test("cuts long audio near 5-minute marks at silence and covers every sample", async () => {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), "voices-"),
  );
  const rate = 16000,
    samples = new Int16Array(rate * 60 * 12);
  // Constant tone everywhere except a short silence 2 s after each 5-minute mark.
  for (let i = 0; i < samples.length; i++) samples[i] = i % 2 ? 3000 : -3000;
  for (const minute of [5, 10])
    samples.fill(0, (minute * 60 + 2) * rate, (minute * 60 + 2.2) * rate);
  const source = path.join(dir, "long.wav");
  fs.writeFileSync(
    source,
    Buffer.concat([header(samples.byteLength), Buffer.from(samples.buffer)]),
  );
  try {
    const chunks = await planChunks(source);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].start, 0);
    assert.equal(chunks.at(-1).end, samples.length);
    for (let i = 1; i < chunks.length; i++)
      assert.equal(chunks[i].start, chunks[i - 1].end);
    for (const [i, minute] of [5, 10].entries()) {
      const cut = chunks[i].end / rate;
      assert.ok(
        cut > minute * 60 + 2 && cut < minute * 60 + 2.2,
        `cut ${cut} is in the silence`,
      );
    }
    const utterances = await writeUtterances(
      source,
      chunks[1],
      path.join(dir, "u"),
    );
    assert.equal(utterances[0].start, chunks[1].start);
    assert.equal(utterances.at(-1).end, chunks[1].end);
    for (const u of utterances) {
      const seconds = (u.end - u.start) / rate;
      assert.ok(seconds >= 11 && seconds <= 18.1, `utterance ${seconds}s`);
      assert.ok(fs.existsSync(path.join(dir, "u", `${u.name}.wav`)));
    }
    const piece = path.join(dir, "piece.wav");
    await writeChunk(source, chunks[1], piece);
    assert.equal(
      fs.statSync(piece).size,
      44 + (chunks[1].end - chunks[1].start) * 2,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

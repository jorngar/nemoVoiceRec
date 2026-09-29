const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeTranscript,
  parseRTTM,
} = require("../electron/transcript.cjs");
test("preserves overlapping speech as uncertain and keeps silence unassigned", () => {
  const activity = parseRTTM(
    "SPEAKER meeting 1 0.000 2.000 <NA> <NA> speaker_1 <NA> <NA>\nSPEAKER meeting 1 1.000 2.000 <NA> <NA> speaker_2 <NA> <NA>",
  );
  const turns = normalizeTranscript(
    {
      words: [
        { word: "Hello", start: 0, end: 0.5 },
        { word: "both", start: 1.2, end: 1.8 },
        { word: "again", start: 2.2, end: 2.8 },
        { word: "unclear", start: 4, end: 4.5 },
      ],
    },
    activity,
  );
  assert.deepEqual(
    turns.map((t) => t.speaker),
    ["speaker_1", "overlap", "speaker_2", "unknown"],
  );
});
test("groups adjacent words, preserves punctuation, splits on speaker change and long pause", () => {
  const turns = normalizeTranscript({
    words: [
      { word: "Hello", start: 0, end: 0.2, speaker: 1 },
      { word: ",", start: 0.2, end: 0.3, speaker: 1 },
      { word: "world", start: 0.3, end: 0.7, speaker: 1 },
      { word: "Hi", start: 1, end: 2, speaker: 2 },
      { word: "Later", start: 5, end: 6, speaker: 2 },
    ],
  });
  assert.equal(turns.length, 3);
  assert.equal(turns[0].text, "Hello, world");
  assert.equal(turns[1].speaker, "speaker_2");
});
test("ignores malformed words and rejects an unsupported engine response", () => {
  assert.deepEqual(
    normalizeTranscript({
      words: [{ word: "oops", start: "invalid", end: 1 }],
    }),
    [],
  );
  assert.throws(() => normalizeTranscript({ text: "Hello" }), /unsupported/);
});

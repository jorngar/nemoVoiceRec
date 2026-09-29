const { test } = require("node:test");
const assert = require("node:assert/strict");
const { recognizer, validLanguage } = require("../electron/language.cjs");
test("routes European languages to Parakeet and others to Nemotron 3.5 with the language set", () => {
  assert.deepEqual(recognizer("en-US"), ["--model", "parakeet-tdt"]);
  assert.deepEqual(recognizer("de-DE"), ["--model", "parakeet-tdt"]);
  assert.deepEqual(recognizer("vi-VN"), [
    "--model",
    "nemotron-3.5",
    "--language",
    "vi-VN",
  ]);
  assert.deepEqual(recognizer("ja-JP"), [
    "--model",
    "nemotron-3.5",
    "--language",
    "ja-JP",
  ]);
  assert.deepEqual(recognizer("auto"), [
    "--model",
    "nemotron-3.5",
    "--language",
    "auto",
  ]);
  assert.ok(validLanguage("vi-VN") && validLanguage("auto"));
  assert.ok(!validLanguage("xx-XX") && !validLanguage("--model"));
});

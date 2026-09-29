import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
const packaged = process.argv.includes("--packaged");
const app = await electron.launch({
  ...(packaged
    ? {
        executablePath: path.resolve(
          "release/mac-arm64/Voices.app/Contents/MacOS/Voices",
        ),
        args: [],
      }
    : { args: [".", "--production"] }),
  env: {
    ...process.env,
    VOICES_DATA_DIR: path.resolve(".runtime/electron-smoke"),
  },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "Import audio", exact: true })
    .first()
    .waitFor();
  assert.equal(await page.evaluate(() => typeof window.voices), "object");
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  await page
    .locator("input[type=file]")
    .setInputFiles(".runtime/nemo-source/test_files/diar/ami_en2002d_2132.wav");
  await page
    .getByRole("heading", { name: "ami_en2002d_2132", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Transcribe recording", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Transcribe again", exact: true })
    .waitFor({ timeout: 180000 });
  const recordings = await page.evaluate(() => window.voices.list());
  const item = recordings.find((r) => r.id === recordings[0].id);
  assert.ok(item.transcribed);
  assert.ok(item.turns.length > 0);
  assert.ok(Object.keys(item.speakers).length >= 2);
  await page.getByRole("button", { name: /Speakers \d/ }).click();
  const firstName = page.getByRole("textbox", {
    name: "Name for speaker 1",
    exact: true,
  });
  await firstName.fill("Participant A");
  await firstName.blur();
  await page.getByRole("button", { name: "Transcript", exact: true }).click();
  await page
    .getByRole("button", { name: "Participant A", exact: true })
    .waitFor();
  await page.screenshot({
    path: packaged
      ? "test-results/voices-packaged.png"
      : "test-results/voices-desktop.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      packaged,
      words: item.turns.length,
      speakers: Object.keys(item.speakers),
      rendererErrors: errors,
    }),
  );
} finally {
  await app.close();
}

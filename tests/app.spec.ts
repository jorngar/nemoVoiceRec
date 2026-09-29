import { test, expect } from "@playwright/test";
function wav() {
  const samples = 32000;
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF");
  b.writeUInt32LE(36 + samples * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    b.writeInt16LE(
      Math.sin((i * 440 * 2 * Math.PI) / 16000) * 3000,
      44 + i * 2,
    );
  return b;
}
test("sample clearly marked, speaker filtering and transcript search work", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore a sample transcript" })
    .click();
  await expect(
    page.getByText("SAMPLE TRANSCRIPT · ILLUSTRATIVE CONTENT"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play recording", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Jamie", exact: true }).click();
  await expect(page.locator(".transcript-turn")).toHaveCount(2);
  await page.getByRole("button", { name: "All speakers", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Find in transcript" })
    .fill("same time");
  await expect(page.locator(".transcript-turn")).toHaveCount(1);
  await expect(page.getByText("Attribution uncertain")).toBeVisible();
  await page.getByRole("textbox", { name: "Find in transcript" }).fill("");
  await page.screenshot({ path: "test-results/voices-transcript.png" });
});
test("import, play, rename, favorite, delete, restore and persistence", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Interview.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await expect(
    page.getByRole("heading", { name: "Interview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.getByTitle("Rename recording").click();
  await page
    .getByRole("textbox", { name: "Recording title" })
    .fill("First interview");
  await page.getByRole("textbox", { name: "Recording title" }).press("Enter");
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await expect(
    page.getByRole("button", { name: "Remove from favorites" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "First interview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete recording", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recently deleted", exact: true })
    .click();
  await expect(page.locator(".recording-item")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Restore recording", exact: true })
    .click();
  await expect(page.locator(".recording-item")).toHaveCount(0);
});
test("records microphone input, pauses, resumes, saves and plays", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start a recording", exact: true })
    .click();
  await expect(page.getByText("LISTENING TO YOUR MICROPHONE")).toBeVisible();
  await expect(page.locator(".capture-time")).toContainText("00:02", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("RECORDING PAUSED")).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByText("LISTENING TO YOUR MICROPHONE")).toBeVisible();
  await page.getByRole("button", { name: "Stop & save", exact: true }).click();
  await expect(page.getByTitle("Rename recording")).toContainText(
    "New recording",
  );
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();
});
test("copy transcript and right-click menu", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Explore a sample transcript" })
    .click();
  await page
    .getByRole("button", { name: "Copy transcript", exact: true })
    .click();
  await expect(page.getByText("Transcript copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Speakers:");
  expect(copied).toMatch(/\[\d\d:\d\d\] \S/);
  await page.getByRole("button", { name: /Close sample/ }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "Standup.wav",
      mimeType: "audio/wav",
      buffer: wav(),
    });
  await expect(
    page.getByRole("heading", { name: "Standup", exact: true }),
  ).toBeVisible();
  await page.locator(".recording-item").first().click({ button: "right" });
  // Not transcribed yet: no transcript actions, but the general ones are there.
  await expect(
    page.getByRole("menuitem", { name: "Copy transcript" }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Add to favorites" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page.locator(".recording-item").first().locator("svg"),
  ).toHaveCount(1);
});

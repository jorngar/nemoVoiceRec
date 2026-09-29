const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  systemPreferences,
  Menu,
  protocol,
  powerMonitor,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnBackground } = require("./background.cjs");
const { Readable } = require("node:stream");
const { normalizeTranscript, parseRTTM } = require("./transcript.cjs");
const { importAudio, RATE } = require("./importer.cjs");
const { planChunks, writeUtterances } = require("./chunks.cjs");
const { LANGUAGES, validLanguage, recognizer } = require("./language.cjs");
const { buildPrompt, runHermes, defaultHermes } = require("./summary.cjs");
// Recordings stream from disk (with Range support for seeking) instead of crossing IPC.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "voices-audio",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);
const dev = !app.isPackaged && !process.argv.includes("--production");
// Library location: VOICES_DATA_DIR, else "dataDirectory" from location.json in the OS app-data
// folder (e.g. ~/Library/Application Support/Voices/location.json), else that folder itself.
// location.json lets a machine keep recordings and models on another drive without env vars:
//   { "dataDirectory": "/path/to/Voices", "modelDirectory": "/path/to/models" }
const location = (() => {
  try {
    return JSON.parse(
      require("node:fs").readFileSync(
        path.join(app.getPath("userData"), "location.json"),
        "utf8",
      ),
    );
  } catch {
    return {};
  }
})();
const dataDirectory =
  process.env.VOICES_DATA_DIR ||
  location.dataDirectory ||
  app.getPath("userData");
// Never silently recreate a library on the internal disk when its drive is disconnected.
if (!require("node:fs").existsSync(path.dirname(dataDirectory))) {
  dialog.showErrorBox(
    "Your Voices library isn't available",
    `Voices keeps recordings in ${dataDirectory}. Connect the drive that holds it and open Voices again.`,
  );
  app.exit(1);
}
require("node:fs").mkdirSync(dataDirectory, { recursive: true });
app.setPath("userData", dataDirectory);
app.setPath("sessionData", path.join(dataDirectory, "session"));
process.env.NEMO_SPEECH_MODEL_DIR ||=
  location.modelDirectory ||
  (app.isPackaged
    ? path.join(dataDirectory, "models")
    : path.resolve(".runtime/model-cache/models"));
let summaryProcess = null,
  summaryCancelled = false;
let win,
  activeProcess,
  busy = false,
  recording = false,
  cancelled = false;
const root = () => path.join(app.getPath("userData"), "recordings");
const validateId = (id) => {
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
    throw new Error("Invalid recording");
  return id;
};
const file = (id, ext) => path.join(root(), `${validateId(id)}.${ext}`);
const defaults = () => ({
  enginePath:
    process.env.VOICES_ENGINE ||
    (app.isPackaged
      ? path.join(process.resourcesPath, "speech/bin/nemo-speech")
      : path.resolve(".runtime/nemo-v3/bin/nemo-speech")),
  modelPath:
    process.env.VOICES_MODEL ||
    (app.isPackaged
      ? path.join(
          process.resourcesPath,
          "models/Nemotron-3-Diarization.q8_0.gguf",
        )
      : path.resolve(".runtime/models/Nemotron-3-Diarization.q8_0.gguf")),
  language: "auto",
  hermesPath: defaultHermes(),
  summaryLanguage: systemSummaryLanguage(),
});
// Default summary language: the Mac's preferred language when it is one we list.
function systemSummaryLanguage() {
  const preferred = app.getPreferredSystemLanguages?.()[0] || "en-US";
  return (
    LANGUAGES.find((code) => code === preferred) ||
    LANGUAGES.find((code) => code.split("-")[0] === preferred.split("-")[0]) ||
    "en-US"
  );
}
async function settings() {
  try {
    return {
      ...defaults(),
      ...JSON.parse(
        await fs.readFile(
          path.join(app.getPath("userData"), "settings.json"),
          "utf8",
        ),
      ),
    };
  } catch {
    return defaults();
  }
}
async function atomicWrite(destination, data) {
  const temp = destination + "." + require("node:crypto").randomUUID() + ".tmp";
  await fs.writeFile(temp, data);
  await fs.rename(temp, destination);
}
async function metadata(id) {
  return JSON.parse(await fs.readFile(file(id, "json"), "utf8"));
}
// The Mac's own thermal signal decides when to pause. "serious" is when macOS itself starts
// throttling; the engine waits (stopped, not killed) until the state drops again.
const tooHot = () =>
  process.platform === "darwin" &&
  ["serious", "critical"].includes(powerMonitor.getCurrentThermalState());
let paused = false,
  stage = "";
function onThermalChange() {
  if (!activeProcess) return;
  if (tooHot() && !paused) {
    paused = true;
    activeProcess.kill("SIGSTOP");
    win?.webContents.send("engine:progress", {
      message: "Pausing so your Mac can cool down…",
    });
  } else if (!tooHot() && paused) {
    paused = false;
    activeProcess.kill("SIGCONT");
    win?.webContents.send("engine:progress", { message: stage });
  }
}
async function coolDown() {
  while (tooHot() && !cancelled) {
    win?.webContents.send("engine:progress", {
      message: "Pausing so your Mac can cool down…",
    });
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
}
function stopEngine() {
  cancelled = true;
  activeProcess?.kill("SIGTERM");
  if (paused) activeProcess?.kill("SIGCONT");
}
// Runs nemo-speech at macOS background priority (efficiency cores, throttled I/O), the class
// Spotlight and Time Machine use. The timeout only counts time the engine was not paused.
function runEngine(binary, args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    // A cancel that arrives between engine runs must not start the next one.
    if (cancelled) return reject(new Error("Transcription cancelled."));
    const child = spawnBackground(binary, args, {
      shell: false,
      env: { ...process.env, NO_COLOR: "1" },
    });
    activeProcess = child;
    paused = false;
    onThermalChange();
    let output = "",
      errors = "",
      running = 0;
    const timer = setInterval(() => {
      if (!paused && (running += 5000) > timeoutMs) child.kill("SIGTERM");
    }, 5000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 25e6) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      errors = (errors + chunk).slice(-8000);
    });
    child.on("error", (error) => {
      clearInterval(timer);
      activeProcess = null;
      reject(error);
    });
    child.on("close", (code) => {
      clearInterval(timer);
      activeProcess = null;
      paused = false;
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              code === null || cancelled
                ? "Transcription cancelled."
                : errors.slice(-2000) ||
                    "Speech engine failed. Check your model and runtime in Settings.",
            ),
          );
    });
  });
}
// Recognizes one piece as a batch of ~15-second utterances (one model load per batch) and
// returns its words on the recording's timeline plus any languages the model reported.
async function recognize(enginePath, source, chunk, args, directory) {
  const utterances = await writeUtterances(source, chunk, directory);
  const out = path.join(directory, "out");
  await runEngine(enginePath, [
    "transcribe",
    directory,
    ...args,
    // Warm-up only helps live streaming latency; skipping it halves start-up for
    // batch runs (Nemotron 3.5: 43 s → 22 s, identical output).
    "--no-warmup",
    "--format",
    "json",
    "--output-dir",
    out,
  ]);
  const words = [],
    languages = [];
  for (const utterance of utterances) {
    const result = await readJSON(path.join(out, `${utterance.name}.json`));
    if (!Array.isArray(result.words))
      throw new Error(
        "The speech engine returned an unsupported transcript format. Update NeMo-Speech.cpp.",
      );
    languages.push(...(result.languages || []));
    const offset = utterance.start / RATE;
    for (const w of result.words)
      words.push({
        ...w,
        start: Number(w.start) + offset,
        end: Number(w.end) + offset,
      });
  }
  return { words, languages };
}
const readJSON = async (target) =>
  JSON.parse(await fs.readFile(target, "utf8"));
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Untrusted sender");
    return fn(...args);
  });
}
app.whenReady().then(async () => {
  await fs.mkdir(root(), { recursive: true });
  win = new BrowserWindow({
    width: 1260,
    height: 850,
    minWidth: 840,
    minHeight: 630,
    title: "Voices",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 21 },
    backgroundColor: "#f8f8f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const trusted = (contents) => contents === win.webContents;
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        trusted(contents) &&
          permission === "media" &&
          !details.mediaTypes?.includes("video"),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission) => trusted(contents) && permission === "media",
  );
  protocol.handle("voices-audio", async (request) => {
    try {
      const target = file(new URL(request.url).pathname.slice(1), "wav");
      const size = (await fs.stat(target)).size;
      const range = /^bytes=(\d*)-(\d*)$/.exec(
        request.headers.get("range") || "",
      );
      let start = 0,
        end = size - 1;
      if (range && (range[1] || range[2])) {
        if (range[1]) {
          start = Number(range[1]);
          if (range[2]) end = Math.min(end, Number(range[2]));
        } else start = Math.max(0, size - Number(range[2]));
        if (start > end || start >= size)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
      }
      const body = Readable.toWeb(
        require("node:fs").createReadStream(target, { start, end }),
      );
      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          "Content-Type": "audio/wav",
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          ...(range
            ? { "Content-Range": `bytes ${start}-${end}/${size}` }
            : {}),
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("close", (event) => {
    if (recording || busy) {
      const answer = dialog.showMessageBoxSync(win, {
        type: "warning",
        buttons: ["Keep Voices open", "Quit"],
        defaultId: 0,
        cancelId: 0,
        message: recording
          ? "A recording is in progress."
          : "Transcription is in progress.",
        detail: recording
          ? "Stop and save your recording before quitting to keep it."
          : "Quitting will cancel transcription. Your saved audio is safe.",
      });
      if (answer === 0) event.preventDefault();
    }
  });
  handle("recordings:list", async () => {
    const names = await fs.readdir(root());
    const items = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(async (n) => {
          try {
            return JSON.parse(await fs.readFile(path.join(root(), n), "utf8"));
          } catch {
            return null;
          }
        }),
    );
    return items
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  handle("recordings:save", async (item, audio) => {
    validateId(item.id);
    if (!audio || audio.byteLength > 150e6)
      throw new Error("Recording must be smaller than 150 MB.");
    await atomicWrite(file(item.id, "wav"), Buffer.from(audio));
    await atomicWrite(file(item.id, "json"), JSON.stringify(item));
    return item;
  });
  handle("recordings:import", async (sourcePath, title) => {
    if (process.platform !== "darwin") return null;
    if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath))
      throw new Error("Invalid file");
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) throw new Error("Invalid file");
    if (stat.size > 2e9)
      throw new Error("Please choose an audio file smaller than 2 GB.");
    const id = require("node:crypto").randomUUID();
    const prepared = await importAudio(sourcePath, file(id, "wav"));
    if (!prepared) return null;
    const reject = (message) =>
      fs.rm(file(id, "wav"), { force: true }).then(() => {
        throw new Error(message);
      });
    if (prepared.duration > 8 * 3600)
      await reject(
        "Please split recordings longer than eight hours before importing.",
      );
    if (prepared.duration < 0.2)
      await reject("Record a little longer before saving.");
    const item = {
      id,
      title: String(title || "Imported audio").slice(0, 200),
      createdAt: new Date().toISOString(),
      duration: prepared.duration,
      peaks: prepared.peaks,
      favorite: false,
      deleted: false,
      turns: [],
      speakers: {},
    };
    await atomicWrite(file(id, "json"), JSON.stringify(item));
    return item;
  });
  handle("recordings:update", async (id, changes) => {
    const item = await metadata(id);
    for (const key of ["title", "favorite", "deleted", "speakers", "turns"])
      if (key in changes) item[key] = changes[key];
    await atomicWrite(file(id, "json"), JSON.stringify(item));
    return item;
  });
  handle(
    "recordings:audio",
    async (id) => new Uint8Array(await fs.readFile(file(id, "wav"))),
  );
  handle("recordings:export", async (id, kind, text) => {
    const item = await metadata(id);
    if (!["wav", "txt", "json", "md"].includes(kind))
      throw new Error("Invalid export");
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${item.title.replace(/[/\\:]/g, "-")}.${kind}`,
    });
    if (result.canceled) return false;
    if (kind === "wav") await fs.copyFile(file(id, "wav"), result.filePath);
    else await fs.writeFile(result.filePath, String(text));
    return true;
  });
  handle("settings:get", settings);
  handle("settings:language", async (language) => {
    if (!validLanguage(language)) throw new Error("Invalid language");
    const next = { ...(await settings()), language };
    await atomicWrite(
      path.join(app.getPath("userData"), "settings.json"),
      JSON.stringify(next),
    );
    return next;
  });
  handle("settings:languages", () => LANGUAGES);
  handle("settings:summaryLanguage", async (summaryLanguage) => {
    if (summaryLanguage !== "original" && !LANGUAGES.includes(summaryLanguage))
      throw new Error("Invalid language");
    const next = { ...(await settings()), summaryLanguage };
    await atomicWrite(
      path.join(app.getPath("userData"), "settings.json"),
      JSON.stringify(next),
    );
    return next;
  });
  // Speaker-aware summary by the user's Hermes agent. Only transcript text is sent,
  // to whichever model Hermes is configured to use.
  handle("summary:create", async (id) => {
    if (summaryProcess) throw new Error("A summary is already being written.");
    const s = await settings();
    const item = await metadata(id);
    if (!item.transcribed || !item.turns?.length)
      throw new Error("Transcribe this recording before summarising it.");
    await fs.access(s.hermesPath, 1).catch(() => {
      throw new Error(
        `Hermes wasn't found at ${s.hermesPath}. Choose it in Settings.`,
      );
    });
    summaryCancelled = false;
    try {
      const text = await runHermes(
        s.hermesPath,
        buildPrompt(item, s.summaryLanguage),
        path.join(
          app.getPath("userData"),
          "cache",
          `summary-${validateId(id)}`,
        ),
        (child) => (summaryProcess = child),
      );
      if (summaryCancelled) throw new Error("Summary cancelled.");
      // Re-read so edits made while Hermes was working (names, title) are kept.
      const latest = await metadata(id);
      latest.summary = {
        text,
        language: s.summaryLanguage,
        createdAt: new Date().toISOString(),
        speakers: item.speakers,
      };
      await atomicWrite(file(id, "json"), JSON.stringify(latest));
      return latest;
    } finally {
      summaryProcess = null;
    }
  });
  handle("summary:cancel", () => {
    summaryCancelled = true;
    summaryProcess?.kill("SIGTERM");
  });
  handle("settings:pick", async (key) => {
    if (!["enginePath", "modelPath", "hermesPath"].includes(key))
      throw new Error("Invalid setting");
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      ...(key === "modelPath"
        ? { filters: [{ name: "GGUF model", extensions: ["gguf"] }] }
        : {}),
    });
    if (result.canceled) return null;
    const next = { ...(await settings()), [key]: result.filePaths[0] };
    await atomicWrite(
      path.join(app.getPath("userData"), "settings.json"),
      JSON.stringify(next),
    );
    return next;
  });
  handle("engine:status", async () => {
    const s = await settings();
    try {
      await fs.access(s.enginePath, 1);
      await fs.access(s.modelPath);
      return { ready: true };
    } catch {
      return { ready: false };
    }
  });
  // Speech is recognized in ~5-minute pieces (Parakeet attends over its whole input, so one
  // pass over hours of audio is what overheats the Mac). Text is sent to the window as each
  // piece finishes, and finished pieces are cached so a cancelled run resumes where it stopped.
  // Speakers are identified in one streaming pass so labels stay consistent across the file.
  handle("engine:transcribe", async (id) => {
    if (busy) throw new Error("A transcription is already running.");
    busy = true;
    cancelled = false;
    const source = file(id, "wav"),
      cache = path.join(app.getPath("userData"), "cache", validateId(id));
    const report = (update) => {
      stage = update.message;
      win.webContents.send("engine:progress", { id, ...update });
    };
    try {
      const s = await settings();
      await fs.access(s.enginePath, 1).catch(() => {
        throw new Error(
          "Speech engine not found. Choose nemo-speech in Settings.",
        );
      });
      await fs.access(s.modelPath).catch(() => {
        throw new Error(
          "Choose the Nemotron 3 Diarization GGUF model in Settings.",
        );
      });
      await fs.mkdir(cache, { recursive: true });
      const chunks = await planChunks(source);
      // Automatic: identify the language once from 45 s of speech, then pass it
      // explicitly to every piece (per-piece detection drops words and can flip languages).
      let language = validLanguage(s.language) ? s.language : "auto";
      const detected = language === "auto";
      if (detected) {
        const saved = path.join(cache, "language.json");
        language = (await readJSON(saved).catch(() => null))?.language;
        if (!language) {
          await coolDown();
          if (cancelled) throw new Error("Transcription cancelled.");
          report({
            message: "Detecting language…",
            done: 0,
            total: chunks.at(-1).end / RATE,
          });
          const first = chunks[0],
            length = Math.min(45 * RATE, first.end - first.start),
            start =
              first.start + Math.floor((first.end - first.start - length) / 2);
          const { languages } = await recognize(
            s.enginePath,
            source,
            { start, end: start + length },
            ["--model", "nemotron-3.5", "--language", "auto"],
            path.join(cache, "piece"),
          );
          const votes = {};
          for (const code of languages) votes[code] = (votes[code] || 0) + 1;
          const winner = Object.keys(votes).sort(
            (x, y) => votes[y] - votes[x],
          )[0];
          language = validLanguage(winner) ? winner : "auto";
          await atomicWrite(saved, JSON.stringify({ language }));
        }
      }
      const total = chunks.at(-1).end / RATE;
      const words = [];
      for (const chunk of chunks) {
        await coolDown();
        if (cancelled) throw new Error("Transcription cancelled.");
        const saved = path.join(
          cache,
          `asr2-${language}-${chunk.start}-${chunk.end}.json`,
        );
        let piece = await readJSON(saved).catch(() => null);
        if (!piece) {
          report({ message: "Transcribing…", done: chunk.start / RATE, total });
          piece = (
            await recognize(
              s.enginePath,
              source,
              chunk,
              recognizer(language),
              path.join(cache, "piece"),
            )
          ).words;
          await atomicWrite(saved, JSON.stringify(piece));
        }
        words.push(...piece);
        report({
          message: "Transcribing…",
          done: chunk.end / RATE,
          total,
          turns: normalizeTranscript({ words }, []),
        });
      }
      await coolDown();
      if (cancelled) throw new Error("Transcription cancelled.");
      report({ message: "Identifying speakers…", done: total, total });
      const rttm = await runEngine(
        s.enginePath,
        ["diarize", source, "--model", s.modelPath, "--format", "rttm"],
        Math.max(30 * 60, total) * 1000,
      );
      const activity = parseRTTM(rttm);
      const turns = normalizeTranscript({ words }, activity);
      const item = await metadata(id);
      item.turns = turns;
      item.activity = activity;
      item.transcribed = true;
      item.language = language === "auto" ? undefined : language;
      item.languageDetected = detected;
      item.speakers = item.speakers || {};
      for (const t of turns)
        if (!item.speakers[t.speaker])
          item.speakers[t.speaker] =
            t.speaker === "overlap"
              ? "Overlapping voices"
              : t.speaker === "unknown"
                ? "Unassigned"
                : `Speaker ${t.speaker.replace("speaker_", "")}`;
      await atomicWrite(file(id, "json"), JSON.stringify(item));
      await fs.rm(cache, { recursive: true, force: true });
      return item;
    } finally {
      busy = false;
      await fs.rm(path.join(cache, "piece"), { recursive: true, force: true });
    }
  });
  handle("engine:cancel", stopEngine);
  powerMonitor.on("thermal-state-change", onThermalChange);
  handle("recording:state", (value) => {
    recording = !!value;
  });
  handle(
    "microphone:request",
    async () =>
      process.platform !== "darwin" ||
      (await systemPreferences.askForMediaAccess("microphone")),
  );
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: "Voices",
              submenu: [
                { role: "about" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : [{ role: "fileMenu" }]),
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  await (dev
    ? win.loadURL("http://127.0.0.1:5173")
    : win.loadFile(path.join(__dirname, "../dist/index.html")));
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  stopEngine();
  summaryProcess?.kill("SIGTERM");
});

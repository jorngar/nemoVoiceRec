import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AudioLines,
  Search,
  Plus,
  Star,
  Trash2,
  Settings2,
  Upload,
  Mic,
  Play,
  Pause,
  Square,
  RotateCcw,
  RotateCw,
  ChevronDown,
  Download,
  Check,
  X,
  Users,
  FileText,
  ArrowUpRight,
  Headphones,
  LoaderCircle,
  Folder,
  ShieldCheck,
  Sparkles,
  Copy,
  FileDown,
} from "lucide-react";
import type { MenuAction, Progress, Recording, Settings, Turn } from "./types";
import { api } from "./storage";
import { prepareAudio, clock } from "./audio";
import { demo } from "./demo";
import {
  fileName,
  languageName,
  speakerColor,
  transcriptDocx,
  transcriptText,
} from "./transcript";
// Electron prefixes errors thrown in the main process; show only the message itself.
const readableError = (message: string) =>
  message.replace(/(Error invoking remote method '[^']+': )?(Error: )+/g, "");
const stamp = (date: string) =>
  new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
// Bars are memoized; playback progress only moves a clip rect over a second copy,
// so time updates don't rebuild hundreds of SVG nodes.
const Waveform = memo(function Waveform({
  peaks,
  turns,
  duration,
  current,
  onSeek,
  live = false,
}: {
  peaks: number[];
  turns: Turn[];
  duration: number;
  current: number;
  onSeek?: (n: number) => void;
  live?: boolean;
}) {
  const clipId = useId();
  const bars = useMemo(() => {
    const peakScale = live ? 1 : 1 / Math.max(0.001, ...peaks);
    return peaks.map((value, i) => {
      const time = (i / peaks.length) * duration;
      const turn = live
        ? undefined
        : turns.find((t) => t.start <= time && t.end >= time);
      return (
        <rect
          key={i}
          x={(i / peaks.length) * 1000}
          y={60 - Math.max(2, value * peakScale * 49)}
          width="2.4"
          height={Math.max(4, value * peakScale * 98)}
          rx="1.2"
          fill={
            live ? "#d64e46" : turn ? speakerColor(turn.speaker) : "#b9b7b1"
          }
        />
      );
    });
  }, [peaks, turns, duration, live]);
  const playhead = (current / Math.max(duration, 1)) * 1000;
  return (
    <div className={`waveform ${live ? "live" : ""}`}>
      <svg
        viewBox="0 0 1000 120"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          live ? "Live microphone level" : "Audio waveform with speaker colors"
        }
      >
        <line x1="0" y1="60" x2="1000" y2="60" stroke="#e8e5e0" />
        {live ? (
          bars
        ) : (
          <>
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width={playhead} height="120" />
              </clipPath>
            </defs>
            <g opacity={0.65}>{bars}</g>
            <g clipPath={`url(#${clipId})`}>{bars}</g>
            <line
              x1={playhead}
              x2={playhead}
              y1="0"
              y2="120"
              stroke="#d4544b"
              strokeWidth="1.5"
            />
          </>
        )}
      </svg>
      {onSeek && (
        <input
          aria-label="Seek recording"
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={current}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      )}
    </div>
  );
});
const RecordingList = memo(function RecordingList({
  recordings,
  activeId,
  onChoose,
  onMenu,
}: {
  recordings: Recording[];
  activeId?: string;
  onChoose: (id: string) => void;
  onMenu: (recording: Recording, x: number, y: number) => void;
}) {
  return recordings.map((r) => (
    <button
      className={`recording-item ${activeId === r.id ? "active" : ""}`}
      key={r.id}
      onClick={() => onChoose(r.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(r, e.clientX, e.clientY);
      }}
    >
      <span className="recording-title">
        {r.title}
        {r.favorite && <Star size={11} fill="currentColor" />}
      </span>
      <span className="recording-meta">
        <span>{stamp(r.createdAt)}</span>
        <span>{clock(r.duration)}</span>
      </span>
      <span className="recording-caption">
        {r.transcribed ? (
          <>
            <span className="tiny-dots">
              {Object.keys(r.speakers)
                .slice(0, 3)
                .map((s) => (
                  <i key={s} style={{ background: speakerColor(s) }} />
                ))}
            </span>
            {
              Object.keys(r.speakers).filter((s) => s.startsWith("speaker"))
                .length
            }{" "}
            speakers
          </>
        ) : (
          <>
            <span className="plain-dot" />
            Audio recording
          </>
        )}
      </span>
    </button>
  ));
});
const TranscriptTurn = memo(function TranscriptTurn({
  turn: t,
  name,
  isCurrent,
  onSeek,
}: {
  turn: Turn;
  name?: string;
  isCurrent: boolean;
  onSeek: (time: number) => void;
}) {
  return (
    <button
      className={`transcript-turn ${isCurrent ? "current" : ""} ${t.speaker === "overlap" ? "overlapping" : ""}`}
      onClick={() => onSeek(t.start)}
    >
      <time>{clock(t.start)}</time>
      <div className="turn-body">
        <div
          className="speaker-name"
          style={{ color: speakerColor(t.speaker) }}
        >
          <span
            className="speaker-marker"
            style={{ background: speakerColor(t.speaker) }}
          />
          {name || "Unassigned"}
          {t.speaker === "overlap" && <small>Attribution uncertain</small>}
        </div>
        <p>{t.text}</p>
      </div>
    </button>
  );
});
// Minimal Markdown for agent output: headings, bullets, numbered items, **bold**, `code`.
// Rendered as React text, so nothing in the summary is interpreted as HTML.
function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line),
      numbered = /^\d+[.)]\s+(.*)$/.exec(line),
      heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      list ||= { ordered, items: [] };
      list.items.push((bullet || numbered)![1]);
      continue;
    }
    flush();
    if (!line) continue;
    if (heading)
      blocks.push(
        heading[1].length <= 2 ? (
          <h3 key={blocks.length}>{inline(heading[2])}</h3>
        ) : (
          <h4 key={blocks.length}>{inline(heading[2])}</h4>
        ),
      );
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}
const SummaryPanel = memo(function SummaryPanel({
  recording,
  running,
  otherRunning,
  languages,
  summaryLanguage,
  onLanguage,
  onSummarize,
  onCancel,
  onCopy,
}: {
  recording: Recording;
  running: boolean;
  otherRunning: boolean;
  languages: string[];
  summaryLanguage: string;
  onLanguage: (code: string) => void;
  onSummarize: () => void;
  onCancel: () => void;
  onCopy: () => void;
}) {
  const summary = recording.summary;
  const available = !!api.summarize && !recording.demo;
  const renamed =
    summary &&
    JSON.stringify(summary.speakers) !== JSON.stringify(recording.speakers);
  const controls = (
    <div className="summary-controls">
      <label>
        Summary in
        <select
          className="language-select"
          value={summaryLanguage}
          disabled={!available || running}
          onChange={(e) => onLanguage(e.target.value)}
        >
          <option value="original">Same as the recording</option>
          {languages
            .map((code) => [code, languageName(code)])
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
        </select>
      </label>
      {running ? (
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
      ) : (
        <button
          className="secondary-button"
          disabled={!available || otherRunning}
          onClick={onSummarize}
        >
          <Sparkles size={15} />
          {summary ? "Summarise again" : "Summarise with Hermes"}
        </button>
      )}
    </div>
  );
  return (
    <div className="summary-panel">
      <div className="section-intro">
        <h2>The conversation, in short.</h2>
        <p>
          Your Hermes agent writes a summary that keeps track of who said what,
          and translates when needed. Only the transcript text is sent, to the
          model Hermes is set up to use. Hermes gets no tools for this.
        </p>
      </div>
      {controls}
      {running ? (
        <div className="summary-running">
          <LoaderCircle className="spin" size={18} />
          Hermes is reading the transcript… long recordings can take a few
          minutes.
        </div>
      ) : summary ? (
        <>
          <div className="summary-meta">
            <span>
              {summary.language === "original"
                ? "In the recording's language"
                : languageName(summary.language)}{" "}
              · {new Date(summary.createdAt).toLocaleString()}
            </span>
            <button className="text-button" onClick={onCopy}>
              <Copy size={13} /> Copy
            </button>
          </div>
          {renamed && (
            <p className="subtle-note">
              Speaker names changed after this summary. Summarise again to use
              the new names.
            </p>
          )}
          <Markdown text={summary.text} />
        </>
      ) : (
        !available && (
          <p className="subtle-note">
            Summaries use your local Hermes agent in the desktop app.
          </p>
        )
      )}
    </div>
  );
});
// Counts up on its own so a long step reads as working, without re-rendering the transcript.
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{clock((now - since) / 1000)} elapsed · </>;
}
// In-page right-click menu for the browser version (the desktop app uses a native menu).
function RecordingMenu({
  recording,
  x,
  y,
  onAction,
  onClose,
}: {
  recording: Recording;
  x: number;
  y: number;
  onAction: (action: MenuAction) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);
  const ready = recording.transcribed && recording.turns.length > 0;
  const items: [MenuAction, string][] = [
    ...(ready
      ? ([
          ["copy-transcript", "Copy transcript"],
          ["download-docx", "Download transcript as Word"],
        ] as [MenuAction, string][])
      : []),
    ...(recording.summary
      ? ([["copy-summary", "Copy summary"]] as [MenuAction, string][])
      : []),
    [
      "favorite",
      recording.favorite ? "Remove from favorites" : "Add to favorites",
    ],
    ["export-audio", "Export audio"],
    ["delete", recording.deleted ? "Restore" : "Delete"],
  ];
  return (
    <div
      className="context-backdrop"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="context-menu"
        role="menu"
        style={{
          left: Math.min(x, window.innerWidth - 230),
          top: Math.min(y, window.innerHeight - items.length * 32 - 16),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map(([action, label]) => (
          <button key={action} role="menuitem" onClick={() => onAction(action)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
// Text appears piece by piece while transcribing; speakers are attached at the end.
function TranscribingView({
  progress,
  current,
  onSeek,
}: {
  progress?: Progress;
  current: number;
  onSeek: (time: number) => void;
}) {
  const fraction =
    progress?.total && progress.done !== undefined
      ? Math.min(1, progress.done / progress.total)
      : 0;
  const turns = progress?.turns || [];
  return (
    <div className="transcribing">
      <div className="transcribing-status">
        <LoaderCircle className="spin" size={16} />
        <div>
          <strong>
            {progress?.message || "Starting local transcription…"}
          </strong>
          <span>
            {progress?.started && <Elapsed since={progress.started} />}
            {progress?.total
              ? `${clock(progress.done || 0)} of ${clock(progress.total)} · `
              : ""}
            Runs quietly in the background and pauses if your Mac gets warm.
            Finished parts are kept if you cancel.
          </span>
          <div className="transcribing-bar">
            <i style={{ width: `${fraction * 100}%` }} />
          </div>
        </div>
        <button className="text-button" onClick={() => api.cancel()}>
          Cancel
        </button>
      </div>
      <div className="transcript-content">
        {turns.map((t, i) => (
          <TranscriptTurn
            key={`${t.start}-${i}`}
            turn={t}
            name="Speaker identified when finished"
            isCurrent={current >= t.start && current < t.end}
            onSeek={onSeek}
          />
        ))}
      </div>
    </div>
  );
}
export default function App() {
  const [items, setItems] = useState<Recording[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [folder, setFolder] = useState("all"),
    [query, setQuery] = useState("");
  const [showDemo, setShowDemo] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settings, setSettings] = useState<Settings | null>(null),
    [languages, setLanguages] = useState<string[]>([]),
    [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [progress, setProgress] = useState<Progress>({ message: "" }),
    [saving, setSaving] = useState(false);
  const [capture, setCapture] = useState<"idle" | "recording" | "paused">(
      "idle",
    ),
    [elapsed, setElapsed] = useState(0),
    [livePeaks, setLivePeaks] = useState<number[]>(Array(160).fill(0.015));
  const [playing, setPlaying] = useState(false),
    [current, setCurrent] = useState(0),
    [speed, setSpeed] = useState(1),
    [tab, setTab] = useState("transcript"),
    [speakerFilter, setSpeakerFilter] = useState("all"),
    [transcriptSearch, setTranscriptSearch] = useState(""),
    [exportOpen, setExportOpen] = useState(false),
    [renaming, setRenaming] = useState(false),
    [summarizing, setSummarizing] = useState<string | null>(null),
    [menu, setMenu] = useState<{
      recording: Recording;
      x: number;
      y: number;
    } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    media = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    audioContext = useRef<AudioContext | null>(null),
    frame = useRef(0),
    chunks = useRef<Blob[]>([]),
    captureRef = useRef(capture);
  const active = showDemo ? demo : items.find((r) => r.id === selected);
  const activeRef = useRef(active);
  activeRef.current = active;
  const searchText = useMemo(
    () =>
      new Map(
        items.map((r) => [
          r,
          `${r.title} ${r.turns.map((t) => t.text).join(" ")}`.toLowerCase(),
        ]),
      ),
    [items],
  );
  const filtered = useMemo(
    () =>
      items.filter(
        (r) =>
          (folder === "trash"
            ? r.deleted
            : !r.deleted && (folder !== "favorites" || r.favorite)) &&
          searchText.get(r)!.includes(query.toLowerCase()),
      ),
    [items, searchText, folder, query],
  );
  useEffect(() => {
    api
      .list()
      .then((r) => {
        setItems(r);
        setSelected(r.find((i) => !i.deleted)?.id || null);
      })
      .catch((e) => setError(e.message));
    api.status().then((s) => setEngineReady(s.ready));
    return api.onProgress((update) =>
      setProgress((previous) => ({ ...previous, ...update })),
    );
  }, []);
  useEffect(() => {
    captureRef.current = capture;
    if (capture !== "recording") return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [capture]);
  useEffect(() => {
    if (elapsed >= 3590 && capture !== "idle") {
      media.current?.stop();
      setNotice("One-hour limit reached. Your recording is being saved.");
    }
  }, [elapsed, capture]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (captureRef.current !== "idle") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useEffect(() => {
    setCurrent(0);
    setPlaying(false);
    setSpeakerFilter("all");
    setRenaming(false);
    setExportOpen(false);
    const player = audioRef.current;
    player?.pause();
    let cancelled = false,
      url = "";
    if (active && !active.demo && api.audioUrl && player) {
      player.src = api.audioUrl(active.id);
      player.playbackRate = speed;
    } else if (active && !active.demo)
      api
        .audio(active.id)
        .then((bytes) => {
          if (cancelled) return;
          url = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: "audio/wav" }),
          );
          if (player) {
            player.src = url;
            player.playbackRate = speed;
          }
        })
        .catch((e) => setError(e.message));
    else if (player) player.removeAttribute("src");
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [active?.id]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function patch(changes: Partial<Recording>) {
    if (active) await patchRecording(active, changes);
  }
  async function patchRecording(
    previous: Recording,
    changes: Partial<Recording>,
  ) {
    if (previous.demo) return;
    setItems((prev) =>
      prev.map((r) => (r.id === previous.id ? { ...r, ...changes } : r)),
    );
    try {
      await api.update(previous.id, changes);
    } catch (e) {
      setItems((prev) =>
        prev.map((r) => (r.id === previous.id ? previous : r)),
      );
      setError(String(e));
    }
  }
  const choose = useCallback((id: string) => {
    setShowDemo(false);
    setSelected(id);
  }, []);
  async function openSettings() {
    setSettings(await api.settings());
    if (api.languages && !languages.length) setLanguages(await api.languages());
    setSettingsOpen(true);
  }
  async function pick(key: string) {
    const s = await api.pickSetting(key);
    if (s) setSettings(s);
    setEngineReady((await api.status()).ready);
  }
  async function saveBlob(blob: Blob, title: string) {
    setSaving(true);
    try {
      const prepared = await prepareAudio(blob);
      if (prepared.duration < 0.2)
        throw new Error("Record a little longer before saving.");
      const item: Recording = {
        id: crypto.randomUUID(),
        title,
        createdAt: new Date().toISOString(),
        duration: prepared.duration,
        peaks: prepared.peaks,
        favorite: false,
        deleted: false,
        turns: [],
        speakers: {},
      };
      await api.save(item, prepared.buffer);
      added(item);
    } catch (e) {
      setError(`Could not save audio: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }
  function added(item: Recording) {
    setItems((prev) => [item, ...prev]);
    choose(item.id);
    setFolder("all");
    setNotice("Recording saved on this device");
  }
  // The desktop app converts imports on disk; the in-renderer decoder is only a fallback.
  async function importFile(file: File) {
    const title = file.name.replace(/\.[^.]+$/, "");
    if (api.importFile) {
      setSaving(true);
      try {
        const item = await api.importFile(file, title);
        if (item) return added(item);
        // null: afconvert can't read this format, so decode it in the window instead.
      } catch (e) {
        return setError(
          `Could not save audio: ${e instanceof Error ? e.message : e}`,
        );
      } finally {
        setSaving(false);
      }
    }
    if (file.size > 150e6)
      return setError("Please choose an audio file smaller than 150 MB.");
    await saveBlob(file, title);
  }
  async function startRecording() {
    setError("");
    try {
      audioRef.current?.pause();
      if (!(await api.microphone()))
        throw new Error(
          "Microphone access is off. Enable it for Voices in System Settings → Privacy & Security → Microphone.",
        );
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      stream.current = input;
      const recorder = new MediaRecorder(input);
      media.current = recorder;
      chunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      recorder.onerror = () => {
        setError(
          "The microphone stopped unexpectedly. Saving the audio captured so far.",
        );
        if (recorder.state !== "inactive") recorder.stop();
      };
      recorder.onstop = () => {
        input.getTracks().forEach((t) => t.stop());
        cancelAnimationFrame(frame.current);
        void audioContext.current?.close();
        setCapture("idle");
        void api.recording(false);
        void saveBlob(
          new Blob(chunks.current, { type: recorder.mimeType }),
          `New recording ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
        );
      };
      const context = new AudioContext();
      audioContext.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(input).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let last = 0;
      const tick = (time: number) => {
        if (time - last > 65 && captureRef.current === "recording") {
          analyser.getByteTimeDomainData(data);
          const level = Math.max(
            ...Array.from(data, (v) => Math.abs(v - 128) / 128),
          );
          setLivePeaks((p) => [...p.slice(1), Math.max(0.02, level)]);
          last = time;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
      setElapsed(0);
      setLivePeaks(Array(160).fill(0.015));
      setCapture("recording");
      await api.recording(true);
      recorder.start(1000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setCapture("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function pauseRecording() {
    if (capture === "recording") {
      media.current?.pause();
      setCapture("paused");
    } else {
      media.current?.resume();
      setCapture("recording");
    }
  }
  async function transcribe() {
    if (!active || active.demo) return;
    const id = active.id;
    setError("");
    setBusy(id);
    setProgress({
      id,
      message: "Starting local transcription…",
      started: Date.now(),
    });
    try {
      const result = await api.transcribe(id);
      setItems((prev) => prev.map((r) => (r.id === id ? result : r)));
      setNotice("Transcript ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  const seek = useCallback((time: number) => {
    setCurrent(time);
    if (audioRef.current && !activeRef.current?.demo)
      audioRef.current.currentTime = time;
  }, []);
  async function togglePlayback() {
    if (!audioRef.current || active?.demo) return;
    try {
      if (playing) audioRef.current.pause();
      else await audioRef.current.play();
    } catch (e) {
      setError(`Could not play recording: ${e}`);
    }
  }
  async function summarize() {
    if (!active || !api.summarize) return;
    const id = active.id;
    setError("");
    setSummarizing(id);
    try {
      const result = await api.summarize(id);
      setItems((prev) => prev.map((r) => (r.id === id ? result : r)));
      setNotice("Summary ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSummarizing(null);
    }
  }
  async function chooseSummaryLanguage(code: string) {
    const next = await api.setSummaryLanguage?.(code);
    if (next) setSettings(next);
  }
  useEffect(() => {
    if (tab !== "summary") return;
    if (!settings) void api.settings().then(setSettings);
    if (api.languages && !languages.length)
      void api.languages().then(setLanguages);
  }, [tab]);
  async function exportRecording(kind: string, target = active) {
    if (!target) return;
    setExportOpen(false);
    try {
      const data =
        kind === "docx"
          ? await transcriptDocx(target)
          : kind === "md"
            ? `# ${target.title}\n\n${target.summary?.text || ""}\n`
            : kind === "json"
              ? JSON.stringify(
                  {
                    title: target.title,
                    speakers: target.speakers,
                    turns: target.turns,
                  },
                  null,
                  2,
                )
              : transcriptText(target);
      if (await api.export(target.id, kind, data))
        setNotice(kind === "docx" ? "Word document saved" : "Export saved");
    } catch (e) {
      setError(`Could not export: ${e instanceof Error ? e.message : e}`);
    }
  }
  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch (e) {
      setError(`Could not copy: ${e instanceof Error ? e.message : e}`);
    }
  }
  function runMenuAction(target: Recording, action: MenuAction) {
    setMenu(null);
    if (action === "copy-transcript")
      void copyText(transcriptText(target), "Transcript copied");
    else if (action === "download-docx") void exportRecording("docx", target);
    else if (action === "copy-summary")
      void copyText(target.summary?.text || "", "Summary copied");
    else if (action === "favorite")
      void patchRecording(target, { favorite: !target.favorite });
    else if (action === "export-audio") void exportRecording("wav", target);
    else if (action === "delete")
      void patchRecording(target, { deleted: !target.deleted });
  }
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const runMenuActionRef = useRef(runMenuAction);
  runMenuActionRef.current = runMenuAction;
  // Desktop: native menu, whose choice comes back as an event. Browser: an in-page menu.
  const openMenu = useCallback((target: Recording, x: number, y: number) => {
    if (api.showMenu) void api.showMenu(target.id);
    else setMenu({ recording: target, x, y });
  }, []);
  useEffect(
    () =>
      api.onMenuAction?.(({ id, action }) => {
        const target = itemsRef.current.find((r) => r.id === id);
        if (target) runMenuActionRef.current(target, action);
      }),
    [],
  );
  const speakers = useMemo(
    () =>
      active
        ? Object.keys(active.speakers).filter(
            (s) => !["overlap", "unknown"].includes(s),
          )
        : [],
    [active],
  );
  const visibleTurns = useMemo(
    () =>
      active?.turns.filter(
        (t) =>
          (speakerFilter === "all" || t.speaker === speakerFilter) &&
          `${t.text} ${active.speakers[t.speaker]}`
            .toLowerCase()
            .includes(transcriptSearch.toLowerCase()),
      ) || [],
    [active, speakerFilter, transcriptSearch],
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-space">
          <span className="app-name">
            <AudioLines size={17} /> Voices
          </span>
        </div>
        <div className="sidebar-content">
          <div className="library-label">YOUR LIBRARY</div>
          <nav aria-label="Recording folders">
            {[
              { id: "all", icon: AudioLines, label: "All recordings" },
              { id: "favorites", icon: Star, label: "Favorites" },
              { id: "trash", icon: Trash2, label: "Recently deleted" },
            ].map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                className={`nav-item ${folder === id ? "selected" : ""}`}
                onClick={() => {
                  setFolder(id);
                  setShowDemo(false);
                }}
              >
                <Icon size={17} />
                <span>{label}</span>
                {id !== "trash" && (
                  <small>
                    {
                      items.filter(
                        (r) => !r.deleted && (id !== "favorites" || r.favorite),
                      ).length
                    }
                  </small>
                )}
              </button>
            ))}
          </nav>
          <div className="list-heading">
            <span>
              {folder === "all"
                ? "Recordings"
                : folder === "favorites"
                  ? "Favorites"
                  : "Recently deleted"}
            </span>
            <button
              className="icon-button"
              aria-label="Import audio"
              title="Import audio"
              disabled={saving || capture !== "idle"}
              onClick={() => fileRef.current?.click()}
            >
              <Plus size={17} />
            </button>
          </div>
          <label className="search">
            <Search size={14} />
            <input
              aria-label="Search recordings"
              placeholder="Search recordings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span>⌕</span>
          </label>
          <div className="recording-list">
            <RecordingList
              recordings={filtered}
              activeId={active?.id}
              onChoose={choose}
              onMenu={openMenu}
            />
            {!filtered.length && (
              <div className="library-empty">
                {query
                  ? "No matching recordings"
                  : folder === "trash"
                    ? "Nothing in recently deleted"
                    : folder === "favorites"
                      ? "Your favorite recordings will appear here."
                      : "Your conversations, all in one place."}
              </div>
            )}
          </div>
        </div>
        <div className="sidebar-footer">
          <button onClick={openSettings} className="settings-button">
            <Settings2 size={16} />
            <span>Settings</span>
          </button>
          <span className="local-label">
            <span />
            On this Mac
          </span>
        </div>
      </aside>
      <main className="workspace">
        <header className="toolbar">
          <div className="breadcrumb">
            <Folder size={15} />
            <span>
              {showDemo
                ? "A look inside Voices"
                : folder === "favorites"
                  ? "Favorites"
                  : folder === "trash"
                    ? "Recently deleted"
                    : "All recordings"}
            </span>
          </div>
          <div className="toolbar-actions">
            <button
              className="text-button"
              onClick={() => fileRef.current?.click()}
              disabled={saving || capture !== "idle"}
            >
              <Upload size={15} /> Import audio
            </button>
            <span className="toolbar-divider" />
            <button
              className="record-top"
              onClick={startRecording}
              disabled={capture !== "idle" || saving}
            >
              <span /> New recording
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{readableError(error)}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {capture !== "idle" ? (
          <section className="capture-view">
            <div className="eyebrow">
              {capture === "paused"
                ? "RECORDING PAUSED"
                : "LISTENING TO YOUR MICROPHONE"}
            </div>
            <h1>Stay in the conversation.</h1>
            <p>We’ll keep the words for you.</p>
            <div className="capture-time">
              {clock(elapsed)}
              <span
                className={
                  capture === "recording" ? "pulsing-dot" : "plain-dot"
                }
              />
            </div>
            <Waveform
              peaks={livePeaks}
              turns={[]}
              duration={elapsed}
              current={elapsed}
              live
            />
            <div className="capture-controls">
              <button className="secondary-button" onClick={pauseRecording}>
                {capture === "paused" ? (
                  <Play size={16} />
                ) : (
                  <Pause size={16} />
                )}{" "}
                {capture === "paused" ? "Resume" : "Pause"}
              </button>
              <button
                className="primary-button"
                onClick={() => media.current?.stop()}
              >
                <Square size={13} fill="currentColor" /> Stop & save
              </button>
            </div>
            <div className="privacy-note">
              <ShieldCheck size={14} /> Audio stays on your Mac. Transcribe when
              you’re ready.
            </div>
          </section>
        ) : saving ? (
          <section className="empty-state">
            <LoaderCircle className="spin" size={30} />
            <h2>Saving your recording…</h2>
            <p>Preparing your audio for playback and transcription.</p>
          </section>
        ) : !active ? (
          <section className="empty-state">
            <div className="empty-wave">
              <AudioLines size={62} strokeWidth={1} />
            </div>
            <div className="eyebrow">A LITTLE ROOM FOR EVERY VOICE</div>
            <h1>
              Good conversations.
              <br />
              Every word, remembered.
            </h1>
            <p>
              A familiar voice recorder, with a new way to listen.
              <br />
              Record a moment. Find the words. Follow every speaker.
            </p>
            <button className="large-record" onClick={startRecording}>
              <span /> Start a recording
            </button>
            <button className="demo-button" onClick={() => setShowDemo(true)}>
              Explore a sample transcript <ArrowUpRight size={14} />
            </button>
            <div className="empty-benefits">
              <span>
                <Mic size={15} /> Effortless recording
              </span>
              <span>
                <Users size={15} /> Distinct speakers
              </span>
              <span>
                <ShieldCheck size={15} /> Locally processed
              </span>
            </div>
          </section>
        ) : (
          <>
            <section className="recording-header">
              <div className="recording-kicker">
                {active.demo
                  ? "SAMPLE TRANSCRIPT · ILLUSTRATIVE CONTENT"
                  : new Date(active.createdAt)
                      .toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                      .toUpperCase()}
              </div>
              <div className="title-row">
                {renaming ? (
                  <input
                    className="title-input"
                    aria-label="Recording title"
                    autoFocus
                    defaultValue={active.title}
                    onBlur={(e) => {
                      void patch({
                        title: e.target.value.trim() || active.title,
                      });
                      setRenaming(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                  />
                ) : (
                  <h1>
                    <button
                      disabled={active.demo}
                      title="Rename recording"
                      onClick={() => setRenaming(true)}
                    >
                      {active.title}
                    </button>
                  </h1>
                )}
                <div className="title-actions">
                  <button
                    className={`icon-button ${active.favorite ? "favorited" : ""}`}
                    aria-label={
                      active.favorite
                        ? "Remove from favorites"
                        : "Add to favorites"
                    }
                    disabled={active.demo}
                    onClick={() => patch({ favorite: !active.favorite })}
                  >
                    <Star
                      size={18}
                      fill={active.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <div className="export-wrap">
                    <button
                      className="icon-button"
                      aria-label="Export recording"
                      disabled={active.demo}
                      onClick={() => setExportOpen(!exportOpen)}
                    >
                      <Download size={18} />
                    </button>
                    {exportOpen && (
                      <div className="export-menu">
                        {[
                          "wav",
                          ...(active.transcribed
                            ? ["docx", "txt", "json"]
                            : []),
                          ...(active.summary ? ["md"] : []),
                        ].map((kind) => (
                          <button
                            key={kind}
                            onClick={() => exportRecording(kind)}
                          >
                            {kind === "wav"
                              ? "Audio (.wav)"
                              : kind === "docx"
                                ? "Transcript (Word)"
                                : kind === "txt"
                                  ? "Transcript (.txt)"
                                  : kind === "json"
                                    ? "Transcript (.json)"
                                    : "Summary (.md)"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    className="icon-button"
                    aria-label={
                      active.deleted ? "Restore recording" : "Delete recording"
                    }
                    disabled={active.demo || busy === active.id}
                    onClick={() => patch({ deleted: !active.deleted })}
                  >
                    {active.deleted ? (
                      <RotateCcw size={18} />
                    ) : (
                      <Trash2 size={17} />
                    )}
                  </button>
                </div>
              </div>
              <div className="recording-details">
                <span>
                  <Headphones size={14} />
                  {clock(active.duration)}
                </span>
                <i />
                {active.transcribed ? (
                  <span>
                    <Users size={14} />
                    {speakers.length} speakers
                  </span>
                ) : (
                  <span>Ready to transcribe</span>
                )}
                {active.language && (
                  <>
                    <i />
                    <span>
                      {languageName(active.language)}
                      {active.languageDetected ? " · detected" : ""}
                    </span>
                  </>
                )}
                <i />
                <span>
                  {active.demo
                    ? "Preview only · no audio"
                    : "Saved on this Mac"}
                </span>
              </div>
            </section>
            <section className="player">
              <Waveform
                peaks={active.peaks}
                turns={active.turns}
                duration={active.duration}
                current={current}
                onSeek={seek}
              />
              <div className="timeline-labels">
                {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                  <span key={n}>{clock(n * active.duration)}</span>
                ))}
              </div>
              <div className="playback-controls">
                <div className="playback-time">
                  {clock(current)} <span>/ {clock(active.duration)}</span>
                </div>
                <div className="transport">
                  <button
                    className="icon-button skip"
                    aria-label="Back 15 seconds"
                    onClick={() => seek(Math.max(0, current - 15))}
                    disabled={active.demo}
                  >
                    <RotateCcw size={25} />
                    <span>15</span>
                  </button>
                  <button
                    className="play-button"
                    aria-label={playing ? "Pause playback" : "Play recording"}
                    onClick={togglePlayback}
                    disabled={active.demo}
                  >
                    {playing ? (
                      <Pause size={23} fill="currentColor" />
                    ) : (
                      <Play size={23} fill="currentColor" />
                    )}
                  </button>
                  <button
                    className="icon-button skip"
                    aria-label="Forward 15 seconds"
                    onClick={() =>
                      seek(Math.min(active.duration, current + 15))
                    }
                    disabled={active.demo}
                  >
                    <RotateCw size={25} />
                    <span>15</span>
                  </button>
                </div>
                <button
                  className="speed-button"
                  aria-label="Playback speed"
                  disabled={active.demo}
                  onClick={() => {
                    const next = speed === 2 ? 0.75 : speed + 0.25;
                    setSpeed(next);
                    if (audioRef.current) audioRef.current.playbackRate = next;
                  }}
                >
                  {speed}×
                </button>
              </div>
            </section>
            <section className="transcript-section">
              <div className="transcript-toolbar">
                <div className="tabs">
                  <button
                    className={tab === "transcript" ? "active" : ""}
                    onClick={() => setTab("transcript")}
                  >
                    <FileText size={15} />
                    Transcript
                  </button>
                  <button
                    className={tab === "speakers" ? "active" : ""}
                    onClick={() => setTab("speakers")}
                  >
                    <Users size={15} />
                    Speakers{" "}
                    {speakers.length > 0 && <small>{speakers.length}</small>}
                  </button>
                  <button
                    className={tab === "summary" ? "active" : ""}
                    onClick={() => setTab("summary")}
                  >
                    <Sparkles size={15} />
                    Summary
                  </button>
                </div>
                {active.transcribed && active.turns.length > 0 && (
                  <div className="transcript-actions">
                    <button
                      className="icon-button"
                      aria-label="Copy transcript"
                      title="Copy transcript"
                      onClick={() =>
                        copyText(transcriptText(active), "Transcript copied")
                      }
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Download transcript as Word"
                      title="Download as Word"
                      disabled={active.demo}
                      onClick={() => exportRecording("docx")}
                    >
                      <FileDown size={16} />
                    </button>
                  </div>
                )}
                {active.transcribed && (
                  <label className="transcript-search">
                    <Search size={15} />
                    <input
                      aria-label="Find in transcript"
                      placeholder="Find in transcript"
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                    />
                  </label>
                )}
              </div>
              {busy === active.id ? (
                <TranscribingView
                  progress={progress.id === active.id ? progress : undefined}
                  current={current}
                  onSeek={seek}
                />
              ) : !active.transcribed ? (
                <div className="transcript-empty">
                  <div className="transcript-symbol">
                    <FileText size={27} strokeWidth={1.3} />
                  </div>
                  <h2>The words are already here.</h2>
                  <p>
                    Turn this recording into a transcript.
                    <br />
                    Each speaker gets a voice, a name, and a color.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={engineReady ? transcribe : openSettings}
                    disabled={!!busy}
                  >
                    <AudioLines size={16} />
                    {engineReady
                      ? "Transcribe recording"
                      : "Set up transcription"}
                  </button>
                  <small>Powered by NVIDIA Nemotron · Up to 8 speakers</small>
                </div>
              ) : tab === "summary" ? (
                <SummaryPanel
                  recording={active}
                  running={summarizing === active.id}
                  otherRunning={!!summarizing && summarizing !== active.id}
                  languages={languages}
                  summaryLanguage={settings?.summaryLanguage || "en-US"}
                  onLanguage={chooseSummaryLanguage}
                  onSummarize={summarize}
                  onCancel={() => void api.cancelSummary?.()}
                  onCopy={() =>
                    void navigator.clipboard
                      .writeText(active.summary?.text || "")
                      .then(() => setNotice("Summary copied"))
                  }
                />
              ) : tab === "speakers" ? (
                <div className="speakers-panel">
                  <div className="section-intro">
                    <h2>Put a name to each voice.</h2>
                    <p>
                      Names apply throughout this recording. Select a name to
                      edit it.
                    </p>
                  </div>
                  {speakers.map((s, i) => {
                    const duration = active.turns
                      .filter((t) => t.speaker === s)
                      .reduce((a, t) => a + t.end - t.start, 0);
                    return (
                      <div className="speaker-row" key={s}>
                        <span
                          className="avatar"
                          style={{
                            color: speakerColor(s),
                            background: `${speakerColor(s)}15`,
                          }}
                        >
                          {i + 1}
                        </span>
                        <div>
                          <input
                            aria-label={`Name for speaker ${i + 1}`}
                            key={`${active.id}-${s}`}
                            defaultValue={active.speakers[s]}
                            disabled={active.demo}
                            onBlur={(e) =>
                              patch({
                                speakers: {
                                  ...active.speakers,
                                  [s]:
                                    e.target.value.trim() || `Speaker ${i + 1}`,
                                },
                              })
                            }
                          />
                          <small>
                            Speaker {i + 1} · {clock(duration)} of attributed
                            speech
                          </small>
                        </div>
                        <div className="speaker-duration">
                          <i
                            style={{
                              width: `${Math.min(100, (duration / active.duration) * 100)}%`,
                              background: speakerColor(s),
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <p className="subtle-note">
                    Speaker labels distinguish voices within this recording.
                    Names are added by you.
                  </p>
                </div>
              ) : (
                <>
                  <div className="speaker-filter">
                    <button
                      className={speakerFilter === "all" ? "active" : ""}
                      onClick={() => setSpeakerFilter("all")}
                    >
                      All speakers
                    </button>
                    {speakers.map((s) => (
                      <button
                        key={s}
                        className={speakerFilter === s ? "active" : ""}
                        onClick={() => setSpeakerFilter(s)}
                      >
                        <span style={{ background: speakerColor(s) }} />
                        {active.speakers[s]}
                      </button>
                    ))}
                    <span className="filter-hint">
                      {active.demo
                        ? "Sample content"
                        : "Click a passage to seek"}
                    </span>
                  </div>
                  <div className="transcript-content">
                    {visibleTurns.length ? (
                      visibleTurns.map((t, i) => (
                        <TranscriptTurn
                          key={`${t.start}-${i}`}
                          turn={t}
                          name={active.speakers[t.speaker]}
                          isCurrent={current >= t.start && current < t.end}
                          onSeek={seek}
                        />
                      ))
                    ) : (
                      <div className="no-results">
                        {transcriptSearch || speakerFilter !== "all"
                          ? "No matching passages."
                          : "No speech was detected in this recording."}
                      </div>
                    )}
                    <div className="transcript-end">
                      <span />{" "}
                      {active.demo
                        ? "End of sample transcript"
                        : "End of transcript"}{" "}
                      <span />
                    </div>
                  </div>
                </>
              )}
            </section>
            <footer className="workspace-footer">
              <span>
                <ShieldCheck size={13} />{" "}
                {active.demo
                  ? "Illustrative transcript · explore without recording"
                  : "Your audio stays on this device"}
              </span>
              {active.demo ? (
                <button onClick={() => setShowDemo(false)}>
                  Close sample <X size={13} />
                </button>
              ) : active.transcribed ? (
                <button onClick={transcribe} disabled={!!busy}>
                  Transcribe again
                </button>
              ) : (
                <span>Voices</span>
              )}
            </footer>
          </>
        )}
      </main>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.m4a,.wav,.mp3,.webm"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void importFile(file);
          }
          e.target.value = "";
        }}
      />
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {menu && (
        <RecordingMenu
          {...menu}
          onAction={(action) => runMenuAction(menu.recording, action)}
          onClose={() => setMenu(null)}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
      {settingsOpen && (
        <div
          className="settings-overlay"
          onClick={() => setSettingsOpen(false)}
        >
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSettingsOpen(false);
            }}
          >
            <div className="settings-heading">
              <h2>Make yourself at home.</h2>
              <button
                className="icon-button"
                autoFocus
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <p className="settings-description">
              Recording works right away. Local transcription uses NVIDIA’s
              speech runtime and Nemotron 3 Diarization.
            </p>
            <div className="engine-status">
              <span className={engineReady ? "ready-dot" : "plain-dot"} />
              {engineReady
                ? "Local engine and model found"
                : "Finish setting up local transcription"}
            </div>
            <div className="setting-field">
              <label htmlFor="language-setting">Spoken language</label>
              <p>
                Automatic listens to a minute of each recording to decide.
                Choose a language if it guesses wrong, then transcribe again.
              </p>
              <select
                id="language-setting"
                className="language-select"
                value={settings?.language || "auto"}
                disabled={!api.setLanguage}
                onChange={async (e) => {
                  const next = await api.setLanguage?.(e.target.value);
                  if (next) setSettings(next);
                }}
              >
                <option value="auto">Automatic (recommended)</option>
                {languages
                  .map((code) => [code, languageName(code)])
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="setting-field">
              <label>Hermes agent (for summaries)</label>
              <p>{settings?.hermesPath || "Available in the desktop app"}</p>
              <button
                className="secondary-button"
                onClick={() => pick("hermesPath")}
                disabled={!window.voices}
              >
                Choose hermes <ChevronDown size={13} />
              </button>
            </div>
            <div className="setting-field">
              <label>Speech runtime</label>
              <p>{settings?.enginePath}</p>
              <button
                className="secondary-button"
                onClick={() => pick("enginePath")}
                disabled={!window.voices}
              >
                Choose nemo-speech <ChevronDown size={13} />
              </button>
            </div>
            <div className="setting-field">
              <label>Nemotron 3 Diarization model</label>
              <p>
                {settings?.modelPath ||
                  "Choose Nemotron-3-Diarization.q8_0.gguf"}
              </p>
              <button
                className="secondary-button"
                onClick={() => pick("modelPath")}
                disabled={!window.voices}
              >
                Choose GGUF model <ChevronDown size={13} />
              </button>
            </div>
            <div className="settings-note">
              <ShieldCheck size={18} />
              <p>
                Audio is processed on this device. Parakeet speech recognition
                downloads its model on first use. Speaker names are assigned by
                you.
              </p>
            </div>
            {!window.voices && (
              <p className="subtle-note">
                You’re in the browser preview. Open the Electron app to use
                local transcription.
              </p>
            )}
            <button
              className="primary-button settings-done"
              onClick={() => setSettingsOpen(false)}
            >
              Done
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

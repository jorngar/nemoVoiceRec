# Voices

**Private recording with speaker separation, processed entirely on your Mac.**

Record or import a conversation and get a transcript that knows who said what: up to eight voices, each with its own color and a name you choose. Speech recognition and speaker separation run locally on NVIDIA's Nemotron and Parakeet models, so your audio never leaves the machine and no account or upload is needed.

## Why Voices

- **Your audio stays on your Mac.** Recording, transcription and speaker separation all run on-device. Nothing is uploaded, and there is no cloud account.
- **Who said what, not just what was said.** NVIDIA Nemotron 3 separates up to eight speakers across the whole recording and keeps the labels consistent. Crosstalk is marked as *overlapping* instead of being guessed.
- **Built for real meetings, lectures and trainings.** Recordings up to eight hours are handled in small pieces. Text appears as it's recognized, and a cancelled run picks up where it stopped.
- **Many languages, detected automatically.** Parakeet covers 25 European languages; Nemotron 3.5 covers Vietnamese, Japanese, Korean, Hindi, Arabic, Mandarin and more.
- **Gentle on your laptop.** Processing runs at macOS background priority and pauses while the Mac reports it is running hot.
- **Summaries on your terms.** Optionally, your own Hermes agent writes a speaker-aware summary and translates it when needed. This is the one step that sends transcript text (never audio) to the model Hermes is configured to use, and only when you press the button.

Recordings are stored as plain WAV and JSON files in your library folder. They are not encrypted by the app, so rely on FileVault or an encrypted volume for encryption at rest.

## Getting started

Node 22.12+ is required.

```sh
npm ci
npm run dev        # desktop app with hot reload
npm run dev:web    # browser preview
```

The browser preview supports recording, import, playback and IndexedDB storage. Local transcription, speaker separation and summaries need the desktop app and the speech runtime (see [Speech runtime](#speech-runtime)).

## Building

| Command | Output | Notes |
|---|---|---|
| `npm run build:mac` | `release/mac-arm64/Voices.app` | Bundles the local speech runtime and diarization model. Build on the Mac you target (Apple Silicon). |
| `npm run build:win` | `release/Voices-Setup-<version>-<arch>.exe` (x64 and arm64) | NSIS installer. Can be built from macOS. The speech runtime is not bundled: install a Windows build of NeMo-Speech.cpp and choose it and the diarization model in Settings. |
| `npm run build:web` | `dist-web/` | Static site for any web host; `npm run preview:web` serves it locally. Recording, import and playback only. |

Builds are unsigned. macOS builds are not notarized, and Windows builds show a SmartScreen warning until they are code-signed.

Windows notes: imports that macOS converts on disk are decoded in the app instead (150 MB / one hour limit), processing runs at low process priority, and thermal pausing is macOS-only.

## Where data is stored

By default the recording library, settings and speech cache live in the standard app-data folder:

- macOS: `~/Library/Application Support/Voices`
- Windows: `%APPDATA%\Voices`

To keep them elsewhere (for example on an external drive), create `location.json` in that folder:

```json
{
  "dataDirectory": "/path/to/Voices",
  "modelDirectory": "/path/to/models"
}
```

`VOICES_DATA_DIR` overrides `dataDirectory`, and `NEMO_SPEECH_MODEL_DIR` overrides `modelDirectory`. If the configured folder's drive is disconnected, Voices says so and exits instead of creating a new, empty library. Packaged apps download speech models into `<dataDirectory>/models` unless `modelDirectory` is set; development runs use `.runtime/model-cache/models`.

Build-machine settings such as Electron download caches go in an untracked `.env.local` (copy `.env.example`); `scripts/package.mjs` and `scripts/setup-runtime.sh` read it.

## Features

- Microphone recording with pause/resume, input waveform, and local WAV storage
- Audio import (WAV, MP3, M4A/AAC, AIFF, FLAC and more via macOS; WebM/Ogg via Chromium) up to 8 hours
- Playback, waveform seeking, 15-second jumps, and variable playback speed
- Renaming, favorites, search, reversible deletion, and audio export
- Speaker-colored transcript passages for up to 8 speakers, editable speaker names, speaker filtering, and transcript search
- Automatic language detection or a chosen language; the detected language is shown on each transcript
- Live transcription progress with text appearing piece by piece, cancel and resume
- Click a transcript passage to seek to its timestamp
- Speaker-aware summaries and translation through your local Hermes agent
- Export transcripts as text or JSON, and summaries as Markdown
- Explicit *Overlapping voices* and *Unassigned* labels instead of guessed attribution

The sample transcript is clearly labeled illustrative and contains no playable recording. Real transcripts are only created by the speech engine.

## Speech pipeline

1. Imports are converted on disk with macOS `afconvert` to 16 kHz mono PCM16 WAV (WebM/Ogg and microphone audio are decoded in the window instead).
2. The recording is split into ~5-minute pieces (the unit of progress, caching and resume), and each piece into ~15-second utterances, all cut at the quietest point near each boundary. Each piece's utterances are recognized in one batch run (one model load, `--no-warmup`). Longer inputs made the models stop emitting words partway: on a Vietnamese lecture, 5-minute inputs gave 610 words for 12 minutes of continuous speech, 15-second utterances gave 2,687.
3. With **Automatic** language (the default), 45 s of speech is run through Nemotron 3.5 ASR with `--language auto`; the detected locale is then passed explicitly to every piece. A language can also be chosen in Settings.
4. Each piece is transcribed with `nemo-speech transcribe <piece> --format json`: Parakeet TDT v3 for its 25 European languages, Nemotron 3.5 ASR (`--language <locale>`) for everything else, including Vietnamese. Text appears in the app as each piece finishes; finished pieces are cached under `<data>/cache` so a cancelled run resumes.
5. `nemo-speech diarize <audio> --model Nemotron-3-Diarization.q8_0.gguf --format rttm` runs once over the whole recording in streaming mode (up to 8 speakers, consistent labels across the file).
6. Word midpoints are aligned to speaker intervals. Multiple active speakers become **Overlapping voices**; unmatched words become **Unassigned**.

All engine runs use macOS background priority (`taskpolicy -b`) and are paused (SIGSTOP) while macOS reports a *serious* or *critical* thermal state. Measured on this Mac per 5 minutes of audio: Parakeet ~37 s / ~0.95 GB, Nemotron 3.5 ~60–80 s / ~1.9 GB, diarization ~19 s / ~0.27 GB.

Nemotron separates anonymous voices, not real-world identities. Names are provided by the user and scoped to a recording. Overlapping speech is not source-separated; attribution is deliberately uncertain. Imports are limited to 2 GB and eight hours (150 MB and one hour for formats decoded in the window); microphone sessions stop automatically before the one-hour limit. NVIDIA reports ~11% word error rate for Vietnamese with Nemotron 3.5, so transcripts are good for reading and search but not verbatim.

## Summaries with Hermes

The **Summary** tab asks your local [Hermes Agent](https://github.com/NousResearch/hermes-agent) (`~/.local/bin/hermes` by default, changeable in Settings) for a speaker-aware summary, optionally translated. The prompt lists each speaker label with its user-given name and talk time, explains *Overlapping voices* and *Unassigned*, and asks for overview, participants, key points with timestamps, decisions and open questions. It runs:

```sh
hermes chat --query-file prompt.txt --oneshot --quiet --toolsets todo --ignore-rules
```

Only transcript text is sent, to whichever model Hermes is configured to use (which may be a cloud provider). One-shot mode bypasses Hermes approvals, and an empty `--toolsets` falls back to all CLI tools, so the app always passes the harmless `todo` toolset; the transcript is marked as data, not instructions. `--ignore-rules` keeps personal SOUL/memory/AGENTS.md injections out of the summary. Summaries are saved with the recording and export as Markdown.

## Speech runtime

The published NeMo-Speech.cpp 0.1.0 binary was tested and rejected the new model (`pre_ln transformer variant is not supported`). This project therefore uses a source build of NVIDIA/NeMo-Speech.cpp at commit `97a15afa5caa9bce5baaa86c1184103877af4101`, built with the `metal-asr` preset. The native engine is in `.runtime/nemo-v3`; the GGUF is in `.runtime/models`. Parakeet and Nemotron 3.5 ASR are cached in `.runtime/model-cache/models`.

Use the setup script to reproduce that runtime on Apple Silicon. It requires CMake, Ninja, SentencePiece, Abseil, Git, and Xcode command-line tools, and about 6 GB free. Downloads and build trees go under `.runtime/` (untracked).

```sh
bash scripts/setup-runtime.sh
npm run build:mac
```

`build:mac` copies native libraries and their licenses into the app, rewriting Homebrew library references to bundled copies. The diarization model is bundled; Parakeet and Nemotron 3.5 ASR download into the model directory on first use. `VOICES_ENGINE` and `VOICES_MODEL` override the engine and diarization model paths, and Settings offers file pickers for both.

## Verification

```sh
npm test
npm run test:e2e
node scripts/electron-smoke.mjs
node scripts/electron-smoke.mjs --packaged
```

Browser tests use the existing Chrome installation, including a simulated microphone. The Electron smoke test imports NVIDIA's 60-second AMI sample, runs the real models, and checks speaker renaming. That sample produced 133 words, three speaker labels, and three overlap passages in the local CLI verification. These are integration checks, not accuracy benchmarks. Hardware microphone quality and broader language/meeting accuracy still need evaluation.

## Sources and licenses

- [NVIDIA Nemotron diarization guide](https://huggingface.co/blog/nvidia/nemotron-diarization)
- [Nemotron 3 model and license](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp)
- [Parakeet TDT v3 model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [Nemotron 3.5 ASR model card](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)

The native runtime carries its upstream Apache-2.0 and third-party notices. Model use is subject to the respective model licenses (Nemotron 3 Diarization and Nemotron 3.5 ASR: OpenMDW 1.1; Parakeet: CC-BY-4.0).

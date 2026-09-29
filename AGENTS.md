# Agent notes

- Large or machine-specific files never go in tracked paths. The speech runtime, source checkouts, models, caches and test data live under `.runtime/` (ignored); build output goes to `dist/`, `dist-web/` and `release/` (ignored).
- Machine-specific settings live in untracked files: `.env.local` (build and download caches, read by `scripts/package.mjs` and `scripts/setup-runtime.sh`) and `location.json` in the app-data folder (library and model locations). Read `.env.local` before downloading, installing or building, and put caches where it says.
- Never commit recordings, transcripts, screenshots of transcripts, or models. `test-results/` and `.runtime/` can contain real user audio and text.

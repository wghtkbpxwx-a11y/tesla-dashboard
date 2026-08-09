# Companion — Session vault

PIN-gated companion web app for Tesla drive mode, served from the same GitHub Pages site as the dashboard.

**Live URL:** https://wghtkbpxwx-a11y.github.io/tesla-dashboard/companion/

**Launch:** Dashboard → Settings → **Session vault** (mid-settings row). This entry is intentionally **not** on the Live screen or Apps menu.

## Public boundary

This folder is the **public shell only**. Safe to commit:

- `index.html`, `styles.css`, `app.js`, `sync.js`
- `data/venues.json` (public Metro Vancouver venue pins)
- This README

**Never commit** to this public repository:

- `companion-memory-sync.json` or any exported personal vault
- GitHub PATs, API keys, chat transcripts, or photos
- iOS/Mac/Swift companion source (lives in the private `companion` repo)

## Behaviour

- **PIN gate:** 4-digit PIN (default `0000`), changeable in Settings. Stored as a simple hash in `localStorage` (`companion_pkg_v1`).
- **Tabs:** Universe (venue pins + offline scenes), Feed, Chats, People, Settings.
- **Chat:** Cloud API via OpenRouter / OpenAI / xAI / custom OpenAI-compatible endpoint, **or** offline scene lines when no API key is set. No on-device LLM.
- **Voice (optional):** Feature-detects `getUserMedia({ audio: true })` + `MediaRecorder`. If unavailable, shows a locked hint (Tesla 2026.26+ AMD cabin mic). When available, records audio and posts to a Whisper-compatible `/audio/transcriptions` endpoint. TTS uses `speechSynthesis` when present.
- **Vault sync:** Optional private GitHub Gist for `companion-memory-sync.json` — gist ID + token stay in browser `localStorage` only.
- **Import/export:** Paste-based JSON (file pickers are unreliable in the Tesla browser).

## Tesla browser notes

- Classic scripts only (no ES modules)
- System fonts only
- No `<select>` elements — chip/button UI throughout
- Large touch targets (~56px)
- Body scrolls; back link returns to `../` (dashboard root)

## Source of truth

When the private `wghtkbpxwx-a11y/companion` repo is available, copy allow-listed files from `web/tesla/` on branch `recover/grok-sims-1.31.4` into this folder. The public repo should remain a thin, credential-free shell.

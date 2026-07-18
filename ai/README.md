 # Homebase

Dashboard-first personal OS with floating AI chat, live widgets from the Tesla Dashboard cache, connectors, and encrypted Drive vault.

# Homebase

Personal AI hub (formerly Nova) for David — chat, agents, connectors, and an encrypted Google Drive vault.

# Homebase — multimodal AI chat (`/ai/`)

A self-contained, dependency-free AI chat app served from this repo's GitHub
Pages site at **`…/tesla-dashboard/ai/`**. One HTML file, no build step, no
backend — everything (keys, chats, memory, tasks) lives in your browser and is
sent only to the AI provider you pick.

**Quick links:** `ai/` opens the chat · `ai/?voice=1` opens straight into
voice mode (this is what the dashboard's **More → 🎙️ Homebase Voice** button uses).

## Providers

| Type | Providers |
|---|---|
| Cloud (bring your own key) | Anthropic Claude, OpenAI, Google Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI Grok |
| Local server | Ollama, LM Studio, llama.cpp — plus any custom OpenAI-compatible endpoint (vLLM, LiteLLM, Together…) |
| In-browser | WebLLM (WebGPU) — Llama 3.2, Qwen 2.5, Gemma 2, Phi 3.5, SmolLM2; fully private, works offline after the one-time download |
| No setup | Demo mode — simulated model to explore the UI |

Add a dedicated, low-limit key in **Settings → Providers** (stored in
`localStorage`, never sent anywhere except the provider itself). Do not use
this feature on a shared device or commit keys to source control. Each provider
has a **Get API key** shortcut, **Test connection**, and, where supported,
**Fetch model list**; any model id can also be typed into the model-picker
search and used directly.

### Local model setup notes

- **Ollama** — allow the page's origin once, then restart Ollama:
  macOS `launchctl setenv OLLAMA_ORIGINS "*"` · Windows `setx OLLAMA_ORIGINS "*"` ·
  Linux: add `Environment="OLLAMA_ORIGINS=*"` to the systemd unit.
- **LM Studio** — Developer → Start server, enable CORS (port 1234).
- **llama.cpp** — `llama-server -m model.gguf --port 8080` (CORS is on by default).
- **WebLLM** — needs WebGPU (Chrome/Edge 113+); pick a model in Settings →
  Providers → WebLLM and hit *Load model now*.

## Live dashboard modules

Refresh (top-right) pulls **Tesla Dashboard hourly cache** plus **browser live APIs**:

| Widget | Source | Sign-in / setup? |
|---|---|---|
| Weather | Open-Meteo (+ AQI) live | No — set location in Connectors → Weather if not Surrey |
| Markets | Yahoo if browser allows, else cache | No |
| News / Clinical | Dashboard cache (RSS) | No |
| My teams | ESPN scoreboard API live | No |
| Traffic | DriveBC cam images + incidents from cache | No |
| Calendar | Google **secret iCal URL** | **Yes — paste iCal in Connectors** (no Google OAuth for calendar) |
| Finances | Browser-local finance web app + validated private bundle | **Import in Finance**; Homebase updates automatically on the same device (balances never on Pages) |
| Rituals / Memory / Pins / Tools | Local browser state | Memory **Drive vault** needs OAuth Client ID + Google sign-in |
| Banks / Monarch / CPS etc. | Deep-links only | Sign in on those sites when you open them |

Agent can pin notes and toggle widgets via `update_dashboard` / speech.

## Features

- **Model Council (optional)** — fan a prompt to 2–5 models in parallel, then synthesize a consensus answer. Toggle ⚖️ in the top bar or `/council`. Configure members in Settings → Council.
- **Agent mode** — multi-step tool loop (configurable rounds), `create_plan` / `update_plan_step`, `research`, memory CRUD, `run_js` sandbox. Personas: Agent & Researcher. `/agent` enables tools + agent persona.
- **Neural Memory** — categorized, importance-ranked, pinned facts with smart relevance injection, search/filter UI, auto-extract, and agent tools (`search_memory`, `remember`, `update_memory`, `forget_memory`).
- **Chat** — streaming responses, markdown + syntax-highlighted code with copy
  buttons, tables, stop/regenerate/edit-and-resend, branch a chat from any
  message, pin/search/rename chats, per-chat model + `/sys` prompt, token and
  ~cost estimates, export a chat as Markdown, full JSON backup/import.
- **Multimodal** — images (upload, paste, drag-drop, camera) to vision models;
  PDFs natively to Claude / Gemini / OpenAI; text/code files inlined; voice in
  and out.
- **Voice mode** — cinematic neural voice UI (rings, particle field, waveform bars) with hands-free listen → think → speak. Tap the orb to interrupt. Browser speech APIs; optional OpenAI Whisper + TTS (Settings → Voice).
- **Agent tools** (wrench or `/tools`) — weather, web search, page reader, Wikipedia, calculator, clock, research (search+read), news, plan tools, memory CRUD, `run_js` sandbox, schedule tasks. Inline tool cards + plan board.
- **Memory** — neural memory store with categories, importance, pins, search, smart injection, and auto-extract. 🧠 panel or agent tools.
- **Scheduled tasks** — daily / weekly / every-N-minutes / one-off prompts
  that run automatically, post results to a dedicated ⏰ chat and fire a
  browser notification. The model can create these itself ("remind me every
  morning at 8 to…"). Runs while a Homebase tab is open; missed runs are caught
  up on the next visit (toggleable per task).
- **Personalization** — dark/light/system theme, accent colors, font size,
  personas (incl. a pharmacist clinical mode), default system prompt,
  temperature / max tokens / extended-thinking toggle.

## iOS / phone

Open the URL in Safari → Share → **Add to Home Screen**: Homebase installs as a
full-screen app (custom icon, safe-area aware, no zoom-on-focus). Long-press
the icon (Android/desktop PWA) for a direct **Voice mode** shortcut. Voice
mode works with Safari's speech APIs; the OpenAI voice engine is a drop-in
upgrade if a key is present.

## In the car

The dashboard's **More → Apps** menu has **✦ Homebase AI** and **🎙️ Homebase Voice**
buttons. Heads-up: Tesla's browser blocks most cross-origin requests and has
no microphone access, so in-car use is best-effort — chat may work with some
providers, voice generally won't. The buttons shine when the dashboard is
open on a phone.

## Development

Everything is in `ai/index.html`. Before committing:

```bash
# JS parses
python3 -c "import re;open('/tmp/ai.js','w').write('\n;\n'.join(re.findall(r'<script>([\s\S]*?)</script>', open('ai/index.html').read())))" && node --check /tmp/ai.js
```

An end-to-end harness (mock OpenAI/Anthropic/Gemini SSE server + headless
Chromium) exercises streaming, the tool loop for all three wire formats,
tasks, memory, persistence and the voice deep link — see the PR/session notes.

localStorage keys are namespaced `nova_*`; conversations live in IndexedDB
(`nova_chat`) so they never compete with the dashboard's localStorage quota.


## Encrypted memory vault (Google Drive)

Personal memory is stored locally for speed, then optionally synced as an
**encrypted vault** to Google Drive (AES-GCM, passphrase never uploaded).

1. Google Cloud Console → create OAuth 2.0 Client ID (Web application).
2. Authorized JavaScript origin: `https://wghtkbpxwx-a11y.github.io`
3. Connectors → Google Drive → paste Client ID, enable auto-sync.
4. Memory → Private vault → set passphrase → Connect Google → Push to Drive.

On a new browser: same Client ID + passphrase → Pull from Drive.

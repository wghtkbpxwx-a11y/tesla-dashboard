 # Homebase

Dashboard-first personal OS with floating AI chat, live widgets from the Tesla Dashboard cache, connectors, and encrypted Drive vault.

# Homebase

Personal AI hub (formerly Nova) for David — chat, agents, connectors, and an encrypted Google Drive vault.

# Homebase — multimodal AI chat (`/ai/`)

A self-contained, dependency-free AI chat app served from this repo's GitHub
Pages site at **`…/tesla-dashboard/ai/`**. One HTML file, no build step, no
backend — everything starts in your browser. Optional client-side encrypted
Google Drive sync can carry selected configuration between your devices;
readable keys are sent only to the AI provider you pick.

**Quick links:** `ai/` opens the chat · `ai/?voice=1` opens straight into
voice mode (this is what the dashboard's **More → 🎙️ Homebase Voice** button uses).

## Providers

| Type | Providers |
|---|---|
| Direct cloud (bring your own key) | Anthropic Claude, OpenAI, Google Gemini, Groq, Perplexity Sonar, Kimi, DeepInfra, Mistral, DeepSeek, xAI Grok |
| Aggregator / fallback | OpenRouter — manual, free/long-tail, or Auto failover after direct providers |
| Voice cloud (optional) | OpenAI speech/Whisper and ElevenLabs Flash/Scribe; browser speech remains free/default |
| Local server | Ollama, LM Studio, llama.cpp — plus any custom OpenAI-compatible endpoint (vLLM, LiteLLM, Together…) |
| In-browser | WebLLM (WebGPU) — Llama 3.2, Qwen 2.5, Gemma 2, Phi 3.5, SmolLM2; fully private, works offline after the one-time download |
| No setup | Demo mode — simulated model to explore the UI |

Add a dedicated, low-limit or scoped key in **Settings → Providers** (stored in
`localStorage`, and optionally included in the client-side encrypted Google
Drive vault for phone/desktop sync). A readable key is sent only to its AI
provider, and official cloud credentials are pinned to the provider's API
origin so a modified Base URL cannot redirect them. Do not use this feature on
a shared device or commit keys to source control. Each provider
has a **Get API key** shortcut, **Test connection**, and, where supported,
**Fetch model list**; any model id can also be typed into the model-picker
search and used directly.

## Automatic model routing and rolling budget

Homebase defaults to **Auto · best value**. For every new message it:

1. detects required capabilities (fresh web data, dashboard actions,
   vision/PDF, complexity, and
   high-stakes clinical/financial/legal context);
2. uses a recently verified local server or in-browser WebLLM for simple work;
3. when cloud quality is required, filters out models below the task's quality
   floor, prefers direct provider APIs, and selects the lowest estimated-cost
   suitable direct model; OpenRouter is considered only as fallback;
4. raises the quality floor when the prompt names a model or says things such
   as “use your most advanced model” or “maximum quality.”

The default paid-cloud guard is **$50 across the trailing 30 days**, combined
across all configured providers. It reserves a conservative maximum before
each call (including concurrent Council calls), records the provider's token
usage afterward, and continuously releases entries as they become 30 days old.
OpenAI Whisper/TTS and ElevenLabs Flash/Scribe are included; Perplexity Sonar
reserves its per-request search fee as well as token cost. Local models and
browser speech cost $0. Unknown-price cloud models are blocked while the hard
guard is enabled. The tracker and controls are in **Settings → Chat**, and every reply
shows the selected model, route reason, tokens, and estimated cost.

When encrypted cross-device sync is enabled, usage events are merged by ID
through the private Drive vault, so phone and desktop contribute to the same
Homebase estimate. This is still not provider billing truth.

This is an application-side estimate, not a provider billing limit. Keep
provider-side spend limits/alerts enabled too, because pricing changes, cached
tokens, special tools, taxes, failed requests, and calls made outside Homebase
may differ from the local ledger.

## Automatic specialist teams

For complex build, research, clinical, legal, and financial requests, Homebase
can automatically split the work into 2–6 independent roles and run them in
parallel. A dashboard build normally uses Architecture, Product & UI, Data &
Connectors, and Implementation & QA. Research tasks use evidence, domain, and
safety reviewers. Each role receives a narrow read-only tool allowlist and the
least expensive ready model that meets its quality floor; local models are used
for suitable roles, while advanced cloud models are reserved for roles that
genuinely need them. The lead model reconciles the handoffs and owns the final
answer or allowed action.

The message card shows every role, assigned provider/model, progress, routing
reason, and combined estimated usage. Configure this in **Settings → Chat**:
Automatic specialist teams, maximum parallel agents (default 4), and a
per-task projected cloud cap (default $1.50). All calls still share the hard
$50 trailing-30-day guard. A manually enabled Model Council takes precedence
when it has at least two configured members.

## Guarded source development

When the latest chat explicitly asks to build, update, fix, or improve the
dashboard, the lead agent can inspect the configured GitHub repository through
read-only file-list, file-read, and search tools. A source write is accepted
only as 1–12 exact, uniquely matched edits (or explicit new files), is checked
for parse errors and embedded secrets, and creates a new `homebase/ai-*` branch
plus a **draft pull request**. It never writes directly to `main`, and the user
is asked to confirm before the branch or commit is created.

Setup is in **Settings → Development**. Public repository reads need no login.
To enable draft pull requests, add a fine-grained GitHub token scoped only to
`tesla-dashboard` with Metadata read, Contents read/write, and Pull requests
read/write. The token stays in this browser and must never be committed.

### Local model setup notes

- **Ollama** — allow the page's origin once, then restart Ollama:
  macOS `launchctl setenv OLLAMA_ORIGINS "*"` · Windows `setx OLLAMA_ORIGINS "*"` ·
  Linux: add `Environment="OLLAMA_ORIGINS=*"` to the systemd unit.
- **LM Studio** — Developer → Start server, enable CORS (port 1234). On David's
  16 GB M1 Pro, the tested default is Qwen 3.5 9B 4-bit loaded as
  `homebase-local` with 16K context, one parallel prediction, and full GPU
  offload. Homebase reads LM Studio's reported vision/tool metadata and prefers
  the underlying `qwen/qwen3.5-9b` key for routine chats and Homebase function
  tools. Just-in-time loading is enabled, so the model can return after idle
  eviction; the explicitly loaded instance uses the more conservative settings.
- **LM Studio installed MCPs** — ordinary Homebase tools use the OpenAI-compatible
  endpoint. To use LM Studio's installed Brave web-search MCP, enable API
  authentication in LM Studio, create a dedicated scoped token that may call
  servers from `mcp.json`, enter it under Settings → Providers → LM Studio, then
  enable Settings → Tools → LM Studio MCP web search. Each Brave search reserves
  an estimated $0.005 against the same trailing budget. The verified Mac setup
  requires authentication, retains only the restricted Homebase token, denies
  arbitrary remote MCPs, permits installed `mcp.json` connectors, and remains
  localhost-only. A one-search live test succeeded through local Qwen without a
  paid cloud-model call. Because a full 9B tool loop can take minutes on this
  machine, Qwen 3.5 4B is the fast path for short no-tool prompts; 9B remains the
  capable local/tool path. Balanced and tool-heavy requests consider an adequate
  cloud route first, then fall back locally when cloud is unavailable or the user
  explicitly requests local/offline execution.
- **llama.cpp** — `llama-server -m model.gguf --port 8080` (CORS is on by default).
- **WebLLM** — needs WebGPU (Chrome/Edge 113+); pick a model in Settings →
  Providers → WebLLM and hit *Load model now*.

Homebase quietly probes the three standard local ports at startup and every
five minutes. A server model is eligible for auto-routing only after a recent,
successful model-list check; otherwise the router uses WebLLM or an eligible
cloud model instead of assuming the local server is alive.

## Agent changelog (hidden)

Machine-readable history for other models lives in **`HOMEBASE_CHANGELOG`** inside `ai/index.html` (also `#homebase-changelog` in the DOM, hidden from the UI, and returned by the **`list_dashboard`** tool). When you change the dashboard, **append** a new entry (newest first) and refresh `planned[]`.

This is the mandatory model-to-model handoff contract, not a release-note
summary. Before handing work to another model, document every material code,
configuration, contract, tool, routing, UI, safety, documentation, and
deployment change. Each entry must include repository lineage, files and
interfaces affected, exact behaviour, safety boundaries, verification, setup
still required, known limits, and the next-model handoff. Keep status precise:
implemented, committed, PR open, merged, and deployed/live are different states.

`current_handoff` identifies the next reviewer and the invariants/open questions
they need. Historical entries are append-only. Correct an inaccurate prior note
with an explicit correction rather than deleting provenance. The guarded
`propose_repository_changes` tool rejects source pull requests that do not also
update `HOMEBASE_CHANGELOG` in `ai/index.html`. Agents can call
`list_dashboard detail=true` for the full implementation record; the default
response is compact so smaller local models do not waste their context window.

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

- **Automatic task teams** — task-shaped parallel specialists with per-role tools, cost-aware model assignment, and lead-agent synthesis. Configure in Settings → Chat.
- **Model Council (optional)** — manually fan a prompt to 2–5 chosen models in parallel, then synthesize a consensus answer. Toggle ⚖️ in the top bar or `/council`. Configure members in Settings → Council.
- **Agent mode** — multi-step tool loop (configurable rounds), `create_plan` / `update_plan_step`, `research`, memory CRUD, `run_js` sandbox. Personas: Agent & Researcher. `/agent` enables tools + agent persona.
- **Neural Memory** — categorized, importance-ranked, pinned facts with smart relevance injection, search/filter UI, auto-extract, and agent tools (`search_memory`, `remember`, `update_memory`, `forget_memory`).
- **Chat** — streaming responses, markdown + syntax-highlighted code with copy
  buttons, tables, stop/regenerate/edit-and-resend, branch a chat from any
  message, pin/search/rename chats, per-chat model + `/sys` prompt, token and
  ~cost estimates, export a chat as Markdown, full JSON backup/import.
- **Multimodal** — images (upload, paste, drag-drop, camera) to vision models;
  PDFs natively to Claude / Gemini / OpenAI; text/code files inlined; voice in
  and out.
- **Voice mode** — cinematic neural voice UI (rings, particle field, waveform bars) with hands-free listen → think → speak. Tap the orb to interrupt. Browser speech APIs by default; optional OpenAI Whisper/TTS or ElevenLabs Flash/Scribe (Settings → Voice).
- **Agent tools** (wrench or `/tools`) — weather, web search, page reader, Wikipedia, calculator, clock, research (search+read), news, plan tools, memory CRUD, `run_js` sandbox, schedule tasks, dashboard mutation, and guarded repository read/search/draft-PR tools. Inline tool cards + plan board.
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
mode works with Safari's speech APIs; OpenAI and ElevenLabs are optional cloud
upgrades if a restricted key is present.

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

localStorage keys are namespaced `nova_*` (including `nova_cloud_usage_v1` for
the rolling cost ledger); conversations live in IndexedDB
(`nova_chat`) so they never compete with the dashboard's localStorage quota.


## Encrypted phone/desktop sync (Google Drive)

Homebase remains local-first, then optionally syncs memory, tasks, selected AI
and router preferences, and the rolling cloud-usage ledger through an
**encrypted vault** in Google Drive. Provider API keys and connector secret
fields are included only while **Sync API keys and private connectors** is on.
PBKDF2 key derivation and AES-GCM encryption happen in the browser; the
passphrase and Google OAuth access token are never uploaded inside the vault.
Turning credential sync off removes those secret fields from the next merged
vault snapshot while leaving each device's local copies intact.

1. Google Cloud Console → create OAuth 2.0 Client ID (Web application).
2. Authorized JavaScript origin: `https://wghtkbpxwx-a11y.github.io`
3. On the source device, Connectors → Google Drive → paste the Client ID.
4. Memory → Private cross-device sync → enter a strong passphrase → Connect
   Google → leave both sync toggles on → Push to Drive.
5. On the other device, use the same Client ID, Google account, and passphrase,
   then choose Pull from Drive once.

After setup, Homebase pushes local changes and checks for a newer vault when it
opens, every five minutes while visible, and when the tab regains focus. Google
browser access tokens expire, so reconnect Google when sync reports that it is
locked or disconnected. Conversations remain device-local in IndexedDB.

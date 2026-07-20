# Tesla Dashboard — Project Guide

Single-file dashboard (`index.html`, ~3000 lines) served by GitHub Pages at
https://wghtkbpxwx-a11y.github.io/tesla-dashboard/ and used in a Tesla's
in-car browser. Owner: David (Surrey/Vancouver BC, drives a Tesla, follows
Canucks/Blue Jays/Raptors/Whitecaps/BC Lions, holds XEQT/Canadian ETFs).

## Architecture — the one thing you must understand

The Tesla browser **blocks most cross-origin API calls**. Nothing may depend
on live fetches. Instead:

1. `.github/workflows/update-cache.yml` runs **hourly** (+ manual dispatch).
2. It runs `.github/scripts/update_cache.py`, which fetches news RSS, sports
   RSS, pharmacy/medicine RSS (NEJM, Lancet, JAMA, CBC Health — David is a
   pharmacist; BCPhA/PharmaCare have no RSS), weather/forecast/air-quality
   (open-meteo), ESPN team scores, Yahoo stock quotes, DriveBC webcam metadata,
   and Open511 traffic events, then rewrites the `var DASHBOARD_CACHE = {...};`
   block inside `index.html`
   (regex: `var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n` — **never break this
   marker**) and commits with `[skip ci]`. `parse_rss` handles RSS 2.0, RSS
   1.0/RDF (namespaced items, dc:date — NEJM/Lancet style) and Atom.
   Then `.github/scripts/generate_digest.py` builds `cache.digest`
   {news, sports, pharmacy} — a deduped spoken summary the audio briefing
   reads. Extractive by default; a guarded LLM polish activates only if
   DIGEST_GGUF points at a local model (small models hallucinate: measured
   Qwen 0.5B inventing a "body", 1.5B inventing an actor — every model
   sentence is overlap-checked and falls back to the raw headline).
   `validate.py` runs before the commit (the CI Validate workflow doesn't see
   `[skip ci]` commits).
3. In the browser, `httpGet()` intercepts URLs (open-meteo, rss2json,
   finance.yahoo.com) and serves from `DASHBOARD_CACHE`; uncached rss2json
   URLs fast-fail (return null) instead of hanging. `fetchCached()` layers
   localStorage TTL caching on top with an allorigins.win fallback.
4. Failed fetches in the Python script fall back to the previous cache values
   (`existing.get(...)`) so one bad run never blanks a panel.

DriveBC camera **images** are the exception: hotlinked `<img>` from
`https://www.drivebc.ca/images/{id}.jpg` (no CORS on img tags), cache-busted
with `?t=`. Only camera metadata/events live in DASHBOARD_CACHE.

## Tesla-browser rules (learned the hard way)

- **Only the document scrolls.** Never use inner `overflow-y:auto` divs for
  primary content — Tesla touch can't reach them. Body scrolls; header is
  `position:sticky`; feed boxes are natural height.
- **The on-screen keyboard covers the bottom half.** Anything with a text
  input must live in the top half (stocks dropdown is `top:76px` for this).
- **No iframes for external sites** — most send X-Frame-Options deny. All
  links are plain `target="_blank"`.
- **Big touch targets**: 48px+ buttons, 19px menu text, 62px app icons.
- Clock/date strings may contain narrow no-break spaces (U+202F) — beware
  exact-match edits in `updateClock()`.
- `var` + function hoisting everywhere; script is one inline block; run
  `node --check` on extracted script before committing (see Verification).

## Git / PR workflow quirk

PRs are **squash-merged**. After each merge the working branch
(`claude/news-sports-weather-bug-0a1io5`) must be **restarted from main**
(`git checkout -B <branch> origin/main`, cherry-pick or re-commit the new
work, `push --force-with-lease`) or the next PR will show already-merged
commits and hit DASHBOARD_CACHE conflicts. The hourly cache commits on main
make conflicts likely if the branch lives long — keep PRs short-lived.

## Verification before every push (all have failed at least once)

```bash
# 1. JS parses
python3 -c "import re;open('/tmp/check.js','w').write('\n'.join(re.findall(r'<script>([\s\S]*?)</script>', open('index.html').read())))" && node --check /tmp/check.js
# 2. Cache marker + JSON valid
python3 -c "import re,json;json.loads(re.search(r'var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n', open('index.html').read()).group(1))"
# 3. Python compiles
python3 -m py_compile .github/scripts/update_cache.py
```

After merging: **verify the Pages deploy actually landed** — it fails
transiently ("Deployment failed, try again later"). Poll the live URL for a
string unique to the new version; if the pages-build-deployment run failed,
re-run its failed jobs. Never assume a merge means it's live.

Known runner issue: `www.drivebc.ca` **times out from GitHub runners**
sometimes. `fetch_cameras()` retries 20/30/45 s; on total failure the cached
camera list is reused and fresh events still attach via stored lat/lon.

## Feature map (all in index.html)

- **Voice orb** (`#dash-orb`, last child of `#s-right` in the sticky header, so
  it stays top-right on scroll and **never** covers a module — the earlier
  "big red centre panel" was the bug David reported). Tap = hands-free voice
  mode toggle; **hold ≥550 ms** = play the full audio briefing (a gesture, not a
  new button). Fully cache-driven (no live API): where a mic exists (a phone)
  `SpeechRecognition` routes keyword commands to spoken answers built from
  `DASHBOARD_CACHE.digest`/weather/forecast/stocks via `speak()`
  (speechSynthesis); where there's no mic (the Tesla browser) a tap falls back
  to the audible MP3 `briefingToggle()`. Animated `<canvas id="dash-orb-cv">`
  energy orb (idle = CSS conic glow, active = reactive ring; honours
  reduced-motion). **Theme-cohesive**: `applyOrbTheme()` derives the orb's whole
  palette (`--orb-1/2/3`, `--orb-rgb`, `--orb-rgb2`, canvas `accentHue`) from the
  live `--accent`, re-tinting via a `MutationObserver` on `<html>` when the theme
  or accent preset changes — so it matches teal/sunset/lavender/etc. in light or
  dark. `#dash-orb-cap` is the fixed top-right transcript/state pill
  (right-aligned, `pointer-events:none`). Commands: briefing, weather, news,
  sports, pharmacy, stocks, time, panel nav, and "open Homebase" →
  `ai/?voice=1`. Guarded by `check_dashboard_orb()` in `validate.py` (must stay
  in the header, cache-driven, toggleable, with the briefing fallback).
- **Embedded Homebase** (`openHomebase(path)`/`closeHomebase()`, `#hb-embed`
  overlay + `#hb-frame` iframe): the command-bar **Briefing**/**Homebase**
  buttons and the orb's "briefing"/"open Homebase" commands open Homebase voice
  mode in a **same-origin iframe overlay** (`allow="microphone"`) so you never
  leave the dashboard — Briefing loads `ai/?voice=1&brief=1` (David: "open voice
  mode in Homebase without actually leaving the dashboard"). `openHomebase`
  rewrites `ai/?…` → `ai/index.html?…` for the frame so it resolves without a
  directory index. Close blanks the frame (releases mic/audio). Same-origin, so
  the "no iframes for external sites" rule doesn't apply. The orb's own tap =
  cache voice is unchanged; its no-mic fallback keeps the local MP3 briefing.
- **Live panel**: greeting, clock/date, weather hero, freshness chip (green
  <6 h / yellow <24 h / red older, tap = reload), 5-day forecast strip,
  stock chips (watchlist, seeds 4 tickers), markets strip (^GSPTSE ^GSPC
  ^IXIC CADUSD=X), news tabs (local/national/world), My Teams scores,
  fantasy links.
- **Traffic**: 4 cams/page swipeable pager + Prev/Next + page indicator;
  star up to 4 favourites → pinned to page 1 (`cam_favs_v1`); per-cam
  DriveBC events (2 nearest ≤8 km, incidents/MAJOR first) with severity dot
  + "Updated <date, time>"; Port Mann (275/292) + Pennask (251) included
  even when flagged stale (`always` set in fetch_cameras, "delayed" badge).
  Coquihalla/Connector cams: 685, 686, 2, 161, 58, 251, 41, 497.
- **Weather**: current conditions + feels-like/humidity/wind/AQI/UV chips,
  7-day grid (Today highlighted, precip %), sunrise/sunset, stamp.
- **Productivity** (merged Capture+Tasks+Timer panel, data-p="cap"):
  notes + dictation + Copy-all, tasks (active-first, confirm on Clear Done,
  Copy-all), timer (presets, +5, beep, persists via `timer_end_v1`),
  calculator, unit converter.
- **Games**: Wordle (daily word), 2048 (swipe/arrows), Canucks Shootout
  (canvas, tap-to-shoot, goalie speeds up per goal), Trail Monsters
  (original Pokémon-style catcher, 12 creatures, rarity weights,
  collection in `monsters_v1`). Boards sized for the car screen.
- **Stocks dropdown** (top-anchored): substring search w/ prefix priority
  over `commonStocks` (includes XGRO/VGRO/XBAL/VBAL/ZSP/XIC + more);
  6 popular ETFs are in the hourly pre-fetch (`DEFAULT_STOCKS`); uncached
  tickers show "No cached price yet — updates hourly".
- **Menu**: dock (Live, Messages, More, Settings) + grouped More submenu
  (Info / Tools / Apps, 2-col grid, 19px items). Drag-and-drop reorder,
  order in `dock_order_v1` — `applyDockOrder()` must preserve non-data-p
  elements (the More button) or it vanishes.
- **Settings**: theme modes/presets/custom accent (`--accent-soft` derived
  in `applyColors()`), module toggles, confirm-guarded reset.

## localStorage keys

`dash_settings_v1`, `dock_order_v1`, `bookmarks_v1`, `tasks_v1`, `notes_v4`,
`quick_links_v1`, `stocks_watchlist_v1`, `stocks_shares_v1` (share counts →
portfolio total), `cam_favs_v1`, `timer_end_v1`, `monsters_v1`,
`geo_coords_v1`, `last_error_v1`, plus feed caches (`n_*`, `s_*`, `wx*`,
`stk_*`). `saveLS()` evicts feed caches on QuotaExceededError.

## Critterra (creature game) roadmap (for the next session)

Renamed Trail Monsters -> **Critterra**; trainer is **Bree** (pixel sprite,
`drawBree()`), capture items are **Capsules** (original teal/gold design,
`monDrawCapsule()`), creatures are **Critters** (still emoji-faced, original
names). Battle is now an animated `<canvas id="mon-battle-canvas">` scene
driven by a requestAnimationFrame loop reading `monB` (state) + `monView`
(animation): sliding intro, HP boxes with tweened bars, attack lunge +
flash + shake, and a full capsule throw -> suck -> drop -> wobble ->
catch/break animation with a star burst. Type chart in `MON_EFF` / `monEff()`
(move 2 = the Critter element w/ 1.25x STAB + effectiveness; move 1 neutral).
`monBusy` gates input during animations (dims `#mon-controls`). Trainer
select (3 trainers, `mon_trainer_v1`, `drawBree(pal)`) precedes starter
select; `monResetGame()` clears all keys. Battle HP: trainer LEFT / wild
RIGHT. Caught Critter stays in the Capsule (`rest` phase, idle bob).
Catch odds rise as wild HP AND level drop. Keys: `monsters_v1`,
`mon_party_v1`, `mon_started_v1`, `mon_trainer_v1`.

v4 shipped: **evolutions** at Lv.10 (`EVO_LEVEL`, `EVO_NAMES`, `monIsEvolved`,
`monName(idx,lvl)` — use it for any displayed name; sprites get aura+crown via
`drawCritter(...,evolved)`, +12 HP in `monMaxHp`), **battle-partner picker**
(tap a caught Critter in the Critterdex, `mon_active_v1`), and **sound**
(`monSfx(kind)` WebAudio chip effects, 🔊/🔇 button, `mon_sound_v1`).

v3 shipped: second area — **Crystal Cave** (`MON_CAVE`, `monArea`
'field'|'cave', `monMapData()`), reached via a cave mouth 'C' on the
field's right edge; cave has stronger encounters (`caveSet`, +2 levels)
and a boss altar 'B'. Boss **Terravore** is `MONSTERS[12]`/`CRDEF[12]`
(excluded from the collectable set via `TOTAL=12`); stepping on 'B' with
all 12 caught starts `monBoss()` (can't be captured). Beating it →
`monShowChampion()` ceremony (confetti + trophy + trainer on
`#mon-champ-canvas`, `mon_champion_v1`). Animation loops are now
on-demand: `monLoopStart`/`shootLoopStart`/`monChampStart` gate rAF to
visibility (no idle CPU when the Games panel is closed).

v2 shipped: tile overworld (15×10, `MON_MAP` strings: `.` walk, `,` tall
grass w/ 22% encounters, `T`/`~` block, `=` path), D-pad + arrow movement,
turn-based battles (2 moves each, strong move 15% miss, enemy scales with
level), catching, level-ups (+1 lvl per win, HP = base + 4/lvl), persistent
party (`mon_party_v1`: idx→level) and collection (`monsters_v1`). Starter is
Sparkit Lv.3, auto-granted. All creatures are ORIGINAL — never use Nintendo
names/designs; mechanics in the classic style are fine.

Natural extensions, in rough order of value:
1. Multiple map areas (beach/mountain/cave) with different encounter pools —
   add exits at map edges, an `AREAS` array of map-strings + pool weights.
2. Type effectiveness (each creature gets a type; 2× / 0.5× multipliers).
3. Party picker in battle (switch active creature instead of highest-level).
4. A rival/NPC battle at a fixed map tile; healing "camp" tile.
5. Evolutions at level thresholds (new emoji + name per stage).
6. Sound via the existing WebAudio beep pattern (timerBeep is the template).

## Homebase AI chat (`ai/`)

Separate single-file app at `ai/index.html` (own README in `ai/`), served by
the same Pages site. Multi-provider BYOK chat (Anthropic/OpenAI/Gemini/Groq/
Perplexity/Kimi/DeepInfra/Mistral/DeepSeek/xAI, OpenRouter fallback,
Ollama/LM Studio/llama.cpp/WebLLM + demo),
voice mode (`ai/?voice=1` deep link), agent tools, memory, scheduled tasks.
Voice deep links must wait for one explicit user tap before capture so mobile
Safari authorizes both microphone input and later audio output. Preserve
`chooseVoiceTranscript` interim-result recovery, the `TTSQ.blockedText`
one-tap replay path, visibility pause/resume, and the device-only no-spend mode.
Automatic voice tries free device speech first; only after a real device failure
may it choose the least-expensive ready cloud voice route (xAI first, then a
modality-specific OpenAI/ElevenLabs order), with every fixed speech/transcription
estimate reserved in the same trailing-30-day ledger. Official provider keys remain pinned to their
official API origins. Do not claim Tesla hardware microphone support: the
dashboard launches Homebase Voice, but the in-car browser may not expose a mic.
All credential fields must update `S.keys` on `input` for immediate tests and
requests, call the debounced `persistKeys()` so nonstandard input paths survive
reloads, and retain the `change` handler for an immediate final `saveKeys()`;
do not reintroduce provider-specific stale-key or change-only persistence.
On `body.is-mobile`, Settings uses one 44 px plain-language section selector and
an independently scrolling `.mo-body`. Preserve progressive disclosure: everyday
choices visible, technical controls expandable, and no capability removed. The
model picker defaults to Automatic with individual models behind an explicit
advanced reveal. Never auto-start a large WebLLM download on mobile; keep browser
models manually selectable.
Chat defaults to a capability-gated, cost-effective auto router: verified local
models/WebLLM for simple requests; the cheapest configured direct cloud model
meeting the task quality floor for harder requests; OpenRouter only after
direct providers as free/long-tail/failover; explicit “most advanced”/named-model
prompts raise the floor. Freshness and mutation/tool requirements are classified
separately so Perplexity native search does not receive Homebase mutation tools.
Automatic calls must keep the central `runChat` failover contract: skip
unconfigured or cooling-down providers, release failed reservations, and try the
next least-cost eligible provider only when no visible partial response has been
emitted. Quota/auth/rate-limit/outage failures may cool down a provider for the
current runtime; editing or successfully testing its key clears that state.
Manual model choices remain terminal and must never be silently rerouted. Keep
the bounded real-provider attempt cap and honest Demo last resort for ordinary chat so missing keys
or exhausted credits cannot leave Automatic mode stuck in a repeat-error loop.
The composer `query-model-select` is intentionally transient: an exact **Next**
selection applies to one user message, is recorded on that message for
regeneration, suppresses automatic teams/Council/failover for the turn, and then
resets without changing `autoRoute` or the persistent conversation model. Only
ready providers and local/browser runtimes belong in this compact native picker;
the searchable header model menu remains the complete persistent expert surface.
LM Studio is the preferred local runtime on the 16 GB M1 Pro. The tested
`homebase-local` alias is Qwen 3.5 9B 4-bit at 16K context and one parallel
prediction; the stable routing key is `qwen/qwen3.5-9b`, with LM Studio
just-in-time loading as the post-eviction fallback. Trust discovered model capability metadata; do not assume every
fetched model supports tools. The optional LM Studio Brave MCP requires a
scoped local API token and counts an estimated $0.005/search in the ledger. The
verified baseline requires authentication, keeps only the restricted Homebase
token, denies arbitrary remote MCPs, permits installed `mcp.json` connectors,
and remains localhost-only. The live one-search test used local Qwen, invoked
Brave exactly once, and did not use a paid cloud language model.
Treat Qwen 3.5 4B as the fast local model for short no-tool prompts and Qwen 3.5
9B as the capable local/tool model. Balanced and tool-heavy tasks consider the
lowest-cost adequate cloud route before the local fallback unless the user asks
for local/offline execution; preserve that latency-aware ordering.
A hard estimated $50 trailing-30-day combined cloud
budget is stored in `nova_cloud_usage_v1`, reserves concurrent calls, and also
tracks OpenAI and ElevenLabs premium speech/transcription plus fixed provider
request fees where known. Unknown-price cloud models are
blocked while the guard is enabled. Treat this as an app estimate, not provider
billing truth; preserve the Settings → Chat tracker and per-reply route reason.
Complex requests may create automatic task-shaped teams (normally architecture,
product/UI, data/connectors, and implementation/QA). Role prompts and tool
allowlists are intentionally bounded; sub-agents are read-only, models are
selected independently by quality floor and estimated cost, and only the lead
agent may perform allowed mutations. Preserve `autoDelegate`, `maxSubagents`,
`teamBudgetUsd`, `buildAutoAgentTeam`, and the central `runChat` budget
reservation path when changing this flow.

Homebase source-development tools read/search the configured public GitHub repo
and can create exact multi-file edits only on a new `homebase/ai-*` branch plus
a draft PR after an explicit source-change request and browser confirmation.
They reject secrets, protected paths (including `.github/workflows`), ambiguous
replacements, and parse-invalid HTML/JSON. Never weaken these guards or add a
direct-to-main write path. GitHub setup lives in Settings → Development; tokens
remain browser-local in connector storage.

## Mandatory Homebase model handoff

`HOMEBASE_CHANGELOG` in `ai/index.html` is the canonical cross-model work log.
Every model/session must read `current_handoff` and the newest entries before
scoping or editing. Before handing off any material code, configuration,
contract, tool, routing, UI, safety, documentation, or deployment change:

1. append or update the newest changelog entry;
2. record commit/branch/PR and honest implementation/merge/live state;
3. list files, settings/interfaces, exact behaviour, guards, verification,
   setup, known limits, and dependencies;
4. update `current_handoff` for the next model; and
5. preserve prior entries, correcting inaccuracies explicitly instead of
   deleting history.

The guarded repository writer enforces an `ai/index.html` changelog edit in
every source PR. Do not bypass that requirement.
The next full architecture/security audit must start at `FABLE_AUDIT_BRIEF.md`.
Treat its “already verified” section as a context-saving index: do not repeat
those checks without contradictory evidence, but verify source before changing a
boundary. Prioritize deterministic tests and P0/P1 risks over copy, formatting,
provider expansion, framework migration, or another broad visual pass.
Dashboard More→Apps has "✦ Homebase AI" / "🎙️ Homebase Voice" `data-href` submenu
buttons (no `data-p` — the submenu click handler and drag-to-dock skip them).
The Live/Charging ChatGPT actions and the AI & Research ChatGPT tile were also
replaced with `ai/?voice=1`; do not reintroduce an external ChatGPT launcher.
Homebase retains legacy `nova_*` localStorage keys + IndexedDB `nova_chat` — do not collide.
`nova_vault_sync_v2` tracks per-device sync metadata and per-section timestamps.
The Google Drive vault is schema v2 and may contain memory, tasks, selected AI
settings, `nova_cloud_usage_v1` events, and (only when `drive.syncSecrets` is
enabled) API keys/private connector fields. It is PBKDF2/AES-GCM ciphertext;
the passphrase is session-only and `nova_drive_auth_v1` OAuth tokens stay local.
Push must merge/decrypt the remote vault first and abort on a decrypt/download
failure—never weaken this to blind last-write-wins. Background pull/push must
not intentionally open OAuth UI. Conversations remain device-local IndexedDB.
It is NOT cache-driven; it does live API calls, so in-car it's best-effort
(phone/desktop is the target). Verify with the same extract-scripts +
`node --check` recipe (its README has the one-liner). PWA bits: `ai/manifest.webmanifest`,
`ai/icon-*.png`, apple-touch meta in `ai/index.html`.

## Pederson Finances (`finance/`)

Installable, data-free web-app shell at `/finance/`. It accepts a private
`pederson.finance_webapp_bundle.v1`, `homebase.finance_glance.v1`, or validated
v2 snapshot through a browser file picker. Full private state stays under
`pederson_finance_webapp_bundle_v1`; the minimized Homebase card uses
`homebase_finance_glance_v1` and `homebase-sync-v1`. Because `/finance/` and
`/ai/` share one origin, imports update Homebase on the same device without a
server or upload.

Never add generated finance JSON, balances, account data, transactions,
receipts, statements, or credentials to this repository. Only the shell,
manifest, service worker, documentation, and synthetic fixtures are
publishable. The private bundle is generated by `/Users/davidpederson/Documents/Money`.

## Open items / ideas not yet done

- Sports feeds are flaky run-to-run (ESPN sometimes parses 0 items); only
  successful sources are stored each run — consider per-feed fallback to
  previous items (currently all-or-nothing per category).
- User asked about true Apple Notes/Reminders sync — impossible from a
  static page (no public Apple web API); Copy-all buttons are the stopgap.
  A real fix needs a hosted backend with Apple developer credentials.
- Possible next features (user-approved ideas earlier): none pending.
- The user tests on the real car and sends photo feedback; the car caches
  hard — always tell them to reload after a deploy.

## Current state at handoff (2026-07-03)

Branch `claude/news-sports-weather-bug-0a1io5` at commit "feat:
Coquihalla/Connector cams, smarter stock search, two new games" — pushed,
**PR not yet created/merged**. To finish: create PR → squash-merge →
dispatch update-cache.yml on main (bakes new cams/ETFs; hourly would also
catch it) → verify Pages deploy → tell user to reload in car.

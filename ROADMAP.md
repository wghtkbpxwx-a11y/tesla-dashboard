# Tesla Dashboard — Optimization & Growth Roadmap

Living document. Written 2026-07-03 after a bug-hunt + review pass. Prioritized by
**impact ÷ effort**, grounded in the real constraints (Tesla in‑car WebKit browser,
single-file `index.html`, GitHub Pages, cross-origin blocked, cache refreshed hourly).

Tags: **[S/M/L]** effort · **⭐ impact** · **🎨 Fable-session candidate** (creative/design/
copy work that pairs well with a Fable model) · **🧪 needs a spike/verify-on-car**.

## Next full audit

The canonical audit queue is [`FABLE_AUDIT_BRIEF.md`](FABLE_AUDIT_BRIEF.md).
The order is intentional: deterministic routing/budget/team tests and mutation
security first; encrypted-sync/accounting correctness and failure recovery next;
product comprehension only after those risks. Shipped mobile, credential,
xAI, and LM Studio smoke checks should not consume another audit session unless
new evidence contradicts them.

## Homebase AI operating model (shipped 2026-07-18)

- ✅ Capability- and cost-aware model routing with local-first execution and a
  hard estimated $50 trailing-30-day cloud budget.
- ✅ Request-time automatic provider failover: missing keys and temporarily
  unavailable/quota-exhausted providers are skipped for the next least-cost
  eligible model, with reservation release, bounded retries, partial-stream
  duplicate protection, provider cooldowns, and an honest Demo last resort.
- ✅ A compact **Next** model dropdown in the composer can pin one query to an
  exact ready model, then returns to Automatic without changing the chat-wide
  routing preference or silently involving other models.
- ✅ Automatic task-shaped specialist teams with parallel role execution,
  narrow tool/connector access, per-role model selection, and lead synthesis.
- ✅ Guarded self-development: repository inspection plus exact multi-file
  changes on a new branch and draft pull request after explicit confirmation.
- ✅ Passphrase-encrypted Google Drive sync for phone/desktop memory, tasks,
  AI/router preferences, optional provider credentials, and the shared rolling
  cloud-usage ledger; remote merges are section-aware and abort safely when the
  existing vault cannot be decrypted.
- ✅ Direct-first provider policy with Perplexity for current cited answers,
  Kimi for long-context/frontier work, DeepInfra for inexpensive open models,
  ElevenLabs for optional voice, and OpenRouter restricted to fallback/manual
  use. Official cloud keys are pinned to their provider origins.
- ✅ LM Studio is optimized for the 16 GB M1 Pro with Qwen 3.5 9B 4-bit,
  capability-aware local tool routing, a preferred `homebase-local` alias, and
  a scoped Brave-search MCP path billed into the rolling estimate. The live
  setup now requires authentication, retains only the restricted Homebase
  token, denies arbitrary remote MCPs, allows installed `mcp.json` connectors,
  and has passed a one-search local-Qwen test at an estimated $0.005 with no
  paid cloud-model call. Qwen 3.5 4B is the fast short-prompt path; 9B remains
  the capable local/tool path, with balanced or tool-heavy work considering the
  cheapest adequate cloud route first to avoid multi-minute local tool loops.
- Next: reconcile the local estimate with provider billing exports when a safe,
  provider-neutral read-only API path is available; keep provider-side limits as
  the authoritative backstop.
- Later: a user-owned Cloudflare Worker/Pages Function can become a secure
  relay for server-side secrets and Workers AI; do not expose a Cloudflare API
  token directly in the GitHub Pages browser app.

---

## The one number that drives most of this

`index.html` is **296 KB / 5,738 lines**, and **~64 KB (22%) of it is `DASHBOARD_CACHE`**,
which the hourly job **rewrites in place**. Every car load re-parses all 296 KB, and every
hour produces a large HTML diff (git churn, merge-conflict risk on the sacred regex, the
branch-restart dance). Shrinking and decoupling that block is the highest-leverage move on
the board — it improves load time, reliability, *and* developer velocity at once.

---

## Tier 0 — Reliability safety net (do first; cheap, prevents white-screens)

The whole app is one inline `<script>`. **A single JS error on init blanks the entire
dashboard** — in the car, mid-drive. There is currently no automated guard.

1. **CI validation on every push** ✅ **shipped** — `.github/workflows/validate.yml` runs
   `.github/scripts/validate.py` (JS parses · cache is valid JSON · Python compiles) and
   fails the check on any breakage. *Next step to make it truly blocking:* turn on branch
   protection for `main` requiring the "Validate" check (a one-click repo setting). A future
   enhancement is a full headless-load check that also catches runtime/init errors.
2. **Cache self-check in the hourly job** ✅ **shipped** — `update_cache.py` re-validates the
   rewritten `DASHBOARD_CACHE` (marker still matches · valid JSON) before writing, and aborts
   (leaving the last good `index.html`) otherwise. Closes the gap where the `[skip ci]` hourly
   commit isn't covered by the Validate workflow.
3. **Lightweight error beacon** ✅ **shipped** — a bubble-phase `window` error listener shows a
   "⚠ Something glitched — tap to reload" chip and stashes the last error in `last_error_v1`.
   Ignores benign `<img>` load failures (offline cams), so it only fires on real JS errors.

## Tier 1 — Load & architecture (the big optimization)

4. **Move `DASHBOARD_CACHE` → same-origin `cache.json`** **[M] ⭐⭐⭐ 🧪**
   The Tesla browser blocks *cross-origin* calls, but the dashboard is served from GitHub
   Pages — a `fetch('./cache.json')` is **same-origin** and should be allowed. Payoff:
   `index.html` drops ~22%, parses faster, the hourly job writes a small JSON file (tiny
   diffs, no regex surgery, no branch restarts). **De-risked plan:** keep a slim embedded
   fallback; load flow = try `cache.json`, on any failure use the embedded copy. Verify on
   the real car first (the whole premise is one `fetch` the browser may or may not allow).
5. **Service worker + `manifest.json` (installable PWA)** **[M] ⭐⭐⭐ 🧪**
   Chromium-based browser → a SW can cache the app shell for **instant, offline-first**
   loads (huge for a car that caches hard and has flaky connectivity). Add-to-Home-Screen
   gives a real app icon. Pairs perfectly with #4: SW caches shell, `cache.json` stays fresh.
6. **Minify-on-deploy** **[S] ⭐⭐**
   A build step strips comments/whitespace at publish time while dev stays readable. Easy
   30–40% shrink of the non-cache bytes.
7. **Defer the games bundle** **[M] ⭐⭐**
   Critterra + Wordle + 2048 + the 5 KB word list are only used in Games. With #4/#5 in
   place, split them into a module loaded on first Games open. Faster first paint for the
   Live panel that actually matters while driving.

## Tier 2 — Driving-first UX (think outside the box)

8. **Glance / Park mode** ✅ **shipped** — full-screen giant-type card (clock, weather,
   rotating facts: 4 headlines / sports / teams / traffic / Rx / quote) + the 🔊 audio
   briefing. Possible v2: auto-engage when stationary.
9. **Voice navigation** **[M] ⭐⭐ 🧪**
   The Web Speech API is already wired for dictation — extend it: "show traffic",
   "weather", "play a game". Hands-stay-on-wheel navigation.
10. **Trip & charge planner** **[L] ⭐⭐ 🎨**
    Combine the curated Coquihalla/Connector cams + weather + a destination to suggest a
    departure window and charging stops. The corridor data is already cached; this turns it
    into a decision aid, not just pictures.
11. **Contextual surfacing** **[M] ⭐⭐**
    Learn David's open-times (localStorage histogram) and auto-select the most relevant
    panel — Traffic on the morning commute, News at lunch, Live otherwise.
12. **"Now" rotator on page 1** **[S] ⭐**
    A single card that cycles the 2–3 most time-relevant facts (next game tonight, rain in
    an hour, incident on Hwy 1) instead of making the driver scan panels.

## Tier 3 — Content depth

13. **Portfolio roll-up** ✅ **shipped** — share counts per stock (`stocks_shares_v1`),
    Portfolio summary row in the dropdown + MY PORTFOLIO chip in the hero with today's P/L.
14. **Richer sports** **[M] ⭐ 🎨**
    Standings, next-game countdown, simple playoff-odds line for the followed teams.
15. **News dedup + summaries** ✅ **mostly shipped** — `generate_digest.py` dedupes
    same-story headlines across sources into a spoken/text digest (Today's Digest card +
    briefing); a guarded LLM polish hook exists (`DIGEST_GGUF`). Remaining 🎨: richer
    per-cluster summaries if a bigger model ever becomes available.

## Tier 4 — Critterra (all creative → 🎨 great Fable-session material)

16. **Evolutions** ✅ **shipped** — Lv.10 evolved forms with original names (Voltarix,
    Glaciern, Tempestwyrm…), aura+crown sprites, +12 HP; evolution moment on level-up.
17. **Sound** ✅ **shipped** — WebAudio chip effects (hits, throw, catch arpeggio, break,
    win fanfare, faint) with a persisted 🔊/🔇 toggle (`mon_sound_v1`).
18. **A third area** (beach/mountain) with its own encounter pool + tileset **[M] 🎨**
19. **Party picker** ✅ **shipped** — tap a caught Critter in the Critterdex to set the
    battle partner (`mon_active_v1`), ★ tag + glow on the active one.
20. **2048 game-over detection** ✅ **shipped** — win message on reaching 2048, and a proper
    game-over state (final score, input blocked) when no legal move remains.

---

## Suggested sequencing

- **This week (safety + quick wins):** #1 CI smoke test → #2 cache assertion → #6 minify → #20 2048 end-state.
- **Next (the big lever):** #4 `cache.json` spike on the car → if it flies, #5 service worker.
- **Then (delight):** #8 Glance mode → #13 portfolio roll-up → #12 Now rotator.
- **Evenings w/ Fable:** Critterra #16–18, news summaries #15, copy passes.

## Notes / constraints to respect (from CLAUDE.md)

- Only the document scrolls; 48px+ touch targets; keyboard covers the bottom half; no iframes.
- Never break the `var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n` marker while it still exists.
- All Critterra content stays 100% original (no Nintendo names/designs).
- PRs are squash-merged; restart the branch from main after each; verify the Pages deploy
  actually landed (it fails transiently — re-run failed jobs).

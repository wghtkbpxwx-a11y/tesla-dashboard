# Tesla Dashboard — Optimization & Growth Roadmap

Living document. Written 2026-07-03 after a bug-hunt + review pass. Prioritized by
**impact ÷ effort**, grounded in the real constraints (Tesla in‑car WebKit browser,
single-file `index.html`, GitHub Pages, cross-origin blocked, cache refreshed hourly).

Tags: **[S/M/L]** effort · **⭐ impact** · **🎨 Fable-session candidate** (creative/design/
copy work that pairs well with a Fable model) · **🧪 needs a spike/verify-on-car**.

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
2. **Cache schema assertion in the hourly job** **[S] ⭐⭐**
   Before committing, assert the new cache has the expected top-level keys and non-empty
   `weather`/`forecast`; otherwise keep the previous block. Stops a bad API day from
   silently blanking panels.
3. **Lightweight error beacon** **[S] ⭐**
   `window.onerror` → stash last error + timestamp in `localStorage` and show a tiny
   "something glitched — tap to reload" chip. David already sends photo feedback; this makes
   failures self-reporting.

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

8. **Glance / Park mode** **[M] ⭐⭐⭐ 🎨**
   One giant-type card: temperature, next headline, next game, freshness — readable in a
   half-second glance. Auto-engage when the car is stationary, or a single big toggle.
   This is the feature that best fits "used in a moving Tesla."
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

13. **Portfolio roll-up** **[S] ⭐⭐**
    The watchlist shows quotes; add optional share counts → a single "today's P/L" number
    for the XEQT/ETF holdings. High personal value, small code.
14. **Richer sports** **[M] ⭐ 🎨**
    Standings, next-game countdown, simple playoff-odds line for the followed teams.
15. **News dedup + one-line summaries** **[M] ⭐ 🎨**
    Cluster near-duplicate headlines across sources; a crisp one-liner per cluster. Great
    copy/creative task for a Fable session.

## Tier 4 — Critterra (all creative → 🎨 great Fable-session material)

16. **Evolutions** at level thresholds (new sprite + name per stage) **[M] 🎨**
17. **Sound**: reuse the WebAudio beep pattern for hits/catches/level-ups **[S] 🎨**
18. **A third area** (beach/mountain) with its own encounter pool + tileset **[M] 🎨**
19. **Party picker in battle** (switch active Critter instead of auto-highest) **[S]**
20. **2048 game-over detection** — today it silently stops accepting moves when the board
    locks; add a "no moves left" end state + score save **[S] ⭐** (nearest thing to a bug).

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

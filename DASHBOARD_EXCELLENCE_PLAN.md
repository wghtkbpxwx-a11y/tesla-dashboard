# Tesla Dashboard — Excellence Plan

Living engineering plan. Written 2026-07-20 after a full product + code review.
Owner context: David (Surrey/Vancouver), Tesla in-car browser, GitHub Pages,
hourly `DASHBOARD_CACHE`, Homebase AI + Finance as sibling apps.

**North star:** a professional cockpit UI — glanceable while parked, calm while
charging, minimal while driving — with reliability and security that would pass
an internal design/review bar at a major tech firm.

---

## Executive verdict

The product already punches above its weight for a single-file static app: Live
cockpit modes, traffic cams + DriveBC events, digest/briefing, portfolio chips,
Critterra, and a serious AI companion. What holds it back from “excellence” is
not missing features — it is **architecture debt**, **visual inconsistency**,
**driving UX friction**, and a few **trust/security gaps**.

This PR ships **Wave 0** (visible polish + XSS hardening). Everything else is
sequenced below.

---

## Constraints that must never be broken

1. Tesla browser blocks most cross-origin fetches → cache-first architecture.
2. Only the **document** scrolls (no primary inner `overflow-y:auto`).
3. Touch targets ≥ 48px; keyboard covers bottom half → inputs stay top-anchored.
4. No iframes for external sites.
5. Never break `var DASHBOARD_CACHE = ({...});\n` while the marker still exists.
6. No Nintendo IP in Critterra; no private finance data in git.
7. Homebase invariants (budget, vault abort-on-decrypt-fail, draft-PR only writes).

---

## Inventory — problems & enhancements

### P0 — Reliability / safety

| ID | Finding | Impact | Effort |
|----|---------|--------|--------|
| P0.1 | Single inline script: any init throw blanks the whole car UI | White screen mid-drive | S–M |
| P0.2 | Hourly cache rewrite inside `index.html` → huge diffs, merge conflicts, slow parse (~22% of file is cache) | Dev velocity + load time | M |
| P0.3 | Branch protection for Validate check may not be required on `main` | Broken deploys possible | S (repo setting) |
| P0.4 | DriveBC camera fetch timeouts from GitHub runners (known) | Stale cams | M (ops) |
| P0.5 | Sports feeds all-or-nothing per category | Empty sports panel | S |
| P0.6 | Pages deploy fails transiently; no automated “is live?” probe | Silent stale car | S |

### P0 — Security / trust

| ID | Finding | Impact | Effort |
|----|---------|--------|--------|
| S0.1 | Watchlist ticker symbols were injected into DOM without `escHtml` | Stored XSS via localStorage | **Fixed this PR** |
| S0.2 | Notes/tasks/bookmarks live in plaintext localStorage (shared origin with Homebase) | Privacy if device shared | M |
| S0.3 | No Content-Security-Policy meta/headers on Pages | XSS blast radius | M |
| S0.4 | Google Fonts CDN hard dependency | FOIT / offline failure in car | S |
| S0.5 | `allorigins.win` fallback for uncached fetches | Third-party trust | M |
| S0.6 | Homebase vault/budget/mutation risks | See `FABLE_AUDIT_BRIEF.md` | ongoing |

### P1 — Architecture

| ID | Enhancement | Why |
|----|-------------|-----|
| A1 | Move cache → same-origin `cache.json` (+ slim embedded fallback) | Load, diffs, conflict risk |
| A2 | Service worker + web app manifest for dashboard shell | Instant reopen / offline shell |
| A3 | Split games bundle (Critterra/Wordle/2048) load-on-demand | Faster Live first paint |
| A4 | Minify-on-deploy while keeping source readable | Bandwidth |
| A5 | Headless runtime smoke test (init without throw) | Catch white-screens CI misses |
| A6 | Per-feed sports/news fallback to previous items | Stop empty panels |
| A7 | Extract CSS/JS only at build time (keep single-file deploy if desired) | Maintainability |

### P1 — Driving-first UX

| ID | Enhancement | Why |
|----|-------------|-----|
| U1 | Auto Drive/Parked/Charging from vehicle state (if ever available) or time-of-day heuristics | Modes are manual today |
| U2 | Voice panel navigation (“show traffic”) | Hands on wheel |
| U3 | Contextual default panel (Traffic mornings, Live otherwise) | Less tapping |
| U4 | Stronger “Now” rotator (incident / next game / rain) | One-glance decision |
| U5 | Trip + charge planner for Coquihalla/Connector corridor | Decision aid, not just cams |
| U6 | Haptic/audio confirmations for mode changes & timer | Car feedback |
| U7 | One-tap reload of cams with clearer offline badges | Trust in traffic view |

### P1 — Visual / product polish (professional app bar)

| ID | Finding | Status |
|----|---------|--------|
| V1 | Generic Inter + purple logo + flat dark glass | **Addressed Wave 0** |
| V2 | Clock/weather hierarchy too small for car glance | **Addressed Wave 0** |
| V3 | Dock / active states read as “web demo”, not product | **Addressed Wave 0** |
| V4 | Hard-coded blue accents in scattered CSS | **Mostly cleaned Wave 0** |
| V5 | Dense Live panel — digest + quote + split compete | Next: progressive disclosure |
| V6 | Inconsistent empty states / loading copy | Next |
| V7 | Light theme lagging dark quality | Next |
| V8 | Motion language incomplete (only panel fade) | Next: 2–3 intentional motions |
| V9 | Accessibility: few `aria-*`, emoji in critical controls | Next |
| V10 | Settings IA dense for car | Progressive disclosure |

### P2 — Features (high value, not blocking)

| ID | Idea |
|----|------|
| F1 | Richer sports: standings, next-game countdown |
| F2 | Portfolio alerts / daily P&L briefing line |
| F3 | Pharmacy Rx digest prominence when new trials land |
| F4 | Critterra third area (beach/mountain) |
| F5 | Bookmarks sync via Homebase vault (optional) |
| F6 | Export/import dashboard settings JSON |
| F7 | “Focus strip” widget: next charge stop / road event |
| F8 | Offline-first fonts (self-host woff2) |

### P2 — Homebase / Finance (sibling apps)

Track in `ROADMAP.md` + `FABLE_AUDIT_BRIEF.md`. Do not re-audit verified packages
without new evidence. Remaining: streaming TTS latency, team cancel stuck-UI,
ledger↔billing reconciliation, car barge-in echo test.

### P3 — Debt / hygiene

| ID | Item |
|----|------|
| D1 | 232 functions in one file — name collisions risk |
| D2 | Mix of emoji + SVG icons |
| D3 | Inline styles in generated HTML strings |
| D4 | Duplicate loading/empty muted blocks |
| D5 | Clock strings use U+202F — brittle exact edits |
| D6 | Docs drift (`ROADMAP` size numbers vs current ~361KB / 6.9k lines) |

---

## Target experience (definition of done)

**Parked:** open → greet + huge clock + weather card + mode strip + Now focus
readable in <1s; Briefing/Voice one tap; news/scores without hunting.

**Drive:** stocks/digest/quote hidden; Traffic reachable in ≤2 taps; cams + events
legible at arm’s length.

**Charging:** charge timer obvious; Voice/Briefing promote enrichment; no clutter.

**Trust:** never blank on init error without recovery chip; freshness honest;
no XSS from feed/user strings; secrets never in git.

**Craft:** one coherent visual system (type, accent, radius, motion); 48px+
controls; works on phone and car.

---

## Delivery waves

### Wave 0 — this PR (shipped)

1. Design system refresh: Plus Jakarta Sans, teal cockpit accent, deeper night
   palette, dual ambient gradients.
2. Header brand lockup (“TESLA / Cockpit”), date pill, stock/weather chips.
3. Live hero: larger clock, weather action card, stronger cockpit command bar,
   premium dock active state (dark text on teal for contrast).
4. XSS: escape watchlist symbols in Live chips + Stocks dropdown.

### Wave 1 — architecture spike (highest leverage)

1. Car-verify same-origin `cache.json` fetch.
2. If green: SW + manifest; keep embedded fallback.
3. Per-category feed fallback; CI headless init check; branch protection.

### Wave 2 — driving UX

1. Time-based contextual default panel.
2. Voice nav hooks into existing speech path.
3. Now rotator fed by traffic severity + scores + precip.
4. Empty-state + a11y pass (aria labels on dock, mode, feeds).

### Wave 3 — depth & delight

1. Corridor trip planner.
2. Sports standings / next game.
3. Critterra area 3.
4. Self-hosted fonts; optional CSP report-only.

---

## Metrics / acceptance

- First meaningful paint of Live hero < previous baseline on mid Wi‑Fi.
- Zero white-screen init errors in CI smoke.
- Validate + cache JSON check green on every push (incl. hourly path).
- Manual car checklist: Drive/Parked/Charging, Traffic swipe, Briefing, Glance,
  Stocks keyboard, Games open, Settings reset confirm.
- Security: no unescaped feed/user strings in `innerHTML` paths.

---

## Decisions for David

1. Keep “TESLA” wordmark vs rename to personal “Homebase Cockpit”? (legal + brand)
2. Proceed with `cache.json` spike on the real car this week?
3. Prefer teal default accent (this PR) or restore classic blue preset as default?
4. Priority after Wave 0: architecture (A1) vs driving UX (U3/U4)?

**Recommended defaults:** keep wordmark for now; run `cache.json` spike ASAP;
keep teal as Default; architecture before new features.

---

## Verification (every push)

```bash
python3 -c "import re;open('/tmp/check.js','w').write('\\n'.join(re.findall(r'<script>([\\s\\S]*?)</script>', open('index.html').read())))" && node --check /tmp/check.js
python3 -c "import re,json;json.loads(re.search(r'var DASHBOARD_CACHE = (\\{[\\s\\S]*?\\});\\s*\\n', open('index.html').read()).group(1))"
python3 -m py_compile .github/scripts/update_cache.py
python3 .github/scripts/validate.py
```

After merge: poll live Pages for a unique string from this version; re-run failed
pages-build-deployment jobs if needed; reload in the car (hard cache).

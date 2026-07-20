# Homebase AI + Pederson Finances — Excellence Plan

Living engineering plan. Written 2026-07-20 alongside the Tesla dashboard
excellence pass. Same north star: professional cockpit UI, intuitive controls,
security, and features that clear an internal design/review bar.

Sibling of [`DASHBOARD_EXCELLENCE_PLAN.md`](DASHBOARD_EXCELLENCE_PLAN.md).
Homebase audit queue remains [`FABLE_AUDIT_BRIEF.md`](FABLE_AUDIT_BRIEF.md) for
security/routing — this document covers product craft + Wave sequencing for
`/ai/` and `/finance/`.

---

## Executive verdict

**Homebase** is already a serious multi-provider AI product (routing, budget,
vault, voice, teams, guarded repo writes). Gaps to excellence are mostly
**visual cohesion with the dashboard cockpit**, **failure UX**, **voice
hardware truth**, and a few **reliability edges** (not greenfield features).

**Finance** is a correctly constrained private shell (no money data in git).
Gaps are **empty-state clarity**, **install/PWA polish**, **sync feedback**,
and aligning craft with the shared cockpit system — not expanding what data
the public repo may hold.

Wave 0 (this PR): shared cockpit visual language on both apps.

---

## Shared design system (Wave 0 — shipped)

| Token | Value |
|-------|--------|
| Type | Plus Jakarta Sans 400–800 |
| Accent (light) | `#0f9f94` |
| Accent (dark) | `#3dd6c6` |
| Night bg | `#07090d` / `#0b0e14` |
| Brand pattern | Wordmark + uppercase teal subtitle |

Tesla dashboard keeps the TESLA wordmark. Homebase = “Homebase / AI Cockpit”.
Finance = “Pederson Finances / Private cockpit”.

---

## Homebase — inventory

### P0 — Reliability / safety (do not reopen verified packages without evidence)

| ID | Finding | Notes |
|----|---------|--------|
| H-P0.1 | Budget hard stop + reservation races | Harnessed in `test_cloud_budget_concurrency.js` + `homebase.test.js` |
| H-P0.2 | Sub-agent mutation boundary | Execution-time allowlist + `test_subagent_allowlist.js` |
| H-P0.3 | Vault decrypt failure must abort push | Invariant; tombstones shipped |
| H-P0.4 | Voice media-element tap silences iOS | Fixed; CI forbids `createMediaElementSource` on playback |
| H-P0.5 | No runtime error beacon on `/ai/` | Dashboard has one; Homebase still needs port |
| H-P0.6 | Team cancel / timeout stuck UI | Open P1 from audit brief |

### P0 — Security / trust

| ID | Finding | Notes |
|----|---------|--------|
| H-S0.1 | Repo writes: explicit intent + confirm + draft PR | Hardened; never weaken |
| H-S0.2 | Official keys pinned to official origins | Verified |
| H-S0.3 | Passphrase/OAuth never enter vault ciphertext | Invariant |
| H-S0.4 | Google Fonts CDN dependency (new in Wave 0) | Self-host woff2 later for offline car/phone |
| H-S0.5 | Shared origin with Finance/Dashboard localStorage | Cross-app XSS trust boundary; keep escaping |

### P1 — Product / UX

| ID | Enhancement |
|----|-------------|
| H-U1 | Port error beacon from dashboard |
| H-U2 | Vault conflict UX + mobile sync indicator |
| H-U3 | Route/cost/degradation comprehension outside voice |
| H-U4 | Settings progressive disclosure pass (already started on mobile) |
| H-U5 | Empty chat / hub first-run clearer “what to do next” |
| H-U6 | Streaming/chunked cloud TTS latency |
| H-U7 | Accent migration for users stuck on legacy indigo `#4f46e5` |

### P1 — Architecture

| ID | Enhancement |
|----|-------------|
| H-A1 | Scheduler: Service Worker vs honest pin-tab onboarding spike |
| H-A2 | Optional Cloudflare Worker relay (secrets never in Pages) — decision only |
| H-A3 | Ledger ↔ provider billing reconciliation when safe read-only API exists |

### P2 — Features

| ID | Idea |
|----|------|
| H-F1 | Deeper finance glance card actions (open `/finance/`, refresh hint) |
| H-F2 | Critterra / dashboard deep links from hub already exist — polish copy |
| H-F3 | Export conversation / share transcript |
| H-F4 | Stronger offline banner when local-only |

### P3 — Debt

| ID | Item |
|----|------|
| H-D1 | ~13k-line single file — extract only at build time if ever |
| H-D2 | Mixed hardcoded brand gradients for connectors (intentional) |
| H-D3 | Changelog / handoff length — keep compressing `current_handoff` |

---

## Finance — inventory

### Constraints (never break)

- No balances, transactions, statements, receipts, credentials, or generated
  bundles in the repository.
- Browser-local storage only; sync to Homebase on same origin via glance keys.
- Import validates known schemas only.

### P0

| ID | Finding |
|----|---------|
| F-P0.1 | Clear privacy copy + empty state must stay honest |
| F-P0.2 | Clear-data confirm must remain confirm-guarded |
| F-P0.3 | Never invent “demo” money in the shell |

### P1 — UX / craft

| ID | Enhancement |
|----|-------------|
| F-U1 | Stronger install/PWA prompt when supported |
| F-U2 | Sync Homebase success/failure toast detail |
| F-U3 | Bundle schema version mismatch → plain-language recovery |
| F-U4 | Dark/light always match system (today) — optional manual toggle later |
| F-U5 | Accessibility: landmark labels, live regions for import status |
| F-U6 | Self-host fonts with dashboard/Homebase |

### P2

| ID | Idea |
|----|------|
| F-F1 | Optional Face ID / device lock wrapper (OS-level) before reveal |
| F-F2 | Printable monthly summary from imported bundle (client-only) |
| F-F3 | Deep link from Homebase budget widget with “Open Finances” |

### P3

| ID | Item |
|----|------|
| F-D1 | Manifest/icon polish to match teal cockpit mark |
| F-D2 | Service worker cache versioning clarity |

---

## Waves

### Wave 0 — this PR

1. Homebase: Plus Jakarta Sans, teal cockpit tokens, brand lockup, chrome
   gradients/FAB/send/orbs/hub defaults off indigo.
2. Finance: same type/accent/header/hero/button language; privacy copy intact.
3. Docs: this plan + Homebase changelog entry + ROADMAP pointer.

### Wave 1 — reliability

1. Homebase error beacon; vault conflict UX; team cancel stuck-UI.
2. Finance sync toasts + schema mismatch copy.
3. Accent migration for legacy indigo saved settings.

### Wave 2 — depth

1. Streaming TTS; scheduler spike; a11y pass both apps.
2. Self-hosted fonts; optional CSP report-only.

---

## Decisions for David

1. Keep mode-specific hues (voice/agent/research/council) for recognition? **Recommend yes.**
2. Migrate saved indigo accent to teal automatically? **Recommend yes on next load.**
3. Finance manual theme toggle vs system-only? **Recommend system-only for now.**

---

## Verification

```bash
python3 .github/scripts/validate.py
# After merge, poll:
#   https://wghtkbpxwx-a11y.github.io/tesla-dashboard/ai/ for "AI Cockpit" / Plus Jakarta
#   https://wghtkbpxwx-a11y.github.io/tesla-dashboard/finance/ for "Private cockpit" / 3dd6c6
```

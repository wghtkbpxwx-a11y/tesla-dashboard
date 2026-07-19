# Fable audit brief

Updated: 2026-07-18  
Repository: `wghtkbpxwx-a11y/tesla-dashboard`  
Production: `https://wghtkbpxwx-a11y.github.io/tesla-dashboard/ai/`

## Mission

Perform an evidence-led architecture, security, reliability, and product audit of
Homebase AI. Spend the session on consequential risks and high-leverage fixes—not
orientation, cosmetic polish, or repeating checks already completed. Implement
clear, safe improvements; turn uncertain or user-choice-dependent work into a
ranked decision brief.

Success means:

1. the highest-risk paths have deterministic tests or concrete fixes;
2. findings cite exact functions/files and distinguish fact from inference;
3. implemented changes preserve the safety invariants below; and
4. the changelog, roadmap, documentation, pull request, and deployment status all
   agree before handoff.

## Fast start

Run only this orientation pass before substantive work:

```sh
git status --short
python3 .github/scripts/validate.py
rg -n "function (selectAIRoute|cloudRouteCandidates|buildAutoFailoverPlan|runChat|buildAutoAgentTeam|runSubagentMember|runTeamLeadSynthesis|reserveCloudChat|finishCloudChat|releaseCloudReservation|mergeVaultPayload|proposeRepositoryChanges|chooseVoiceTranscript|selectVoiceSTTProvider|selectVoiceTTSProvider|ttsPlaybackBlocked)|HOMEBASE_CHANGELOG" ai/index.html
```

Then read, in order:

1. this brief;
2. `HOMEBASE_CHANGELOG.current_handoff` and its newest three entries in
   `ai/index.html`;
3. the named functions found by the command above;
4. `ai/README.md` and the Homebase sections of `CLAUDE.md` only when a contract
   needs clarification.

Do not read the entire historical changelog linearly unless a specific dependency
requires it. Do not begin with a broad visual redesign.

## Already verified — do not repeat without contradictory evidence

- PRs #58–#73 are merged; their Pages deployments and validation checks passed.
- JavaScript parsing, embedded cache validity, and Python compilation pass through
  `.github/scripts/validate.py`.
- Mobile Settings was verified at 320×700 and 390×844; desktop at 1280×900. All
  nine sections map to one pane without horizontal overflow.
- The model picker retains all direct model choices behind an explicit advanced
  reveal. Automatic mobile routing does not silently start WebLLM downloads.
- Credential fields activate on input, persist after a short debounce, and keep a
  final change-event save. Do not revisit this unless a reproducible failure exists.
- xAI discovery and a low-cost Grok 3 mini request were verified. LM Studio's
  authenticated local model, JIT loading, scoped `mcp.json` access, and one Brave
  MCP search were verified.
- The live financial glance is private browser/import data. No real balances or
  transaction data belong in the public repository or test fixtures.
- `.github/scripts/test_ai_failover.js` exercises the production failure
  classifier and `runChat` path for missing keys, exhausted quota, provider
  cooldown, next-cheapest-provider selection, no retry after a partial stream,
  the six-paid-attempt bound, and the final Demo fallback without paid calls.
  Extend this baseline for concurrency/accounting edge cases rather than
  recreating the same cases in another harness.
- `.github/scripts/test_query_model_selector.js` verifies the production route
  encoding/decoding, exact one-message route, regeneration lineage, Automatic
  reset, and suppression of Council, specialist delegation, and silent failover.
  The native selector was also checked at 320×700 and 390×844 with no horizontal
  overflow. Treat this as shipped product behavior, not another P2 redesign task.
- `.github/scripts/test_voice_mode.js` verifies production transcript recovery,
  legacy free-first migration, explicit device-only no-spend behavior, xAI-first
  modality-specific cloud cost ordering, one-tap deep-link gating,
  preserved blocked-audio replay, and Tesla launcher ownership without provider
  calls. Local browser checks also exercised the free voice test, voice overlay,
  no-overflow desktop layout, and Tesla-to-voice navigation. Do not spend a Fable
  session redoing this deterministic baseline; concentrate any voice follow-up on
  real iPhone/Tesla hardware evidence, WebKit lifecycle races, or security findings.

## Priority work packages

Work top-down. Complete fewer packages deeply rather than touching all of them.

### P0 — deterministic safety tests

Create a small deterministic harness around the pure or extractable decisions for:

- task tier/classification and explicit “best model”/local/named-model requests;
- model eligibility, direct-first/OpenRouter-fallback ordering, unknown pricing,
  and the rolling $50 hard stop;
- reservation, settlement, cancellation, concurrent failover, and double-count
  prevention beyond the shipped single-call failover baseline;
- specialist-team trigger, role count, per-role quality floor, aggregate team cap,
  partial failure, and lead synthesis fallback;
- mobile WebLLM auto-skip while preserving deliberate manual selection.

Prefer testable pure helpers over duplicating production logic in tests. Avoid a
framework migration if a focused Node test file is enough.

### P0 — mutation and connector security

Trace every path capable of external or repository mutation. Verify with adversarial
inputs that:

- only explicit user-authorized source-change requests reach repository writes;
- sub-agents remain read-only and cannot widen their tool allowlists;
- prompt or webpage content cannot bypass confirmation, branch, protected-path,
  secret-scan, exact-replacement, parse, or draft-PR guards;
- official cloud keys remain pinned to official provider origins;
- LM Studio tokens cannot enable arbitrary remote MCPs or broader filesystem access;
- OAuth tokens and vault passphrases never enter the encrypted sync payload.

Implement clear boundary fixes immediately. Do not weaken a guard to improve
convenience.

### P1 — encrypted sync and accounting correctness

Audit schema-v2 vault merge behavior under concurrent phone/desktop edits, stale
section timestamps, tombstones, duplicate usage events, wrong passphrases, failed
downloads, expired OAuth, and interrupted push/pull. Confirm that a remote decrypt
or download failure aborts push rather than overwriting the remote vault.

Reconcile the rolling usage ledger with reservation/settlement behavior. Provider
billing remains authoritative; do not claim the app estimate is exact.

### P1 — failure recovery and performance

Exercise cancellation and partial failure across parallel agents, cloud timeouts,
local-model unload/reload, tool-loop exhaustion, unavailable Mac-local AI, and
mobile background/resume. Look for stuck reservations, duplicate answers, infinite
fallbacks, and multi-minute local tool chains. Treat the deterministic automatic
provider failover tests as the starting point; focus additional effort on
concurrent reservations, cancellation races, streamed tool calls, and team-level
settlement.

For voice, treat the shipped voice harness as the baseline. A real-device check
should confirm iPhone Safari recognition, speaker playback, audio recovery after
backgrounding, and whether the current Tesla browser exposes microphone input.
Do not infer Tesla microphone support from desktop Chromium.

Keep LM Studio/Locally architecture honest: Locally uses Mac models through LM
Link, but Safari has no documented direct API to the iPhone app. A secure remote
HTTPS relay is a separate architecture decision; do not expose the Mac or an API
token publicly.

### P2 — product comprehension

Only after P0/P1: verify that Automatic mode communicates the selected route,
estimated cost, degraded/fallback state, and user-requested frontier behavior in
plain language. Preserve the simplified mobile UI and progressive disclosure.

## Non-negotiable invariants

- Hard estimated $50 spend limit over the trailing 30 days, enforced through the
  central reservation/accounting path.
- Local/private and least-cost adequate models by default; frontier models only
  when capability requires them or the user explicitly requests them.
- Sub-agents are externally read-only; only the lead may perform confirmed writes.
- Repository changes require explicit intent, confirmation, secret scanning, a new
  branch, a draft PR, and never a direct-to-main path.
- Synced secrets exist only as client-side PBKDF2/AES-GCM ciphertext when optional
  secret sync is enabled. Passphrases and OAuth tokens remain local/session-only.
- No private finance data, credentials, or realistic sensitive fixtures in Git.
- Mobile and desktop share one URL and feature set. Simplification may hide
  technical detail behind disclosure, never remove capability.

## Avoid low-value work

- Do not rename, reformat, split, minify, or framework-migrate the single-file SPA
  merely for aesthetics.
- Do not redo the shipped mobile layout, API-key persistence fix, xAI smoke test,
  LM Studio installation, or provider onboarding without a reproducible defect.
- Do not spend cloud calls comparing models unless a specific routing hypothesis
  cannot be tested deterministically; use the cheapest adequate call and record it.
- Do not add providers, connectors, dependencies, or a public relay speculatively.
- Do not edit generated dashboard cache content by hand.
- Do not turn uncertain design preferences into code without stating the tradeoff.

## Deliverable

Leave one answer-first audit record with:

1. prioritized findings (`P0`–`P3`) with exact evidence and impact;
2. fixes implemented, tests added, and commands/results;
3. decisions that require David, with a recommended default;
4. remaining risks and the next highest-value work package;
5. updated `HOMEBASE_CHANGELOG`, `current_handoff`, `ROADMAP.md`, and affected docs;
6. commit/branch/PR/merge/Pages status stated precisely.

For code changes, use a fresh branch, open a draft PR, wait for validation, merge
only after it passes, and verify the public Pages artifact. Never include secrets in
logs, fixtures, commits, PR bodies, or the audit report.

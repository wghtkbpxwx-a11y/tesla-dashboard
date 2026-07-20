#!/usr/bin/env python3
"""Pre-deploy sanity checks for the Tesla dashboard.

The whole app is one inline <script>, so a single syntax error or a corrupted
DASHBOARD_CACHE ships a blank screen to the car. This runs the same checks the
CLAUDE.md "verification trio" documents (all of which have broken at least once)
and exits non-zero on the first failure so CI can block the deploy.

Run locally the same way CI does:  python3 .github/scripts/validate.py
"""
import json
import re
import subprocess
import sys
import tempfile
import os

FAILS = []


def ok(msg):
    print(f"  ✓ {msg}")


def fail(msg):
    print(f"  ✗ {msg}")
    FAILS.append(msg)


def check_js_parses(html, label="index.html"):
    """Extract every <script> block and make sure Node can parse it."""
    scripts = re.findall(r"<script>([\s\S]*?)</script>", html)
    if not scripts:
        fail(f"no <script> blocks found in {label}")
        return
    combined = "\n".join(scripts)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(combined)
        path = f.name
    try:
        r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
        if r.returncode == 0:
            ok(f"{label} JS parses ({len(scripts)} script block(s), {len(combined)} chars)")
        else:
            fail("JS syntax error:\n" + (r.stderr.strip() or r.stdout.strip()))
    except FileNotFoundError:
        fail("`node` not found on PATH")
    finally:
        os.unlink(path)


def check_cache(html):
    """The embedded DASHBOARD_CACHE must match its marker and be valid JSON."""
    m = re.search(r"var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n", html)
    if not m:
        fail("DASHBOARD_CACHE marker not found (regex broken?)")
        return
    try:
        cache = json.loads(m.group(1))
    except Exception as e:
        fail(f"DASHBOARD_CACHE is not valid JSON: {e}")
        return
    ok(f"DASHBOARD_CACHE is valid JSON ({len(m.group(1))} chars)")
    # Soft schema check — warn but don't fail if a key is missing/empty, since the
    # hourly job legitimately falls back to prior values on a bad API day.
    expected = ["weather", "forecast", "news", "sports", "scores", "stocks", "cameras", "updated"]
    missing = [k for k in expected if k not in cache]
    if missing:
        print(f"  ⚠ note: cache missing key(s): {', '.join(missing)}")
    else:
        ok("cache has all expected top-level keys")


def check_dashboard_orb(html):
    """Corner voice orb: it must live in the sticky <header> (never a blocking
    center panel — the bug David reported), toggle on/off, stay cache-driven with
    no live fetch, and fall back to the audible briefing where there's no mic (the
    Tesla browser). This is what makes it work in the car and never cover a module."""
    if 'id="dash-orb"' not in html or 'id="dash-orb-cap"' not in html:
        fail("voice orb (#dash-orb / #dash-orb-cap) missing from the dashboard")
        return
    head = html.split("</header>", 1)[0]
    if 'id="dash-orb"' not in head:
        fail("voice orb must live inside the sticky <header> so it stays in the "
             "corner on scroll and never blocks the modules")
        return
    ok("voice orb present in the sticky header (corner, non-blocking)")
    marker = "VOICE ORB (top-right"
    ctrl = html.split(marker, 1)[1] if marker in html else ""
    needles = {
        "cache-driven answers (DASHBOARD_CACHE)": "DASHBOARD_CACHE",
        "best-effort speech input (SpeechRecognition)": "SpeechRecognition",
        "in-car briefing fallback (briefingToggle)": "briefingToggle",
        "on/off toggle (deactivate)": "function deactivate(",
    }
    missing = [n for n, s in needles.items() if s not in ctrl]
    if missing:
        fail("voice orb controller missing: " + "; ".join(missing))
    elif "fetchCached(" in ctrl or re.search(r"\bfetch\(", ctrl):
        fail("voice orb must stay cache-driven (no live fetch) — the Tesla browser "
             "blocks cross-origin calls")
    else:
        ok("voice orb is cache-driven, toggles on/off, and falls back to the in-car briefing")


def check_python():
    """The hourly updater must compile."""
    target = ".github/scripts/update_cache.py"
    if not os.path.exists(target):
        fail(f"{target} not found")
        return
    r = subprocess.run([sys.executable, "-m", "py_compile", target], capture_output=True, text=True)
    if r.returncode == 0:
        ok("update_cache.py compiles")
    else:
        fail("update_cache.py failed to compile:\n" + r.stderr.strip())


def check_ai_failover():
    """Automatic routing must skip missing/exhausted providers without duplicate streams."""
    target = ".github/scripts/test_ai_failover.js"
    if not os.path.exists(target):
        fail(f"{target} not found")
        return
    r = subprocess.run(["node", target], capture_output=True, text=True)
    if r.returncode == 0:
        print(r.stdout.rstrip())
    else:
        fail("AI automatic provider failover tests failed:\n" + (r.stderr.strip() or r.stdout.strip()))


def check_query_model_selector():
    """An exact next-message model choice must remain one-shot and terminal."""
    target = ".github/scripts/test_query_model_selector.js"
    if not os.path.exists(target):
        fail(f"{target} not found")
        return
    r = subprocess.run(["node", target], capture_output=True, text=True)
    if r.returncode == 0:
        print(r.stdout.rstrip())
    else:
        fail("Per-query model selector tests failed:\n" + (r.stderr.strip() or r.stdout.strip()))


def check_voice_mode():
    """Mobile voice must preserve speech, recover audio, and own Tesla launchers."""
    target = ".github/scripts/test_voice_mode.js"
    if not os.path.exists(target):
        fail(f"{target} not found")
        return
    r = subprocess.run(["node", target], capture_output=True, text=True)
    if r.returncode == 0:
        print(r.stdout.rstrip())
    else:
        fail("Mobile voice reliability tests failed:\n" + (r.stderr.strip() or r.stdout.strip()))


def check_scheduled_agent_routing():
    """Scheduled agents must use Auto/failover and never simulate completion with Demo."""
    target = ".github/scripts/test_scheduled_agent_routing.js"
    if not os.path.exists(target):
        fail(f"{target} not found")
        return
    r = subprocess.run(["node", target], capture_output=True, text=True)
    if r.returncode == 0:
        print(r.stdout.rstrip())
    else:
        fail("Scheduled agent routing tests failed:\n" + (r.stderr.strip() or r.stdout.strip()))


def check_node_harness(target, label):
    """Run a deterministic Node harness and surface its stdout/stderr on failure."""
    if not os.path.exists(target):
        fail(f"{target} not found")
        return
    r = subprocess.run(["node", target], capture_output=True, text=True)
    if r.returncode == 0:
        print(r.stdout.rstrip())
    else:
        fail(f"{label} failed:\n" + (r.stderr.strip() or r.stdout.strip()))


def check_subagent_allowlist():
    """Sub-agents must be refused any tool outside their read-only allowlist."""
    check_node_harness(".github/scripts/test_subagent_allowlist.js", "Sub-agent tool allowlist tests")


def check_connectors_voice():
    """Dashboard brief helpers, Gmail MIME encode, and voice connector controls."""
    check_node_harness(".github/scripts/test_connectors_voice.js", "Connectors + voice read/write harness")


def check_cloud_budget_concurrency():
    """Parallel reservations must honor the $50 hard stop and settle without double-count."""
    check_node_harness(".github/scripts/test_cloud_budget_concurrency.js", "Cloud budget concurrency tests")


def check_vault_merge():
    """Vault merge must dedupe usage, strip secrets, and abort push on decrypt failure."""
    check_node_harness(".github/scripts/test_vault_merge.js", "Vault merge tests")


def check_specialist_team():
    """Specialist teams must honor the budget cap and synthesize after partial member failure."""
    check_node_harness(".github/scripts/test_specialist_team.js", "Specialist team tests")


def check_homebase_safety_suite():
    """Broader Homebase deterministic suite (routing, tombstones, repo guards, budgets)."""
    check_node_harness("ai/tests/homebase.test.js", "Homebase deterministic safety suite")


def main():
    if not os.path.exists("index.html"):
        print("index.html not found — run from the repo root", file=sys.stderr)
        sys.exit(2)
    html = open("index.html", encoding="utf-8").read()
    ai_html = open("ai/index.html", encoding="utf-8").read()
    print("Validating Tesla dashboard...")
    check_js_parses(html, "index.html")
    check_js_parses(ai_html, "ai/index.html")
    check_cache(html)
    check_dashboard_orb(html)
    check_python()
    check_ai_failover()
    check_query_model_selector()
    check_voice_mode()
    check_scheduled_agent_routing()
    check_subagent_allowlist()
    check_connectors_voice()
    check_cloud_budget_concurrency()
    check_vault_merge()
    check_specialist_team()
    check_homebase_safety_suite()
    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)} check(s) did not pass — blocking deploy.")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()

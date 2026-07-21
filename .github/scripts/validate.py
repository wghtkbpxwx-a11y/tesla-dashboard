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


def check_curio(html):
    """Curio's lessons must stay in sync: the inline CURIO_LESSONS (what the car
    renders offline) must equal curio_lessons.json (the server's source of truth,
    which bakes the lesson-of-the-day + its audio). Also sanity-check the quizzes."""
    m = re.search(r"var CURIO_LESSONS = (\[[\s\S]*?\n\]);", html)
    if not m:
        fail("Curio lessons (CURIO_LESSONS) missing from the dashboard")
        return
    try:
        inline = json.loads(m.group(1))
    except Exception as e:
        fail(f"inline CURIO_LESSONS is not valid JSON ({e})")
        return
    path = ".github/scripts/curio_lessons.json"
    if not os.path.exists(path):
        fail("curio_lessons.json (Curio source of truth) is missing")
        return
    with open(path, encoding="utf-8") as f:
        source = json.load(f)
    if [x.get("id") for x in inline] != [x.get("id") for x in source]:
        fail("inline CURIO_LESSONS is out of sync with curio_lessons.json — regenerate the inline block from the JSON")
        return
    bad = [x.get("id") for x in source
           if not (x.get("quiz") and len(x["quiz"].get("options", [])) == 4 and 0 <= x["quiz"].get("answer", -1) <= 3
                   and x.get("title") and x.get("hook") and x.get("take") and isinstance(x.get("body"), list))]
    if bad:
        fail("malformed Curio lessons: " + ", ".join(str(b) for b in bad))
        return
    ok(f"Curio: {len(source)} lessons, inline in sync with source, quizzes well-formed")


def check_calendar_local(html):
    """David's Google Calendar is device-local by design: the secret iCal URL and
    the parsed events live only in localStorage — they must NEVER be baked into the
    public DASHBOARD_CACHE (the site is world-readable). Lock that invariant so a
    future change can't silently start publishing his schedule."""
    if "function parseICS" not in html or ("cal_urls_v1" not in html and "cal_url_v1" not in html):
        fail("calendar engine (parseICS / cal_urls_v1) missing from the dashboard")
        return
    m = re.search(r"var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n", html)
    if m:
        try:
            cache = json.loads(m.group(1))
            leaked = [k for k in cache.keys() if "ical" in k.lower() or k.lower().startswith("cal")]
            if leaked:
                fail("calendar data must never be baked into the public cache: " + ", ".join(leaked))
                return
        except Exception:
            pass
    if "fetch_calendar" in open(".github/scripts/update_cache.py", encoding="utf-8").read():
        fail("update_cache.py must not fetch the calendar server-side (keep it device-local)")
        return
    ok("calendar stays device-local (parseICS present; never in the public cache)")


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
    check_calendar_local(html)
    check_curio(html)
    check_python()
    check_ai_failover()
    check_query_model_selector()
    check_voice_mode()
    check_scheduled_agent_routing()
    check_subagent_allowlist()
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

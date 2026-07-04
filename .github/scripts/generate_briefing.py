#!/usr/bin/env python3
"""Render the audio briefing as an MP3 the car can actually play.

speechSynthesis is silent in the Tesla browser and muted by the iPhone silent
switch, but <audio> MEDIA playback works on both. So the hourly job builds the
same script the client used to speak (weather, digest news/sports/pharmacy,
My Teams) and synthesizes it with Piper TTS into briefing.mp3, which the
workflow publishes to the single-commit `audio` branch. The client hotlinks
it from raw.githubusercontent.com (media tags need no CORS), falling back to
speechSynthesis where the file is unavailable.

Env:
  BRIEFING_VOICE  path to a piper .onnx voice (with .onnx.json beside it)

Outputs: briefing.mp3 (or briefing.wav when ffmpeg is missing) + briefing.txt.
Exits 0 with a message (writing nothing) whenever prerequisites are missing —
this step must never break the hourly cache run.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
try:
    from zoneinfo import ZoneInfo
    VAN = ZoneInfo("America/Vancouver")
except Exception:
    VAN = None

MARKER = r"var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n"

WMO = {0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy",
       48: "foggy", 51: "drizzly", 53: "drizzly", 55: "drizzly", 61: "rainy", 63: "rainy",
       65: "rainy", 71: "snowy", 73: "snowy", 75: "snowy", 80: "showery", 81: "showery",
       82: "showery", 95: "stormy"}


def is_real_headline(t):
    return bool(t) and len(t) > 18 and not re.search(r"home ?page|^featured$", t, re.I)


def build_text(cache: dict) -> str:
    parts = []
    now = datetime.now(VAN) if VAN else datetime.now()
    hr = now.hour
    parts.append(("Good morning." if hr < 12 else "Good afternoon." if hr < 17 else "Good evening.")
                 + " Here is your briefing.")
    try:
        cur = cache["weather"]["current"]
        desc = WMO.get(int(cur.get("weather_code", -1)), "")
        line = f"It is {round(cur['temperature_2m'])} degrees" + (f" and {desc}" if desc else "")
        if cur.get("apparent_temperature") is not None:
            line += f", feeling like {round(cur['apparent_temperature'])}"
        parts.append(line + ".")
    except Exception:
        pass
    try:
        f = cache["forecast"]["daily"]
        line = f"Today: a high of {round(f['temperature_2m_max'][0])}, low of {round(f['temperature_2m_min'][0])}"
        p = (f.get("precipitation_probability_max") or [None])[0]
        if p is not None and p >= 30:
            line += f", with a {p} percent chance of rain"
        parts.append(line + ".")
    except Exception:
        pass
    digest = cache.get("digest") or {}
    if digest.get("news"):
        parts.append("Top stories. " + digest["news"])
    else:
        heads = []
        for v in (cache.get("news") or {}).values():
            items = v.get("items") or []
            if items and is_real_headline(items[0].get("title", "")) and len(heads) < 3:
                heads.append(items[0]["title"])
        if heads:
            parts.append("Top headlines. " + " ".join(h.rstrip(".") + "." for h in heads))
    if digest.get("sports"):
        parts.append("In sports. " + digest["sports"])
    if digest.get("pharmacy"):
        parts.append("In pharmacy and medicine. " + digest["pharmacy"])
    try:
        for s in cache.get("scores") or []:
            if s.get("home") and s.get("away") and s["home"].get("score") != "-" and re.search(r"final|ft", s.get("status", ""), re.I):
                w = s["home"] if s["home"].get("winner") else s["away"]
                l = s["away"] if s["home"].get("winner") else s["home"]
                parts.append(f"The {w['name']} beat the {l['name']} {w['score']} to {l['score']}.")
            elif s.get("home") and s.get("away") and s.get("status"):
                parts.append(f"{s['away']['name']} play the {s['home']['name']}, {s['status']}.")
    except Exception:
        pass
    parts.append("That is your briefing. Drive safe.")
    return " ".join(parts)


def main() -> int:
    voice_path = os.environ.get("BRIEFING_VOICE", "")
    if not voice_path or not os.path.exists(voice_path):
        print("briefing: no BRIEFING_VOICE model; skipping (client falls back to speechSynthesis)")
        return 0
    try:
        from piper import PiperVoice
    except Exception as e:
        print(f"briefing: piper unavailable ({e}); skipping")
        return 0

    with open("index.html", encoding="utf-8") as f:
        m = re.search(MARKER, f.read())
    if not m:
        print("briefing: cache marker not found; skipping")
        return 0
    cache = json.loads(m.group(1))
    text = build_text(cache)
    # Guard against degenerate output (empty cache day): require a real script
    if len(text) < 80:
        print("briefing: script too short; skipping")
        return 0
    with open("briefing.txt", "w", encoding="utf-8") as f:
        f.write(text)

    import wave
    voice = PiperVoice.load(voice_path)
    with wave.open("briefing.wav", "wb") as w:
        voice.synthesize_wav(text, w)
    size = os.path.getsize("briefing.wav")
    print(f"briefing: synthesized {size/1e6:.1f} MB wav from {len(text)} chars")

    if shutil.which("ffmpeg"):
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "briefing.wav",
                            "-codec:a", "libmp3lame", "-b:a", "48k", "briefing.mp3"],
                           capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists("briefing.mp3"):
            os.remove("briefing.wav")
            print(f"briefing: briefing.mp3 ready ({os.path.getsize('briefing.mp3')/1e3:.0f} KB)")
        else:
            print(f"briefing: ffmpeg failed ({r.stderr.strip()[:200]}); keeping wav", file=sys.stderr)
    else:
        print("briefing: no ffmpeg on PATH; keeping briefing.wav")
    return 0


if __name__ == "__main__":
    sys.exit(main())

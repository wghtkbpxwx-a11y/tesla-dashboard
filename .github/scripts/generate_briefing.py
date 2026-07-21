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


def speakable(s: str) -> str:
    """Expand symbols / units / abbreviations to words so Piper pronounces them
    naturally. Mirrors briefingSpeakable() in index.html so the MP3 and the
    speechSynthesis fallback read the same way."""
    s = s or ""
    s = s.replace("&", " and ")
    s = re.sub(r"(\d)\s*%", r"\1 percent", s).replace("%", " percent")

    def _money(m):
        n = m.group(1).replace(",", "")
        sc = (m.group(2) or "").lower()
        scale = {"m": " million", "b": " billion", "k": " thousand",
                 "million": " million", "billion": " billion", "trillion": " trillion"}
        return n + (scale.get(sc, "") if sc else "") + " dollars"

    s = re.sub(r"\$\s?(\d[\d,]*(?:\.\d+)?)\s?(million|billion|trillion|M|B|K)?\b", _money, s, flags=re.I)
    s = re.sub(r"°\s?[CF]?", " degrees", s)
    s = re.sub(r"(\d)\s?km/h\b", r"\1 kilometres per hour", s, flags=re.I)
    s = re.sub(r"\bkm/h\b", "kilometres per hour", s, flags=re.I)
    s = re.sub(r"(\d)\s?km\b", r"\1 kilometres", s, flags=re.I)
    s = re.sub(r"(\d)\s?kg\b", r"\1 kilograms", s, flags=re.I)
    s = re.sub(r"(\d)\s?mg\b", r"\1 milligrams", s, flags=re.I)
    s = re.sub(r"\bvs\.?\b", "versus", s, flags=re.I)
    s = re.sub(r"\bB\.C\.?", "B C", s)
    s = re.sub(r"\bU\.S\.(?:A\.)?", "U S", s)
    s = re.sub(r"\bU\.K\.", "U K", s)
    s = re.sub(r"\bAQI\b", "A Q I", s)
    s = re.sub(r"\bUV\b", "U V", s)
    s = re.sub(r"\bTSX\b", "T S X", s)
    s = re.sub(r"\bXEQT\b", "X E Q T", s, flags=re.I)
    s = re.sub(r"\bNo\.\s?(\d)", r"number \1", s)
    s = re.sub(r"\.{2,}", ".", s)
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s


def build_text(cache: dict) -> str:
    """A warm, personable radio-style script — it addresses David by name,
    uses spoken transitions, and rotates its sign-off by weekday."""
    parts = []
    now = datetime.now(VAN) if VAN else datetime.now()
    hr, wd = now.hour, now.strftime("%A")
    tod = "morning" if hr < 12 else "afternoon" if hr < 17 else "evening"
    parts.append(f"Good {tod}, David — here's your briefing for {wd}, {now.strftime('%B')} {now.day}.")
    try:
        cur = cache["weather"]["current"]
        desc = WMO.get(int(cur.get("weather_code", -1)), "")
        line = f"It's {round(cur['temperature_2m'])} degrees out right now"
        if desc:
            line += f" with {desc} skies" if desc in ("clear", "mostly clear", "partly cloudy", "overcast") else f" and {desc}"
        if cur.get("apparent_temperature") is not None:
            line += f", feeling like {round(cur['apparent_temperature'])}"
        parts.append(line + ".")
    except Exception:
        pass
    try:
        f = cache["forecast"]["daily"]
        line = f"Expect a high of {round(f['temperature_2m_max'][0])} today and a low of {round(f['temperature_2m_min'][0])}"
        p = (f.get("precipitation_probability_max") or [None])[0]
        if p is not None and p >= 30:
            line += f" — and heads up, there's a {p} percent chance of rain"
        parts.append(line + ".")
    except Exception:
        pass
    digest = cache.get("digest") or {}
    if digest.get("news"):
        parts.append(f"Here's what's making news this {tod}. " + digest["news"])
    else:
        heads = []
        for v in (cache.get("news") or {}).values():
            items = v.get("items") or []
            if items and is_real_headline(items[0].get("title", "")) and len(heads) < 3:
                heads.append(items[0]["title"])
        if heads:
            parts.append("Here's what's making news. " + " ".join(h.rstrip(".") + "." for h in heads))
    if digest.get("sports"):
        parts.append("Over in sports. " + digest["sports"])
    if digest.get("pharmacy"):
        parts.append("And from the world of pharmacy and medicine. " + digest["pharmacy"])
    try:
        for sc in cache.get("scores") or []:
            if sc.get("home") and sc.get("away") and sc["home"].get("score") != "-" and re.search(r"final|ft", sc.get("status", ""), re.I):
                w = sc["home"] if sc["home"].get("winner") else sc["away"]
                l = sc["away"] if sc["home"].get("winner") else sc["home"]
                mine = sc.get("team", "")
                if mine and mine in w.get("name", ""):
                    parts.append(f"Good news for your {w['name']} — they beat the {l['name']} {w['score']} to {l['score']}.")
                elif mine and mine in l.get("name", ""):
                    parts.append(f"Tough one for your {l['name']} — they fell to the {w['name']} {w['score']} to {l['score']}.")
                else:
                    parts.append(f"The {w['name']} beat the {l['name']} {w['score']} to {l['score']}.")
            elif sc.get("home") and sc.get("away") and sc.get("status"):
                parts.append(f"Your {sc.get('team', sc['away']['name'])} take on the "
                             + (sc["home"]["name"] if sc.get("team", "") in sc["away"].get("name", "") else sc["away"]["name"])
                             + f", {sc['status']}.")
    except Exception:
        pass
    signoffs = ["That's all for now — drive safe out there.",
                f"That's your briefing. Have a great {wd}.",
                "That's everything for now. Take care, David.",
                "And that's the latest. Safe travels.",
                f"That wraps it up — enjoy your {tod}.",
                "That's all I've got. Keep well, David.",
                "And you're all caught up. Drive safe."]
    parts.append(signoffs[now.toordinal() % len(signoffs)])
    return speakable(" ".join(parts))


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
    try:
        from piper import SynthesisConfig
        cfg = SynthesisConfig(length_scale=1.05)  # a touch slower = warmer read
    except Exception:
        cfg = None
    with wave.open("briefing.wav", "wb") as w:
        if cfg is not None:
            voice.synthesize_wav(text, w, syn_config=cfg)
        else:
            voice.synthesize_wav(text, w)
    size = os.path.getsize("briefing.wav")
    print(f"briefing: synthesized {size/1e6:.1f} MB wav from {len(text)} chars")

    # MP3 encode: lameenc first (pure pip wheel — GH runners have no ffmpeg),
    # then ffmpeg, else leave the wav (client still plays it, just heavier).
    done = False
    try:
        import lameenc
        with wave.open("briefing.wav") as w:
            pcm = w.readframes(w.getnframes())
            rate = w.getframerate()
        enc = lameenc.Encoder()
        enc.set_bit_rate(48); enc.set_in_sample_rate(rate); enc.set_channels(1); enc.set_quality(5)
        data = enc.encode(pcm) + enc.flush()
        with open("briefing.mp3", "wb") as f:
            f.write(bytes(data))
        done = True
        print(f"briefing: briefing.mp3 ready via lameenc ({os.path.getsize('briefing.mp3')/1e3:.0f} KB)")
    except Exception as e:
        print(f"briefing: lameenc unavailable ({e}); trying ffmpeg", file=sys.stderr)
    if not done and shutil.which("ffmpeg"):
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "briefing.wav",
                            "-codec:a", "libmp3lame", "-b:a", "48k", "briefing.mp3"],
                           capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists("briefing.mp3"):
            done = True
            print(f"briefing: briefing.mp3 ready via ffmpeg ({os.path.getsize('briefing.mp3')/1e3:.0f} KB)")
    if done:
        os.remove("briefing.wav")
    else:
        print("briefing: no MP3 encoder available; keeping briefing.wav")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Curio daily lesson: bake today's pick into DASHBOARD_CACHE and (with a Piper
voice) synthesize its audio, so the in-car browser can *hear* it. speechSynthesis
is silent in the Tesla browser; MP3 media playback works — exactly like the
briefing. curio_lessons.json is the single source of truth (the client's inline
CURIO_LESSONS is the same array; validate.py enforces they match).

Modes:
  bake   (default) — pick today's lesson and write cache["curio"] = {date, id}
                     into index.html.
  audio            — read cache["curio"].id, build the spoken lesson, and
                     synthesize curio.mp3 (needs BRIEFING_VOICE).

Never breaks the hourly run: prints a message and exits 0 on any problem.
"""
import json
import os
import re
import sys
from datetime import datetime
try:
    from zoneinfo import ZoneInfo
    VAN = ZoneInfo("America/Vancouver")
except Exception:
    VAN = None

MARKER = r"var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n"
HERE = os.path.dirname(os.path.abspath(__file__))
LESSONS_PATH = os.path.join(HERE, "curio_lessons.json")


def load_lessons():
    with open(LESSONS_PATH, encoding="utf-8") as f:
        return json.load(f)


def today_key():
    n = datetime.now(VAN) if VAN else datetime.now()
    return n.strftime("%Y-%m-%d")


def daily_index(n_lessons):
    n = datetime.now(VAN) if VAN else datetime.now()
    return n.timetuple().tm_yday % max(1, n_lessons)


def read_cache():
    with open("index.html", encoding="utf-8") as f:
        html = f.read()
    m = re.search(MARKER, html)
    if not m:
        return html, None, None
    try:
        return html, m, json.loads(m.group(1))
    except Exception:
        return html, m, None


def spoken_text(lesson):
    parts = [lesson["title"] + ".", lesson["hook"]]
    parts += lesson.get("body", [])
    parts.append("The takeaway. " + lesson["take"])
    parts.append("Here is a question. " + lesson["quiz"]["q"])
    for i, opt in enumerate(lesson["quiz"]["options"]):
        parts.append(chr(65 + i) + ". " + opt + ".")
    text = " ".join(parts)
    try:
        from generate_briefing import speakable          # shared normalizer
        text = speakable(text)
    except Exception:
        pass
    return text


def bake():
    lessons = load_lessons()
    if not lessons:
        print("curio: no lessons; skipping"); return 0
    lesson = lessons[daily_index(len(lessons))]
    html, m, cache = read_cache()
    if not m or cache is None:
        print("curio: cache marker not found; skipping"); return 0
    cache["curio"] = {"date": today_key(), "id": lesson["id"]}
    new_block = "var DASHBOARD_CACHE = " + json.dumps(cache, ensure_ascii=False, indent=2) + ";\n"
    html = html[:m.start()] + new_block + html[m.end():]
    chk = re.search(MARKER, html)
    if not chk:
        print("curio: rewrite broke the cache marker; aborting", file=sys.stderr); return 0
    try:
        json.loads(chk.group(1))
    except Exception as e:
        print(f"curio: rewrite is not valid JSON ({e}); aborting", file=sys.stderr); return 0
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)
    print(f"curio: baked lesson of the day '{lesson['id']}' — {lesson['title']}")
    return 0


def audio():
    voice_path = os.environ.get("BRIEFING_VOICE", "")
    if not voice_path or not os.path.exists(voice_path):
        print("curio: no BRIEFING_VOICE model; skipping audio"); return 0
    _, _, cache = read_cache()
    lid = (cache or {}).get("curio", {}).get("id")
    if not lid:
        print("curio: no baked lesson id; skipping audio"); return 0
    lesson = next((x for x in load_lessons() if x["id"] == lid), None)
    if not lesson:
        print("curio: baked lesson id not found; skipping"); return 0
    text = spoken_text(lesson)
    if len(text) < 60:
        print("curio: script too short; skipping"); return 0
    try:
        from piper import PiperVoice
    except Exception as e:
        print(f"curio: piper unavailable ({e}); skipping"); return 0
    import wave
    with open("curio.txt", "w", encoding="utf-8") as f:
        f.write(text)
    voice = PiperVoice.load(voice_path)
    try:
        from piper import SynthesisConfig
        cfg = SynthesisConfig(length_scale=1.05)
    except Exception:
        cfg = None
    with wave.open("curio.wav", "wb") as w:
        if cfg is not None:
            voice.synthesize_wav(text, w, syn_config=cfg)
        else:
            voice.synthesize_wav(text, w)

    done = False
    try:
        import lameenc
        with wave.open("curio.wav") as w:
            pcm = w.readframes(w.getnframes()); rate = w.getframerate()
        enc = lameenc.Encoder()
        enc.set_bit_rate(48); enc.set_in_sample_rate(rate); enc.set_channels(1); enc.set_quality(5)
        with open("curio.mp3", "wb") as f:
            f.write(bytes(enc.encode(pcm) + enc.flush()))
        done = True
    except Exception as e:
        print(f"curio: lameenc unavailable ({e}); trying ffmpeg", file=sys.stderr)
    if not done:
        import shutil
        import subprocess
        if shutil.which("ffmpeg"):
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "curio.wav",
                                "-codec:a", "libmp3lame", "-b:a", "48k", "curio.mp3"],
                               capture_output=True, text=True)
            done = r.returncode == 0 and os.path.exists("curio.mp3")
    if done:
        try:
            os.remove("curio.wav")
        except Exception:
            pass
        print(f"curio: curio.mp3 ready ({os.path.getsize('curio.mp3') / 1e3:.0f} KB)")
    else:
        print("curio: no MP3 encoder available; keeping curio.wav")
    return 0


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "bake"
    try:
        return audio() if mode == "audio" else bake()
    except Exception as e:
        print(f"curio: unexpected error ({e}); skipping", file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())

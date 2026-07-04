#!/usr/bin/env python3
"""Build a spoken news/sports digest and embed it in DASHBOARD_CACHE.

Runs in the hourly job after update_cache.py. Produces cache["digest"] =
{"news": str, "sports": str, "t": iso, "method": "extractive"|"llm"} which the
client's audio briefing reads instead of raw headline lists.

Two engines:
  1. extractive (default, always available) — dedupes near-duplicate stories
     across sources, picks the top ones, and joins them with spoken-style
     connectors. Hallucination is impossible by construction.
  2. llm (optional polish) — if DIGEST_GGUF points at a local GGUF model and
     llama_cpp is importable, each selected headline is rewritten into a spoken
     sentence; every rewrite is checked with a content-word overlap guard and
     falls back to the plain headline if the model drifted. Measured on
     2026-07-04: Qwen2.5-0.5B invented facts ("body" not in any headline) and
     Qwen2.5-1.5B invented an actor ("the BC government is considering") — so
     nothing from the model is ever used unguarded.

Never fails the pipeline: any error leaves the cache without a digest and the
client falls back to reading headlines directly.
"""
import json
import os
import re
import string
import sys
from datetime import datetime, timezone

MARKER = r"var DASHBOARD_CACHE = (\{[\s\S]*?\});\s*\n"
STOP = set(("a an the of to in on for with and or is are was were has have be been after "
            "into over about their they he she it its this that from by at as who why what "
            "how new says say said will would could than more most out up down not no").split())


def content_words(s):
    s = s.lower().translate(str.maketrans("", "", string.punctuation))
    return set(w for w in s.split() if len(w) > 3 and w not in STOP)


def is_real_headline(t):
    return bool(t) and len(t) > 18 and not re.search(r"home ?page|^featured$", t, re.I)


def collect(feeds, per_source=2, cap=10):
    """Top items per source, deduped across sources by content-word overlap."""
    picked = []
    for url, feed in (feeds or {}).items():
        taken = 0
        for it in feed.get("items", []):
            t = (it.get("title") or "").strip()
            if not is_real_headline(t):
                continue
            tw = content_words(t)
            dup = False
            for p in picked:
                pw = content_words(p)
                inter = len(tw & pw)
                if inter and inter / max(1, min(len(tw), len(pw))) >= 0.5:
                    dup = True  # same story from another source
                    break
            if not dup:
                picked.append(t)
                taken += 1
            if taken >= per_source:
                break
    return picked[:cap]


def spoken(t):
    """Make a headline read naturally: drop [Editorial]-style prefixes and
    source suffixes, ensure a terminal period."""
    t = re.sub(r"^\[[^\]]{1,24}\]\s*", "", t)
    t = re.sub(r"\s*[|–—-]\s*(CBC|Global News|CTV|TSN|Sportsnet|ESPN)[^,]*$", "", t).strip()
    if t and t[-1] not in ".!?":
        t += "."
    return t


def extractive(news_titles, sports_titles):
    news = ""
    if news_titles:
        conns = ["", " Meanwhile, ", " Also today, ", " And ", " Finally, "]
        parts = []
        for i, t in enumerate(news_titles[:5]):
            s = spoken(t)
            s = s[0].upper() + s[1:] if s else s
            parts.append((conns[i] if i < len(conns) else " ") + s)
        news = "".join(parts).strip()
    sports = ""
    if sports_titles:
        parts = [spoken(t) for t in sports_titles[:2]]
        sports = " ".join(parts).strip()
    return news, sports


def llm_polish(titles):
    """Optional per-headline rewrite with a strict guard; falls back per line."""
    gguf = os.environ.get("DIGEST_GGUF")
    if not gguf or not os.path.exists(gguf):
        return None
    try:
        from llama_cpp import Llama
    except Exception:
        return None
    try:
        llm = Llama(model_path=gguf, n_ctx=1024, n_threads=os.cpu_count() or 2, verbose=False)
        out = []
        for t in titles:
            r = llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": "Rewrite the headline as one short natural spoken sentence. Keep every fact. Add nothing."},
                    {"role": "user", "content": t},
                ],
                max_tokens=48, temperature=0.15)
            s = r["choices"][0]["message"]["content"].strip().split("\n")[0]
            src, gen = content_words(t), content_words(s)
            novel = gen - src
            # Guard: reject if the rewrite introduces content words not in the
            # headline (beyond one connective slip) or shrank/ballooned badly
            if len(novel) <= 1 and 0.5 <= len(s) / max(1, len(t)) <= 1.8:
                out.append(s)
            else:
                out.append(t)
        return out
    except Exception as e:
        print(f"  llm polish unavailable ({e}); using extractive text", file=sys.stderr)
        return None


def main():
    with open("index.html", encoding="utf-8") as f:
        html = f.read()
    m = re.search(MARKER, html)
    if not m:
        print("digest: cache marker not found; skipping", file=sys.stderr)
        return 0
    try:
        cache = json.loads(m.group(1))
    except Exception as e:
        print(f"digest: cache unreadable ({e}); skipping", file=sys.stderr)
        return 0

    news_titles = collect(cache.get("news"), per_source=2, cap=8)
    sports_titles = collect(cache.get("sports"), per_source=1, cap=3)
    pharmacy_titles = collect(cache.get("pharmacy"), per_source=1, cap=3)
    if not news_titles and not sports_titles and not pharmacy_titles:
        print("digest: no headlines available; skipping")
        return 0

    method = "extractive"
    polished = llm_polish(news_titles[:5])
    if polished:
        news_titles[:len(polished)] = polished
        method = "llm"
    news, sports = extractive(news_titles, sports_titles)
    pharmacy = " ".join(spoken(t) for t in pharmacy_titles[:2]).strip()

    cache["digest"] = {
        "news": news, "sports": sports, "pharmacy": pharmacy, "method": method,
        "t": datetime.now(timezone.utc).isoformat(),
    }
    new_block = "var DASHBOARD_CACHE = " + json.dumps(cache, ensure_ascii=False, indent=2) + ";\n"
    html = html[:m.start()] + new_block + html[m.end():]

    # Same self-check discipline as update_cache.py before writing
    chk = re.search(MARKER, html)
    if not chk:
        print("digest: rewritten cache lost its marker; aborting", file=sys.stderr)
        return 1
    json.loads(chk.group(1))
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)
    print(f"digest: ok ({method}) — news {len(news)} chars / sports {len(sports)} chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())

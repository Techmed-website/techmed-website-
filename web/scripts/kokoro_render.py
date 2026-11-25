#!/usr/bin/env python3
"""Record the /oral-english clips with Kokoro, a free open-source voice (no account, no API key).

    node scripts/generate-oral-audio.mjs --texts oral-audio-texts.json --plan plan.json
    python scripts/kokoro_render.py --plan plan.json [--voice bf_emma]

Needs Python 3.10-3.12 with:  pip install "kokoro>=0.9.4" soundfile  (plus torch; CPU is fine)
and ffmpeg on the PATH. About 0.3 s per clip on a laptop CPU.

How items are read (decided by describe() in generate-oral-audio.mjs):
  - ipa:  exact British pronunciation, converted to Kokoro's phoneme symbols
  - emph: Kokoro has no emphasis control, so the stressed word is made louder,
          longer and higher afterwards, using Kokoro's own word timings
  - otherwise the words are read as written
"""
import argparse, json, os, re, subprocess, sys, tempfile, time
from datetime import datetime, timezone

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SR = 24000
VOWELS = set('aeiouAIOQWYɑɒɔəɛɜɪʊʌæᵊɐ')


def ipa_to_kokoro(ipa: str) -> str:
    """Standard British IPA -> Kokoro/misaki symbols, stress mark placed before the vowel."""
    s = ipa
    for a, b in [('eɪ', 'A'), ('aɪ', 'I'), ('ɔɪ', 'Y'), ('əʊ', 'Q'), ('aʊ', 'W'), ('eə', 'ɛː'),
                 ('dʒ', 'ʤ'), ('tʃ', 'ʧ'), ('r', 'ɹ'), ('e', 'ɛ'), ('æ', 'a'), ('g', 'ɡ')]:
        s = s.replace(a, b)
    out, pending = [], ''
    for ch in s:
        if ch in 'ˈˌ':
            pending = ch
            continue
        if pending and ch in VOWELS:
            out.append(pending)
            pending = ''
        out.append(ch)
    return ''.join(out)


def synth(pipe, text, voice, speed):
    """Audio plus word timings (seconds) across all chunks."""
    chunks, words, offset = [], [], 0.0
    for r in pipe(text, voice=voice, speed=speed):
        a = np.asarray(r.audio, dtype=np.float32)
        for t in (r.tokens or []):
            if t.start_ts is not None and t.end_ts is not None:
                words.append((t.text, offset + t.start_ts, offset + t.end_ts))
        chunks.append(a)
        offset += len(a) / SR
    return np.concatenate(chunks) if chunks else np.zeros(1, np.float32), words


def norm_word(w):
    return re.sub(r"[^a-z']", '', w.lower().replace('’', "'"))


def mark_emphasis(say, emph):
    """Kokoro's stress marker on the emphasised word(s), same voice, nothing added later."""
    for phrase in emph:
        marked = ' '.join(f'[{w}](+2)' for w in phrase.split())
        s2 = re.sub(r'(?<![\w\[])' + re.escape(phrase) + r'(?![\w\]])', marked, say, count=1)
        say = s2
    return say


def cut_to_words(audio, words):
    """Keep only Kokoro's own word span (+ a short lead and tail); fade in and out."""
    spans = [w for w in words if re.search(r'[A-Za-z]', w[0] or '')]
    if spans:
        start = max(0, int((spans[0][1] - 0.03) * SR))
        end = min(len(audio), int((spans[-1][2] + 0.15) * SR))
        if end - start > int(0.1 * SR):
            audio = audio[start:end].copy()
    fi, fo = int(0.02 * SR), int(0.04 * SR)
    if len(audio) > fi + fo:
        audio[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
        audio[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
    return audio


def finish(audio):
    pad = np.zeros(int(0.08 * SR), np.float32)
    audio = np.concatenate([pad, audio, pad])
    peak = float(np.max(np.abs(audio))) or 1.0
    return (audio / peak * 0.92).astype(np.float32)


def to_mp3(audio, path):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        sf.write(tmp.name, audio, SR)
    try:
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp.name, '-ac', '1', '-ar', str(SR),
                        '-b:a', '48k', path], check=True)
    finally:
        os.unlink(tmp.name)


def write_manifest(out_dir, voice):
    keys = sorted(f[:-4] for f in os.listdir(out_dir) if f.endswith('.mp3'))
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f:
        json.dump({'voice': f'kokoro:{voice}', 'generated_at': datetime.now(timezone.utc).isoformat(), 'keys': keys},
                  f, separators=(',', ':'))
        f.write('\n')
    return len(keys)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', required=True)
    ap.add_argument('--voice', default='bf_emma')
    ap.add_argument('--limit', type=int, default=0, help='record only the first N (for a quick trial)')
    args = ap.parse_args()

    plan = json.load(open(args.plan, encoding='utf-8'))
    out_dir = plan['out_dir']
    os.makedirs(out_dir, exist_ok=True)
    items = [i for i in plan['items'] if not os.path.exists(os.path.join(out_dir, f"{i['key']}.mp3"))]
    if args.limit:
        items = items[:args.limit]
    print(f'{len(items)} clips to record with Kokoro voice {args.voice}.')

    pipe = KPipeline(lang_code='b')  # British English
    done = failed = 0
    t0 = time.time()
    for n, it in enumerate(items, 1):
        try:
            if it.get('ipa'):
                text = f"[{it['say']}](/{ipa_to_kokoro(it['ipa'])}/)"
            elif it.get('emph'):
                text = mark_emphasis(it['say'], it['emph'])
            else:
                text = it['say']
            audio, words = synth(pipe, text, args.voice, 1.0)
            audio = cut_to_words(audio, words)
            to_mp3(finish(audio), os.path.join(out_dir, f"{it['key']}.mp3"))
            done += 1
        except Exception as e:  # keep going; a re-run fills the gaps
            failed += 1
            print(f"  failed: {it['text']}: {e}")
        if n % 100 == 0:
            write_manifest(out_dir, args.voice)
            print(f'  {n}/{len(items)} ({time.time() - t0:.0f}s)')
    total = write_manifest(out_dir, args.voice)
    print(f'Recorded {done}, failed {failed}. Manifest lists {total} clips.')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()

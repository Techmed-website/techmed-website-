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
        end = min(len(audio), int((spans[-1][2] + 0.05) * SR))
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


# ---------------------------------------------------------------------------
# Verified takes (--verify). Kokoro sometimes garbles a short word on its own or
# adds a burst of sound after it. So each word is recorded several ways and a
# speech recogniser (Whisper) "listens": a take is kept only if what it hears has
# the same phonemes as the word (heir heard as "air" passes; plait heard as
# "plaid" fails) and nothing sounds after the word ends.
# ---------------------------------------------------------------------------
CARRIERS = [  # (text template, speed); the word is always the last word
    ('{w}', 1.0), ('Next. {w}.', 1.0), ('The word is {w}.', 1.0), ('{w}.', 1.0),
    ('Say {w}.', 1.0), ('Next. {w}.', 0.95), ('{w}', 0.95), ('The word is {w}.', 0.95),
    ('Listen. {w}.', 1.0), ('Word: {w}.', 1.0), ('{w}!', 1.0), ('Now say {w}.', 1.0),
    ('{w}', 1.05), ('Next. {w}.', 1.05),
]


def frame_rms(a, fr):
    n = max(1, len(a) // fr)
    return np.array([np.sqrt(np.mean(a[i * fr:(i + 1) * fr] ** 2)) for i in range(n)])


def energy_trim(a):
    """Cut leading and trailing quiet by loudness, with soft edges."""
    fr = int(0.01 * SR)
    rms = frame_rms(a, fr)
    idx = np.where(rms > rms.max() * 0.08)[0]
    if not len(idx):
        return a
    s, e = max(0, (idx[0] - 2) * fr), min(len(a), (idx[-1] + 6) * fr)
    a = a[s:e].copy()
    fi, fo = int(0.015 * SR), int(0.05 * SR)
    if len(a) > fi + fo:
        a[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
        a[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
    return a


def trim_tail(a, start_frac=0.0):  # NOT USED: it cut real final syllables (psycholo-gy, Wednes-day)
    """Cut a stray burst after the word: sound that follows a clear silence (>= 50 ms)
    (>= 30 ms) at the end of the clip, lasting >= 50 ms and quieter than the word itself.
    start_frac: only look for that silence after this fraction of the clip (sentences
    use it so a pause at a comma is never treated as the end)."""
    fr = int(0.01 * SR)
    for _ in range(3):
        rms = frame_rms(a, fr)
        if len(rms) < 10:
            break
        r = rms / rms.max()
        active = r > 0.1
        # last active run
        end = len(r) - 1
        while end >= 0 and not active[end]:
            end -= 1
        start = end
        while start > 0 and active[start - 1]:
            start -= 1
        gap_end = start
        gap_start = gap_end
        while gap_start > 0 and not active[gap_start - 1]:
            gap_start -= 1
        gap, run = gap_end - gap_start, end - start + 1
        body_peak = r[:gap_start].max() if gap_start > 0 else 0
        if gap_start > len(r) * start_frac and gap >= 3 and run >= 5 and gap_start > 0 and r[start:end + 1].max() < 0.8 * body_peak:
            cut = min(len(a), (gap_start + 3) * fr)
            a = a[:cut].copy()
            fo = min(int(0.03 * SR), len(a) // 4)
            a[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
        else:
            break
    return a


def tail_burst(a):
    """How loud any sound is after the word has died away (0 = clean)."""
    rms = frame_rms(a, int(0.01 * SR))
    after = rms[rms.argmax():]
    below = np.where(after < rms.max() * 0.1)[0]
    if not len(below):
        return 0.0
    late = after[below[0] + 8:]  # skip 80 ms: the natural release of a final t, d, k, p
    return float(late.max() / rms.max()) if len(late) else 0.0


def last_word_take(pipe, text, voice, speed):
    audio, words = synth(pipe, text, voice, speed)
    spans = [w for w in words if re.search(r'[A-Za-z]', w[0] or '')]
    if spans:  # keep exactly Kokoro's own span for the (final) word
        return cut_to_words(audio, [spans[-1]])
    return audio


class Ear:
    def __init__(self, pipe):
        from faster_whisper import WhisperModel
        self.asr = WhisperModel(os.environ.get('ORAL_ASR_MODEL', 'small.en'), device='cpu', compute_type='int8', cpu_threads=int(os.environ.get('ORAL_ASR_THREADS', '2')))
        self.pipe = pipe

    def phon(self, text):
        ps, _ = self.pipe.g2p(text)
        return re.sub(r'[ˈˌᵊ\s.,!?;:\'"-]', '', ps or '')

    def heard(self, audio):
        import librosa
        a16 = librosa.resample(audio.astype(np.float32), orig_sr=SR, target_sr=16000)
        segs, _ = self.asr.transcribe(a16, language='en', beam_size=1, without_timestamps=True, condition_on_previous_text=False)
        return re.sub(r"[^a-z' ]", '', ' '.join(s.text for s in segs).lower()).strip()

    def heard_many(self, audios):
        """Transcribe many short clips in ~28 s windows (Whisper always works on 30 s,
        so one clip per call wastes most of it). Each clip gets back the words whose
        timestamps fall inside it."""
        import librosa
        out = [''] * len(audios)
        gap = np.zeros(int(0.8 * 16000), np.float32)
        i = 0
        while i < len(audios):
            buf, spans, t = [np.zeros(int(0.5 * 16000), np.float32)], [], 0.5
            while i < len(audios):
                a16 = librosa.resample(audios[i].astype(np.float32), orig_sr=SR, target_sr=16000)
                d = len(a16) / 16000
                if spans and t + d + 0.8 > 28:
                    break
                spans.append((t, t + d, i))
                buf += [a16, gap]
                t += d + 0.8
                i += 1
            segs, _ = self.asr.transcribe(np.concatenate(buf), language='en', beam_size=1, word_timestamps=True,
                                          condition_on_previous_text=False, without_timestamps=False)
            for seg in segs:
                for w in (seg.words or []):
                    mid = (w.start + w.end) / 2
                    for a, b, idx in spans:
                        if a - 0.3 <= mid <= b + 0.3:
                            out[idx] += ' ' + w.word
                            break
        return [re.sub(r"[^a-z' ]", '', x.lower()).strip() for x in out]


def best_word_take(pipe, ear, it, voice):
    """First take that sounds like the word and ends cleanly; else the closest one."""
    if it.get('ipa'):
        word = f"[{it['say']}](/{ipa_to_kokoro(it['ipa'])}/)"
        # Text cannot show stress (EXport/exPORT), so check the word; the IPA fixes the stress.
        target = ear.phon(it['say'].lower())
    else:
        word = it['say']
        target = ear.phon(word.lower())
    best = None
    for tmpl, speed in CARRIERS:
        audio = last_word_take(pipe, tmpl.format(w=word), voice, speed)
        heard = ear.heard(audio)
        got = ear.phon(heard) if heard else ''
        if it.get('ipa') and heard == it['say'].lower():
            got = target
        tail = tail_burst(audio)
        if got == target:
            return audio, True, heard
        import difflib
        score = difflib.SequenceMatcher(None, got, target).ratio() - tail
        if best is None or score > best[0]:
            best = (score, audio, heard)
    return best[1], False, best[2]


# Words Kokoro garbles on their own but which sound exactly like a plainer spelling.
# The clip is recorded from the sound-alike (same British pronunciation).
SAY_AS = {'heir': 'air', 'tear (to rip)': 'tare', 'tear (verb)': 'tare'}


def record_words_verified(pipe, ear, items, voice, out_dir):
    """Round by round: record every still-unverified word with the next carrier,
    let Whisper hear the whole batch at once, keep the takes that pass."""
    import difflib
    items = [dict(it, say=SAY_AS[it['text']], ipa=None) if it['text'] in SAY_AS else it for it in items]
    pending = {it['key']: it for it in items}
    best = {}
    for rnd, (tmpl, speed) in enumerate(CARRIERS, 1):
        if not pending:
            break
        keys = list(pending)
        takes, targets = [], []
        for k in keys:
            it = pending[k]
            if it.get('ipa'):
                word = f"[{it['say']}](/{ipa_to_kokoro(it['ipa'])}/)"
            else:
                word = it['say']
            takes.append(last_word_take(pipe, tmpl.format(w=word), voice, speed))
            targets.append(ear.phon(it['say'].lower()))
        heard = ear.heard_many(takes)
        passed = 0
        for k, audio, h, target in zip(keys, takes, heard, targets):
            it = pending[k]
            got = target if (it.get('ipa') and h == it['say'].lower()) else (ear.phon(h) if h else '')
            tail = tail_burst(audio)
            if got == target:  # the clip is cut to Kokoro's own word span, so nothing trails it
                to_mp3(finish(audio), os.path.join(out_dir, f'{k}.mp3'))
                del pending[k]
                best.pop(k, None)
                passed += 1
                continue
            score = difflib.SequenceMatcher(None, got, target).ratio() - tail
            if k not in best or score > best[k][0]:
                best[k] = (score, audio, h)
        print(f'  round {rnd} ({tmpl!r}, speed {speed}): {passed} passed, {len(pending)} still to verify', flush=True)
    unverified = []
    for k, it in pending.items():
        _, audio, h = best[k]
        to_mp3(finish(audio), os.path.join(out_dir, f'{k}.mp3'))
        unverified.append({'text': it['text'], 'heard': h})
    return unverified


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
    ap.add_argument('--verify', action='store_true', help='record single words several ways and keep a take Whisper recognises')
    ap.add_argument('--report', default='', help='with --verify: write words with no passing take to this JSON file')
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
    unverified = []
    ear = Ear(pipe) if args.verify else None
    t0 = time.time()
    if args.verify:
        words = [it for it in items if ' ' not in it['say'].strip()]
        items = [it for it in items if ' ' in it['say'].strip()]
        print(f'{len(words)} single words (verified), {len(items)} phrases and sentences.')
        unverified = record_words_verified(pipe, ear, words, args.voice, out_dir)
        done += len(words)
        write_manifest(out_dir, args.voice)
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
    if args.verify:
        print(f'{len(unverified)} words had no take Whisper recognised (closest take kept).')
        if args.report:
            json.dump(unverified, open(args.report, 'w'), indent=1, ensure_ascii=False)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()

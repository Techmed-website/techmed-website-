#!/usr/bin/env node
// Records the British English clips for /oral-english.
//
// Two engines, same pronunciation rules (describe() below):
//
//  Kokoro (default, free, runs on your own machine, no account):
//    node scripts/generate-oral-audio.mjs --texts oral-audio-texts.json --plan plan.json
//    python scripts/kokoro_render.py --plan plan.json        # needs Python 3.10-3.12 + kokoro
//
//  Google Cloud Text-to-Speech (needs an API key with billing):
//    GOOGLE_TTS_API_KEY=... node scripts/generate-oral-audio.mjs --texts oral-audio-texts.json --engine google
//
// --texts   The JSON returned by the admin-only database function public.oral_audio_texts()
//           (Listen content + Word Bank + every prompt/option the results screen can play).
//           Export it with an admin account; it is NOT committed (this repo is public).
// --plan    Write what still needs recording (text, words to say, IPA, emphasis) for kokoro_render.py.
// --dry-run Count and preview what would be recorded; no recording.
// --review  Also write an HTML page listing every clip with its text, so a person can
//           spot-check them (see the brief's list: plait, heir, colonel, buoy, ...).
//
// Each clip is saved once as public/audio/oral/<key>.mp3; existing files are skipped,
// so re-running only fills gaps. public/audio/oral/manifest.json lists every clip that
// exists; the page only requests clips in the manifest and uses the phone's voice for the rest.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipKey, clipText } from '../src/lib/oralAudioKey.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, '../public/audio/oral');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const DRY = args.includes('--dry-run');
const TEXTS = opt('texts');
const VOICE = opt('voice', 'en-GB-Neural2-A');
const REVIEW = opt('review');
const PLAN = opt('plan');
const ENGINE = opt('engine', PLAN ? 'kokoro' : 'google');
const CONCURRENCY = 4;

if (!TEXTS) { console.error('Pass --texts <file.json> (output of public.oral_audio_texts()).'); process.exit(1); }

// ---------------------------------------------------------------------------
// Words whose pronunciation depends on meaning or part of speech: give the voice
// the British IPA so it cannot guess wrong.
// ---------------------------------------------------------------------------
const NOUN_VERB = {
  export: ['ˈekspɔːt', 'ɪkˈspɔːt'], insult: ['ˈɪnsʌlt', 'ɪnˈsʌlt'], record: ['ˈrekɔːd', 'rɪˈkɔːd'],
  conduct: ['ˈkɒndʌkt', 'kənˈdʌkt'], conflict: ['ˈkɒnflɪkt', 'kənˈflɪkt'], contest: ['ˈkɒntest', 'kənˈtest'],
  contract: ['ˈkɒntrækt', 'kənˈtrækt'], convict: ['ˈkɒnvɪkt', 'kənˈvɪkt'], desert: ['ˈdezət', 'dɪˈzɜːt'],
  import: ['ˈɪmpɔːt', 'ɪmˈpɔːt'], increase: ['ˈɪŋkriːs', 'ɪnˈkriːs'], object: ['ˈɒbdʒɪkt', 'əbˈdʒekt'],
  permit: ['ˈpɜːmɪt', 'pəˈmɪt'], present: ['ˈpreznt', 'prɪˈzent'], produce: ['ˈprɒdjuːs', 'prəˈdjuːs'],
  progress: ['ˈprəʊɡres', 'prəˈɡres'], project: ['ˈprɒdʒekt', 'prəˈdʒekt'], protest: ['ˈprəʊtest', 'prəˈtest'],
  rebel: ['ˈrebl', 'rɪˈbel'], refuse: ['ˈrefjuːs', 'rɪˈfjuːz'], subject: ['ˈsʌbdʒɪkt', 'səbˈdʒekt'],
  suspect: ['ˈsʌspekt', 'səˈspekt'], transport: ['ˈtrænspɔːt', 'trænˈspɔːt'], reject: ['ˈriːdʒekt', 'rɪˈdʒekt'],
  frequent: ['ˈfriːkwənt', 'friˈkwent'], mouth: ['maʊθ', 'maʊð'],
};
const SENSE = {
  'tear (from the eye)': 'tɪə', 'tear (noun)': 'tɪə', 'tear (to rip)': 'teə', 'tear (verb)': 'teə',
  'wind (air)': 'wɪnd', 'wind (a clock)': 'waɪnd', 'wound (injury)': 'wuːnd',
  'bow (bend)': 'baʊ', 'bow (ribbon)': 'bəʊ', 'row (line)': 'rəʊ', 'row (quarrel)': 'raʊ',
  'lead (metal)': 'led', 'lead (guide)': 'liːd', 'read (present)': 'riːd', 'read (past)': 'red',
  'live (verb)': 'lɪv', 'live (adjective)': 'laɪv', 'close (near)': 'kləʊs', 'close (shut)': 'kləʊz',
  'minute (time)': 'ˈmɪnɪt', 'minute (tiny)': 'maɪˈnjuːt', 'use (noun)': 'juːs', 'use (verb)': 'juːz',
  'dove (bird)': 'dʌv', 'dove (dived)': 'dəʊv',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isPattern = (w) => /[a-z]/.test(w) && /[A-Z]{2}|[a-z][A-Z]/.test(w);

/**
 * How one item is read, independent of the voice engine:
 *   say   the words to speak (stress capitals removed)
 *   ipa   exact British IPA for the whole item, when meaning or part of speech decides it
 *   emph  the word(s) to stress strongly, for emphatic-stress sentences
 */
export function describe(raw) {
  const text = clipText(raw);
  const lower = text.toLowerCase();
  const m = text.match(/^(.+?)\s*\(([^)]+)\)$/);
  const base = (m ? m[1] : text).replace(/[-\u2014]/g, '');

  const sense = SENSE[lower.replace(/[-\u2014]/g, '')];
  if (sense) return { say: base.toLowerCase(), ipa: sense, emph: [], how: `IPA /${sense}/` };

  const nv = NOUN_VERB[base.toLowerCase()];
  if (nv) {
    let which = m ? (/(verb)/i.test(m[2]) ? 1 : /(noun|adjective)/i.test(m[2]) ? 0 : -1) : -1;
    if (which < 0 && isPattern(base)) which = /^[A-Z]{2}/.test(base) ? 0 : 1; // EXport vs exPORT
    if (which >= 0) return { say: base.toLowerCase(), ipa: nv[which], emph: [], how: `IPA /${nv[which]}/` };
  }

  if (/\s/.test(base) && /\b[A-Z][A-Z']+\b/.test(base)) {
    const emph = [];
    let first = true;
    const say = base.split(/(\b[A-Z][A-Z']+(?:\s+[A-Z][A-Z']+)*\b)/).map((part) => {
      if (!part) return '';
      const caps = /^[A-Z][A-Z']+(?:\s+[A-Z][A-Z']+)*$/.test(part);
      const atStart = first; first = false;
      if (!caps) return part;
      let w = part.toLowerCase();
      if (atStart) w = w.charAt(0).toUpperCase() + w.slice(1);
      emph.push(w);
      return w;
    }).join('');
    return { say, ipa: null, emph, how: `emphasis on "${emph.join(' ')}"` };
  }

  return { say: isPattern(base) ? base.toLowerCase() : base, ipa: null, emph: [], how: isPattern(base) ? 'natural stress' : 'plain' };
}

/** SSML for Google Text-to-Speech. */
export function toSsml(raw) {
  const d = describe(raw);
  if (d.ipa) return { ssml: `<speak><phoneme alphabet="ipa" ph="${d.ipa}">${esc(d.say)}</phoneme></speak>`, how: d.how };
  let body = esc(d.say);
  for (const w of d.emph) body = body.replace(esc(w), `<emphasis level="strong">${esc(w)}</emphasis>`);
  return { ssml: `<speak>${body}</speak>`, how: d.how };
}

// ---------------------------------------------------------------------------
function collect(data) {
  const items = [];
  const walk = (v) => {
    if (typeof v === 'string') items.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'ipa') walk(x);
  };
  const L = data.listen || {};
  for (const [k, v] of Object.entries(L)) if (!/_note$/.test(k)) walk(v);
  walk(data.words || []);
  walk(data.question_texts || []);
  const byKey = new Map();
  for (const t of items) {
    const c = clipText(t);
    if (!c || / of the above$/i.test(c)) continue;
    byKey.set(clipKey(c), c);
  }
  return byKey;
}

async function synth(ssml) {
  const headers = { 'Content-Type': 'application/json' };
  // With a network proxy that injects the key, any placeholder works here.
  headers['X-Goog-Api-Key'] = process.env.GOOGLE_TTS_API_KEY || 'injected-by-proxy';
  const body = {
    input: { ssml },
    voice: { languageCode: 'en-GB', name: VOICE },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 0.9, sampleRateHertz: 24000 },
  };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) return Buffer.from((await res.json()).audioContent, 'base64');
    const msg = await res.text();
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`TTS ${res.status}: ${msg.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

function writeManifest() {
  const keys = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)).sort();
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ voice: VOICE, generated_at: new Date().toISOString(), keys }, null, 0) + '\n');
  return keys.length;
}

function writeReview(entries) {
  const rows = entries.map(([k, t]) => {
    const { how } = toSsml(t);
    return `<tr><td><button onclick="new Audio('/audio/oral/${k}.mp3').play()">▶</button></td><td>${esc(t)}</td><td>${esc(how)}</td></tr>`;
  }).join('\n');
  fs.writeFileSync(REVIEW, `<!doctype html><meta charset="utf-8"><title>Oral English clips</title>
<style>body{font:16px system-ui;margin:16px}td{padding:4px 8px;border-bottom:1px solid #ddd}input{font-size:16px;padding:6px;width:100%;margin-bottom:8px}</style>
<input placeholder="Filter" oninput="for(const r of document.querySelectorAll('tr'))r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase())">
<table>${rows}</table>`);
  console.log(`Review page: ${REVIEW} (serve it from web/public or open next to the clips)`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(TEXTS, 'utf8'));
  const all = collect(data);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const todo = [...all].filter(([k]) => !fs.existsSync(path.join(OUT_DIR, `${k}.mp3`)));
  const chars = todo.reduce((n, [, t]) => n + toSsml(t).ssml.length, 0);
  console.log(`${all.size} clips in total, ${all.size - todo.length} already recorded, ${todo.length} to record (~${chars.toLocaleString()} characters of SSML). Voice ${VOICE}.`);

  if (PLAN) {
    const items = todo.map(([key, text]) => ({ key, text, ...describe(text) }));
    fs.writeFileSync(PLAN, JSON.stringify({ out_dir: OUT_DIR, items }, null, 1));
    console.log(`Plan with ${items.length} clips written to ${PLAN}. Next: python scripts/kokoro_render.py --plan ${PLAN}`);
    if (REVIEW) writeReview([...all]);
    return;
  }
  if (ENGINE !== 'google') { console.error('Use --plan for Kokoro, or --engine google.'); process.exit(1); }

  if (DRY) {
    const samples = ['EXport (noun)', 'exPORT (verb)', 'tear (to rip)', 'I DIDN’T take your pen.', 'KUNLE ran to school.', 'phoTOgraphy', 'colonel'];
    for (const s of samples) console.log(`  ${s.padEnd(26)} ${toSsml(s).ssml}`);
    if (REVIEW) writeReview([...all]);
    return;
  }

  let done = 0, failed = 0;
  const queue = todo.slice();
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [key, text] = item;
      try {
        const mp3 = await synth(toSsml(text).ssml);
        fs.writeFileSync(path.join(OUT_DIR, `${key}.mp3`), mp3);
        done++;
      } catch (e) {
        failed++;
        console.error(`  failed: ${text}: ${e.message}`);
        if (failed >= 10 && done === 0) { queue.length = 0; }
      }
      if ((done + failed) % 100 === 0) { console.log(`  ${done + failed}/${todo.length}`); writeManifest(); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const total = writeManifest();
  console.log(`Recorded ${done}, failed ${failed}. Manifest lists ${total} clips.`);
  if (REVIEW) writeReview([...all]);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });

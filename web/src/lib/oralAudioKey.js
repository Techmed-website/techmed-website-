// Shared by the Oral English page (browser) and scripts/generate-oral-audio.mjs (Node),
// so both always agree on which MP3 belongs to which word or sentence.
// Plain JavaScript on purpose: Node imports it without a build step.

/** The text a clip is recorded from: tags removed, quotes straightened, spaces tidied. */
export function clipText(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
}

// cyrb53: small, fast, synchronous string hash. Synchronous matters: iOS only
// lets a page start audio inside the tap handler itself, with no await before it.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** File name (without .mp3) for a word or sentence. Case matters: EXport and exPORT differ. */
export function clipKey(text) {
  return cyrb53(clipText(text)).toString(36);
}

const STRESS_MARKED = /[a-z]/;
const INNER_CAPS = /[A-Z]{2}|[a-z][A-Z]/;

/**
 * Plain words for a voice that cannot be told about stress (the phone's own
 * voice): "exPORT (verb)" -> "export", "I DIDN'T take your pen." -> "I didn't take your pen."
 */
export function spokenText(text) {
  let s = clipText(text).replace(/\s*\([^)]*\)\s*$/, '');
  s = s.replace(/[-—]/g, (m, i) => (/[A-Za-z]/.test(s[i - 1] || '') && /[A-Za-z]/.test(s[i + 1] || '') ? '' : m));
  const out = s.replace(/[A-Za-z']+/g, (w) => {
    if (w === 'I') return w;
    if (STRESS_MARKED.test(w) && INNER_CAPS.test(w)) return w.toLowerCase();
    if (/^[A-Z']{2,}$/.test(w)) return w.toLowerCase();
    return w;
  });
  // Keep a sentence's opening capital ("KUNLE ran" -> "Kunle ran", not "kunle ran").
  return /^[A-Z]/.test(s) && / /.test(s) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

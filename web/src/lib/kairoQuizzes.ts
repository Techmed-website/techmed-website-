// KAIRO quizzes for the public website (the "shop window"). Read-only, no sign-in, no answers: these call the
// cbt.public_* functions in Supabase, which return quiz cards and an initials-only top-10. Safe in the browser and
// in the server-rendered /quizzes/[slug] page.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

export const KAIRO_URL = 'https://kairo.techmedng.com';

export interface KairoQuiz {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  type: 'daily_quiz' | 'challenge' | 'topic_test' | 'weekly_drill' | 'mock' | 'practice';
  subject: string | null;
  subject_code: string | null;
  topic_label: string | null;
  day_number: number | null;
  question_count: number;
  time_limit_sec: number | null;
  opens_at: string | null;
  closes_at: string | null;
  status: 'scheduled' | 'live' | 'closed' | 'archived' | 'draft';
  featured: boolean;
  ranked: boolean;
  guests_allowed: boolean;
  prize_text: string | null;
  max_winners: number | null;
  share_image_url: string | null;
  has_passcode: boolean;
  attempts_count: number;
  players: number;
  url: string;
}

export interface BoardRow {
  rank: number;
  initials: string;
  score: number;
  total: number;
  duration_sec: number | null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>, timeoutMs = 6000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'cbt',
        'Accept-Profile': 'cbt',
      },
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${fn}: ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const getKairoQuiz = (slug: string) => rpc<KairoQuiz | null>('public_quiz', { p_slug: slug });
export const getKairoQuizzes = () => rpc<KairoQuiz[]>('public_quizzes', {});
export const getKairoBoard = (id: string, limit = 10) => rpc<BoardRow[]>('public_leaderboard', { p_assessment: id, p_limit: limit });

/** Where the Start button goes: straight into the quiz on KAIRO (sign-in or guest play happens there). */
export const startUrl = (q: Pick<KairoQuiz, 'id'>) => `${KAIRO_URL}/q/${q.id}`;

/** What state the landing page should show right now. */
export function quizState(q: KairoQuiz, now = Date.now()): 'scheduled' | 'open' | 'closed' {
  if (q.status === 'closed' || q.status === 'archived') return 'closed';
  if (q.closes_at && Date.parse(q.closes_at) <= now) return 'closed';
  if (q.status === 'scheduled' || (q.opens_at && Date.parse(q.opens_at) > now)) return 'scheduled';
  return 'open';
}

/** Branded 1200×630 link-preview image (WhatsApp needs JPG/PNG). */
export function ogImageFor(q: Pick<KairoQuiz, 'type' | 'subject_code' | 'share_image_url' | 'title'>): string {
  if (q.share_image_url) return q.share_image_url;
  if (q.type === 'challenge') return '/images/quiz-og/challenge.jpg';
  const bySubject: Record<string, string> = { BIO: 'biology', CHM: 'chemistry', PHY: 'physics', MTH: 'mathematics', ENG: 'english' };
  if (q.subject_code && bySubject[q.subject_code]) return `/images/quiz-og/${bySubject[q.subject_code]}.jpg`;
  if (/Mixed Science/.test(q.title)) return '/images/quiz-og/mixed-science.jpg';
  if (/UTME Mix/.test(q.title)) return '/images/quiz-og/utme-mix.jpg';
  return '/images/quiz-og/quiz.jpg';
}

/** "Day 13: Biology" and "Evolution among organisms" from the long daily title; other quizzes keep their title. */
export function displayTitle(q: Pick<KairoQuiz, 'type' | 'title' | 'day_number'>): { heading: string; sub: string | null } {
  const m = q.type === 'daily_quiz' ? q.title.match(/—\s*(Day \d+:\s*[^(]+?)\s*\((.+)\)\s*$/) : null;
  return m ? { heading: m[1], sub: m[2] } : { heading: q.title, sub: null };
}

export const minutes = (sec: number | null) => (sec ? `${Math.round(sec / 60)} minute${Math.round(sec / 60) === 1 ? '' : 's'}` : null);
export const clock = (sec: number | null) => (sec == null ? '—' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);

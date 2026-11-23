// TECHMED Quiz Hub: build-time quiz data for the public /quizzes pages.
// Only PUBLIC card fields are read here. Locked links and passcodes are
// sealed in Sanity and are only ever handed out by the quiz-access server,
// to students who can open the quiz.
import { fetchSanity } from './sanity';
export { QUIZ_ACCESS_URL, WHATSAPP_NUMBER } from './quizConstants';

export type QuizCategory = 'free' | 'paid' | 'book' | 'programme';

export interface PublicQuiz {
  id: string;
  slug: string;
  title: string;
  shortDescription?: string | null;
  subject?: string | null;
  topic?: string | null;
  programme?: string | null;
  questionCount?: number | null;
  durationMinutes?: number | null;
  coverImage?: string | null;
  featured?: boolean;
  category: QuizCategory;
  minimumPlan?: 'core' | 'mastery' | 'ultimate' | null;
  bookSlug?: string | null;
  bookTitle?: string | null;
  platform?: string | null;
  status: 'Live' | 'Closed';
  comingSoon?: boolean;
  opensAt?: string | null;
  closesAt?: string | null;
  comingSoonText?: string | null;
  /** Public link: free quizzes only. */
  quizUrl?: string | null;
  createdAt: string;
}

const FILTER = `_type == "quiz" && !(_id in path("drafts.**")) && category != "hidden" && status in ["Live", "Closed"] && defined(slug.current)`;
const PROJECTION = `{
  "id": _id, "slug": slug.current, title, shortDescription, subject, topic, programme,
  questionCount, durationMinutes, "coverImage": coverImage.asset->url, featured, category, minimumPlan,
  "bookSlug": linkedResource->slug.current, "bookTitle": linkedResource->title, platform, status,
  comingSoon, opensAt, closesAt, comingSoonText,
  "quizUrl": select(category == "free" => quizUrl, null),
  "createdAt": _createdAt
}`;
const QUERY = `*[${FILTER}]${PROJECTION} | order(_createdAt desc)`;

export async function getPublicQuizzes(): Promise<PublicQuiz[]> {
  const quizzes = await fetchSanity<PublicQuiz[]>(QUERY, []);
  // Never ship test entries to public pages.
  return (quizzes || []).filter((q) => q && q.slug && !/^test\b/i.test(q.title));
}

export const PLAN_LABEL: Record<string, string> = { core: 'Core', mastery: 'Mastery', ultimate: 'Ultimate' };

export function accessLabel(q: Pick<PublicQuiz, 'category' | 'minimumPlan' | 'bookTitle'>): string {
  if (q.category === 'free') return 'Free for everyone';
  if (q.category === 'book') return q.bookTitle ? `Free with ${q.bookTitle}` : 'Book owners';
  if (q.category === 'paid') {
    const p = q.minimumPlan ?? 'core';
    return p === 'ultimate' ? 'Ultimate students' : p === 'mastery' ? 'Mastery & Ultimate students' : 'Core, Mastery & Ultimate students';
  }
  return 'TECHMED programme';
}

/**
 * One quiz by slug, read at request time (the /quizzes/[slug] page is rendered on demand so KAIRO's daily quizzes
 * work the moment they are published). Same public fields as above; the dataset is public, so no token is used.
 */
export async function getSanityQuizBySlug(slug: string): Promise<PublicQuiz | null> {
  const query = `*[${FILTER} && slug.current == $slug][0]${PROJECTION}`;
  const url = `https://kxoz58eb.apicdn.sanity.io/v2024-01-01/data/query/production?query=${encodeURIComponent(query)}&$slug=${encodeURIComponent(JSON.stringify(slug))}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const q = ((await res.json()) as { result: PublicQuiz | null }).result;
    return q && q.slug && !/^test\b/i.test(q.title) ? q : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

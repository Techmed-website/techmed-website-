-- TECHMED Oral English Guide: the interactive page at /oral-english.
--
-- One product unlocks everything: buying 'oral-english-guide' (or being given
-- it by an admin / a plan) opens the Listen section, the Word Bank and all
-- five Challenges. Admins can always open the page to test it.
--
-- CONTENT IS NOT IN THIS FILE. This repository is public, so the question
-- bank (with answers) and the book's word lists are loaded straight into the
-- database, never committed. Tables:
--   oral_content    one row per Listen block (vowel cards, pairs, ...), jsonb
--   oral_questions  the five challenge banks (answer + explanation server-only)
--   oral_words      the Word Bank (every word students can hear)
--   oral_attempts   one row per challenge attempt; scoring happens here
--   oral_reports    "this pronunciation sounds wrong" reports from students
--
-- RLS is on for every table and there are no read policies: the browser only
-- reaches the data through the SECURITY DEFINER functions below, which check
-- access first. Answers and explanations leave the server only after submit.
--
-- The product starts INACTIVE (not on sale). Set the price, then:
--   UPDATE public.products SET is_active = true, updated_at = now()
--   WHERE id = 'oral-english-guide';

-- ---------------------------------------------------------------------------
-- 1. Product
-- ---------------------------------------------------------------------------
INSERT INTO public.products (id, title, subtitle, product_type, price_ngn, is_active, is_bundle, bundle_item_ids, requires_university, metadata)
VALUES ('oral-english-guide', 'TECHMED Oral English Guide',
        'Hear every sound, every word and every stress pattern, then test yourself on 421 questions.',
        'resource', 2000, false, false, '{}', false,
        jsonb_build_object('format', 'ebook', 'interactive_page', '/oral-english',
                           'price_confirmed', false))
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  metadata = public.products.metadata || EXCLUDED.metadata,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_content (
  key        TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oral_questions (
  id          SERIAL PRIMARY KEY,
  part        SMALLINT NOT NULL CHECK (part BETWEEN 1 AND 5),
  position    INTEGER NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('JAMB', 'TECHMED Practice Question')),
  instruction TEXT NOT NULL,
  prompt      TEXT NOT NULL DEFAULT '',
  options     JSONB NOT NULL,            -- [{"letter":"A","text":"..."}, ...]
  answer      TEXT NOT NULL,             -- letter
  explanation TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (part, position)
);

CREATE TABLE IF NOT EXISTS public.oral_words (
  word     TEXT PRIMARY KEY,
  note     TEXT,                          -- short hint, e.g. "the b is silent"
  origin   TEXT NOT NULL DEFAULT 'extra'  -- 'book', 'question' or 'extra'
);

CREATE TABLE IF NOT EXISTS public.oral_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  part         SMALLINT NOT NULL CHECK (part BETWEEN 1 AND 5),
  items        JSONB NOT NULL,            -- [{"q":id,"order":["C","A","D","B"]}, ...]
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline     TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  answers      JSONB,                     -- [index or null, ...] in displayed order
  score        INTEGER,
  total        INTEGER NOT NULL,
  late         BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_oral_attempts_user ON public.oral_attempts (user_id, part, started_at DESC);

CREATE TABLE IF NOT EXISTS public.oral_reports (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved   BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE public.oral_content   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_words     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_reports   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read oral reports" ON public.oral_reports;
CREATE POLICY "Admins read oral reports" ON public.oral_reports
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admins resolve oral reports" ON public.oral_reports;
CREATE POLICY "Admins resolve oral reports" ON public.oral_reports
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------------

-- Does the signed-in student own the book? (Admins always pass.)
CREATE OR REPLACE FUNCTION public.oral_has_access()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.is_admin() OR public.has_resource_access('oral-english-guide'));
$$;

CREATE OR REPLACE FUNCTION public.oral_require_access()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sign_in_required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.oral_has_access() THEN
    RAISE EXCEPTION 'not_entitled' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Everything the page needs on open, in one round trip:
-- Listen content, Word Bank and the student's own challenge stats.
CREATE OR REPLACE FUNCTION public.oral_page()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  PERFORM public.oral_require_access();
  RETURN jsonb_build_object(
    'listen', COALESCE((SELECT jsonb_object_agg(key, data) FROM public.oral_content), '{}'::jsonb),
    'words', COALESCE((SELECT jsonb_agg(jsonb_build_object('w', word, 'n', note) ORDER BY lower(word), word)
                       FROM public.oral_words), '[]'::jsonb),
    'banks', COALESCE((SELECT jsonb_object_agg(part, n) FROM (
                         SELECT part, count(*) AS n FROM public.oral_questions WHERE is_active GROUP BY part) b), '{}'::jsonb),
    'stats', COALESCE((SELECT jsonb_object_agg(part, s) FROM (
                         SELECT part, jsonb_build_object(
                                  'attempts', count(*),
                                  'best', max(score),
                                  'last', (array_agg(score ORDER BY submitted_at DESC))[1],
                                  'total', max(total)) AS s
                         FROM public.oral_attempts
                         WHERE user_id = v_uid AND submitted_at IS NOT NULL
                         GROUP BY part) x), '{}'::jsonb)
  );
END;
$$;

-- Shape a stored attempt for the browser (no answers, no explanations).
CREATE OR REPLACE FUNCTION public.oral_attempt_questions(p_items JSONB)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source', q.source,
           'instruction', q.instruction,
           'prompt', q.prompt,
           'options', (SELECT jsonb_agg((SELECT o->>'text' FROM jsonb_array_elements(q.options) o
                                         WHERE o->>'letter' = l.letter) ORDER BY l.ord)
                       FROM jsonb_array_elements_text(it.value->'order') WITH ORDINALITY AS l(letter, ord))
         ) ORDER BY it.ord), '[]'::jsonb)
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS it(value, ord)
  JOIN public.oral_questions q ON q.id = (it.value->>'q')::int;
$$;

-- Start (or resume) a challenge: 20 random questions, options reshuffled,
-- 10 minutes. An unfinished attempt that is still in time is resumed, so a
-- refresh or a dropped connection never costs the student their work.
CREATE OR REPLACE FUNCTION public.oral_start(p_part INTEGER)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_att   public.oral_attempts;
  v_items JSONB;
  v_count CONSTANT INTEGER := 20;
  v_secs  CONSTANT INTEGER := 600;
BEGIN
  PERFORM public.oral_require_access();
  IF p_part IS NULL OR p_part NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'bad_part' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_att FROM public.oral_attempts
  WHERE user_id = v_uid AND part = p_part AND submitted_at IS NULL AND deadline > now()
  ORDER BY started_at DESC LIMIT 1;

  IF NOT FOUND THEN
    -- Keep "none of the above" / "all of the above" in last place; shuffle the rest.
    SELECT jsonb_agg(jsonb_build_object('q', id, 'order', ord))
    INTO v_items
    FROM (
      SELECT q.id,
             (SELECT jsonb_agg(o->>'letter' ORDER BY
                       (o->>'text') ~* '^(none|all) of the above$', random())
              FROM jsonb_array_elements(q.options) o) AS ord
      FROM public.oral_questions q
      WHERE q.part = p_part AND q.is_active
      ORDER BY random()
      LIMIT v_count
    ) pick;

    IF v_items IS NULL THEN
      RAISE EXCEPTION 'no_questions' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.oral_attempts (user_id, part, items, deadline, total)
    VALUES (v_uid, p_part, v_items, now() + make_interval(secs => v_secs), jsonb_array_length(v_items))
    RETURNING * INTO v_att;
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_att.id,
    'part', v_att.part,
    'started_at', v_att.started_at,
    'deadline', v_att.deadline,
    'server_now', now(),
    'questions', public.oral_attempt_questions(v_att.items)
  );
END;
$$;

-- Submit answers (array of chosen option index, 0-based, or null per question).
-- Scored here. Submitting twice returns the first result. A submission after
-- the deadline is still marked (the student keeps their work) and flagged late.
CREATE OR REPLACE FUNCTION public.oral_submit(p_attempt UUID, p_answers JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_att   public.oral_attempts;
  v_score INTEGER;
  v_ans   JSONB;
BEGIN
  PERFORM public.oral_require_access();

  SELECT * INTO v_att FROM public.oral_attempts
  WHERE id = p_attempt AND user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_att.submitted_at IS NULL THEN
    IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' THEN
      p_answers := '[]'::jsonb;
    END IF;
    -- Normalise: one entry per question, an integer in range or null.
    SELECT jsonb_agg(
             CASE WHEN jsonb_typeof(p_answers -> (i - 1)) = 'number'
                       AND (p_answers ->> (i - 1))::numeric = floor((p_answers ->> (i - 1))::numeric)
                       AND (p_answers ->> (i - 1))::int >= 0
                       AND (p_answers ->> (i - 1))::int < jsonb_array_length(v_att.items -> (i - 1) -> 'order')
                  THEN to_jsonb((p_answers ->> (i - 1))::int)
                  ELSE 'null'::jsonb END
             ORDER BY i)
    INTO v_ans
    FROM generate_series(1, jsonb_array_length(v_att.items)) AS i;

    SELECT count(*) INTO v_score
    FROM jsonb_array_elements(v_att.items) WITH ORDINALITY AS it(value, ord)
    JOIN public.oral_questions q ON q.id = (it.value->>'q')::int
    WHERE jsonb_typeof(v_ans -> (it.ord::int - 1)) = 'number'
      AND it.value->'order'->>((v_ans ->> (it.ord::int - 1))::int) = q.answer;

    UPDATE public.oral_attempts
    SET submitted_at = now(),
        answers = v_ans,
        score = v_score,
        late = now() > deadline + interval '60 seconds'
    WHERE id = v_att.id
    RETURNING * INTO v_att;
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_att.id,
    'part', v_att.part,
    'score', v_att.score,
    'total', v_att.total,
    'late', v_att.late,
    'questions', (
      SELECT jsonb_agg(jsonb_build_object(
               'source', q.source,
               'instruction', q.instruction,
               'prompt', q.prompt,
               'options', (SELECT jsonb_agg((SELECT o->>'text' FROM jsonb_array_elements(q.options) o
                                             WHERE o->>'letter' = l.letter) ORDER BY l.ord)
                           FROM jsonb_array_elements_text(it.value->'order') WITH ORDINALITY AS l(letter, ord)),
               'correct', (SELECT l.ord - 1 FROM jsonb_array_elements_text(it.value->'order') WITH ORDINALITY AS l(letter, ord)
                           WHERE l.letter = q.answer),
               'chosen', v_att.answers -> (it.ord::int - 1),
               'explanation', q.explanation
             ) ORDER BY it.ord)
      FROM jsonb_array_elements(v_att.items) WITH ORDINALITY AS it(value, ord)
      JOIN public.oral_questions q ON q.id = (it.value->>'q')::int
    )
  );
END;
$$;

-- "This sounds wrong" report. Limited to 30 a day per student.
CREATE OR REPLACE FUNCTION public.oral_report(p_text TEXT, p_note TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.oral_require_access();
  IF coalesce(btrim(p_text), '') = '' THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM public.oral_reports
      WHERE user_id = auth.uid() AND created_at > now() - interval '1 day') >= 30 THEN
    RETURN false;
  END IF;
  INSERT INTO public.oral_reports (user_id, text, note)
  VALUES (auth.uid(), left(btrim(p_text), 200), left(btrim(p_note), 500));
  RETURN true;
END;
$$;

-- Every text that should have a recorded clip (admin only; used by the audio
-- generator export). Returns plain text items; the generator decides SSML.
CREATE OR REPLACE FUNCTION public.oral_audio_texts()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins_only' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'listen', COALESCE((SELECT jsonb_object_agg(key, data) FROM public.oral_content), '{}'::jsonb),
    'words', COALESCE((SELECT jsonb_agg(word ORDER BY word) FROM public.oral_words), '[]'::jsonb),
    -- Every prompt and option the results screen can play. Not Emphatic Stress
    -- options (they are questions), not "none of the above", and in stress-pattern
    -- questions only the correct pattern (a clip of a wrong pattern would teach it).
    'question_texts', COALESCE((
      SELECT jsonb_agg(DISTINCT t ORDER BY t) FROM (
        SELECT q.prompt AS t FROM public.oral_questions q
        WHERE q.prompt <> '' AND q.prompt !~* '^the sound ' AND q.prompt !~ '\?$'
        UNION
        SELECT o->>'text' FROM public.oral_questions q, jsonb_array_elements(q.options) o
        WHERE q.part <> 4
          AND (o->>'text') !~* ' of the above$'
          AND (q.part <> 3
               OR o->>'letter' = q.answer
               OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(q.options) o2
                              WHERE regexp_replace(o2->>'text', '\s*\(.*\)$', '') ~ '[a-z]'
                                AND regexp_replace(o2->>'text', '\s*\(.*\)$', '') ~ '[A-Z]{2}|[a-z][A-Z]'))
      ) s), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.oral_has_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oral_require_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oral_page() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oral_attempt_questions(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oral_start(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oral_submit(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oral_report(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oral_audio_texts() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.oral_has_access()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.oral_page()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.oral_start(INTEGER)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.oral_submit(UUID, JSONB)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.oral_report(TEXT, TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.oral_audio_texts()        TO authenticated;

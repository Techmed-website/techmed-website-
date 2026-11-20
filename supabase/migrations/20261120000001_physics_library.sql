-- TECHMED Physics in the Library (Think Smart Series, First Edition 2027).
--
-- physics-calculation-workbook  ₦3,000. Core 20% off (pay-initiate plan
--   discount). product_type 'bundle' so buying it also grants the Formula Bank
--   (the Formula Bank is its back matter; buyers are never charged twice).
--   Inactive until physics-calculation-workbook.pdf is uploaded to the private
--   paid-resources bucket. To put it on sale:
--     UPDATE public.products SET is_active = true, updated_at = now()
--     WHERE id = 'physics-calculation-workbook';
-- physics-master-formula-bank   ₦1,000 for everyone (metadata.plan_discount
--   = false turns the Core discount off; set it to true to allow it).
-- Physics Challenge: sold on QuizBoot (public link) and unlocked for Workbook
--   owners through a Sanity "Book bonus" quiz, so it needs no product row.
-- Mastery and Ultimate include both books (updating bundle_item_ids fires the
--   sync trigger, so current plan holders get access straight away).
INSERT INTO public.products (id, title, subtitle, product_type, price_ngn, compare_at_price_ngn, is_active, is_bundle, bundle_item_ids, requires_university, metadata)
VALUES
  ('physics-master-formula-bank', 'TECHMED Physics Master Formula Bank',
   'Every UTME Physics formula, what each symbol means, and how to recognise the question that needs it.',
   'resource', 1000, NULL, true, false, '{}', false,
   jsonb_build_object('series', 'Think Smart Series', 'edition', 'First Edition 2027', 'format', 'ebook', 'plan_discount', false)),
  ('physics-calculation-workbook', 'TECHMED Physics Calculation Workbook',
   'Understand the Formula. Master the Method. Solve with Confidence.',
   'bundle', 3000, NULL, false, false, ARRAY['physics-master-formula-bank'], false,
   jsonb_build_object('series', 'Think Smart Series', 'edition', 'First Edition 2027', 'format', 'ebook', 'includes', 'Master Formula Bank (back matter); Physics Challenge private link'))
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  product_type = EXCLUDED.product_type,
  price_ngn = EXCLUDED.price_ngn,
  bundle_item_ids = EXCLUDED.bundle_item_ids,
  metadata = public.products.metadata || EXCLUDED.metadata,
  updated_at = now();

UPDATE public.products
SET bundle_item_ids = (
      SELECT array_agg(DISTINCT x ORDER BY x)
      FROM unnest(bundle_item_ids || ARRAY['physics-calculation-workbook', 'physics-master-formula-bank']) AS x
    ),
    updated_at = now()
WHERE id IN ('cohort-mastery', 'cohort-mastery-earlybird', 'cohort-mastery-standard', 'mastery',
             'cohort-ultimate', 'ultimate');

-- Oral English Guide: price confirmed at ₦1,000, and included in Mastery and Ultimate.
--
-- The product stays INACTIVE (no checkout) until the book's PDF is uploaded, as with
-- the Physics Workbook. Plan holders get access now anyway: updating bundle_item_ids
-- fires the sync trigger, which writes their entitlements, and resource_access_for()
-- does not look at is_active. To put it on sale once the PDF is in paid-resources:
--   UPDATE public.products SET is_active = true,
--          metadata = metadata || jsonb_build_object('file_path', '<file>.pdf'), updated_at = now()
--   WHERE id = 'oral-english-guide';
UPDATE public.products
SET price_ngn = 1000,
    metadata = metadata || jsonb_build_object('price_confirmed', true),
    updated_at = now()
WHERE id = 'oral-english-guide';

UPDATE public.products
SET bundle_item_ids = (
      SELECT array_agg(DISTINCT x ORDER BY x)
      FROM unnest(bundle_item_ids || ARRAY['oral-english-guide']) AS x
    ),
    updated_at = now()
WHERE id IN ('cohort-mastery', 'cohort-mastery-earlybird', 'cohort-mastery-standard', 'mastery',
             'cohort-ultimate', 'ultimate');

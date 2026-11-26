-- The Oral English Guide PDF is uploaded to paid-resources as oral-english-guide.pdf
-- (2,241,431 bytes, 224 pages), so the reader is pointed at it and the guide goes on
-- sale at ₦1,000. Buying it unlocks the ebook in the Library and /oral-english.
UPDATE public.products
SET is_active = true,
    metadata = metadata || jsonb_build_object('file_path', 'oral-english-guide.pdf', 'pages', 224),
    updated_at = now()
WHERE id = 'oral-english-guide';

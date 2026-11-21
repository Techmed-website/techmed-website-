-- The Physics Calculation Workbook PDF is uploaded to paid-resources as
-- TECHMED_Physics_Calculation_Workbook_COMPLETE.pdf (27,236,209 bytes), so the
-- reader is pointed at that name and the Workbook goes on sale (₦3,000).
UPDATE public.products
SET is_active = true,
    metadata = metadata || jsonb_build_object('file_path', 'TECHMED_Physics_Calculation_Workbook_COMPLETE.pdf'),
    updated_at = now()
WHERE id = 'physics-calculation-workbook';

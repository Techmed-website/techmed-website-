-- Paid means access now.
-- Every plan record carries starts_at = 2026-11-30 (the cohort start date).
-- plan_status_for() and resource_access_for() refused access until that date,
-- so paid students saw "Get link from support" and no class links, quizzes or
-- plan notifications. starts_at stays on record but no longer gates access.
CREATE OR REPLACE FUNCTION public.plan_status_for(p_user_id uuid, p_email text)
 RETURNS TABLE(plan text, plan_level integer, coverage_ends_at timestamp with time zone, access_ends_at timestamp with time zone, in_grace boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT e.resource_id,
    CASE e.resource_id WHEN 'cohort-ultimate' THEN 3 WHEN 'cohort-mastery' THEN 2 ELSE 1 END,
    e.expires_at,
    public.entitlement_access_end(e.resource_id, e.expires_at),
    (e.expires_at IS NOT NULL AND e.expires_at <= now())
  FROM public.entitlements e
  WHERE e.resource_id IN ('cohort-core', 'cohort-mastery', 'cohort-ultimate')
    AND e.is_active AND e.revoked_at IS NULL
    AND (public.entitlement_access_end(e.resource_id, e.expires_at) IS NULL
         OR public.entitlement_access_end(e.resource_id, e.expires_at) > now())
    AND ((p_user_id IS NOT NULL AND e.user_id = p_user_id)
         OR (coalesce(p_email, '') <> '' AND lower(e.customer_email) = lower(p_email)))
  ORDER BY 2 DESC, (e.expires_at IS NULL) DESC, e.expires_at DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.resource_access_for(p_user_id uuid, p_email text, p_resource_id text)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT e.* FROM public.entitlements e
    WHERE e.is_active = true AND e.revoked_at IS NULL
      AND (public.entitlement_access_end(e.resource_id, e.expires_at) IS NULL
           OR public.entitlement_access_end(e.resource_id, e.expires_at) > now())
      AND ((p_user_id IS NOT NULL AND e.user_id = p_user_id)
           OR (coalesce(p_email, '') <> '' AND lower(e.customer_email) = lower(p_email)))
  )
  SELECT EXISTS (SELECT 1 FROM me WHERE public.canonical_product_id(me.resource_id) = public.canonical_product_id(p_resource_id))
  OR EXISTS (
    SELECT 1 FROM me JOIN public.products p ON public.canonical_product_id(p.id) = public.canonical_product_id(me.resource_id)
    WHERE p.product_type IN ('bundle', 'cohort_plan')
      AND public.canonical_product_id(p_resource_id) = ANY (SELECT public.canonical_product_id(x) FROM unnest(p.bundle_item_ids) AS x)
  );
$function$;

CREATE OR REPLACE FUNCTION public.sync_business_modules_from_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.business_modules (business_id, module_id, is_enabled, limits)
  SELECT NEW.business_id, pm.module_id, true, pm.limits
  FROM public.plan_modules pm
  WHERE pm.plan_id = NEW.plan_id
  ON CONFLICT (business_id, module_id) DO UPDATE
    SET is_enabled = true,
        limits = EXCLUDED.limits;

  UPDATE public.business_modules bm
  SET is_enabled = false
  WHERE bm.business_id = NEW.business_id
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_modules pm
      WHERE pm.plan_id = NEW.plan_id AND pm.module_id = bm.module_id
    );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_modules_business_module_unique'
  ) THEN
    ALTER TABLE public.business_modules
      ADD CONSTRAINT business_modules_business_module_unique UNIQUE (business_id, module_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS sync_modules_on_subscription_change ON public.subscriptions;
CREATE TRIGGER sync_modules_on_subscription_change
AFTER INSERT OR UPDATE OF plan_id ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.sync_business_modules_from_plan();
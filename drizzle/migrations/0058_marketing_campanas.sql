-- Marketing en equipo (fase 1b): campañas y fechas clave, objetivos, tareas, ideas del personal.
-- - Campañas (`campaign`) y fechas clave (`key_date`, p. ej. Black Friday) en una sola tabla: las
--   dos se pintan como franjas en el calendario. Las fechas clave se cargan por negocio desde la app.
-- - Objetivos con cifra meta; el avance se apunta a mano hasta que lleguen las métricas.
-- - Tareas con responsable y fecha; la persona responsable (o un administrador) las marca como
--   hechas con `set_marketing_task_done`.
-- - El personal puede apuntar ideas (publicaciones en estado `idea`) y cambiar o borrar las suyas
--   mientras sigan siendo idea. Programar, publicar y todo lo demás sigue siendo de administradores.
-- - Las referencias entre tablas llevan `business_id` en la clave ajena: una publicación, tarea u
--   objetivo no puede apuntar a una campaña de otro negocio.
-- Migración aditiva e idempotente, sin secretos.

-- 1. Campañas y fechas clave ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  kind text NOT NULL DEFAULT 'campaign' CHECK (kind IN ('campaign', 'key_date')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  color text CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  goal text CHECK (char_length(goal) <= 500),
  notes text CHECK (char_length(notes) <= 2000),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaigns_dates CHECK (ends_on >= starts_on),
  CONSTRAINT marketing_campaigns_id_business UNIQUE (id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_business_dates
  ON public.marketing_campaigns (business_id, starts_on, ends_on);
-- Cargar dos veces las fechas clave no las duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_campaigns_key_date
  ON public.marketing_campaigns (business_id, lower(name), starts_on) WHERE kind = 'key_date';

-- 2. Publicaciones: campaña, tipos nuevos e ideas del personal ----------------------------------
ALTER TABLE public.marketing_posts ADD COLUMN IF NOT EXISTS campaign_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_posts_id_business') THEN
    ALTER TABLE public.marketing_posts ADD CONSTRAINT marketing_posts_id_business UNIQUE (id, business_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_posts_campaign_fk') THEN
    ALTER TABLE public.marketing_posts ADD CONSTRAINT marketing_posts_campaign_fk
      FOREIGN KEY (campaign_id, business_id) REFERENCES public.marketing_campaigns (id, business_id)
      ON DELETE SET NULL (campaign_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_marketing_posts_campaign ON public.marketing_posts (campaign_id);

ALTER TABLE public.marketing_posts DROP CONSTRAINT IF EXISTS marketing_posts_content_type_check;
ALTER TABLE public.marketing_posts ADD CONSTRAINT marketing_posts_content_type_check
  CHECK (content_type IN ('story', 'post', 'reel', 'carousel', 'email'));

-- 3. Objetivos -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  metric text NOT NULL CHECK (metric IN ('sales', 'followers', 'reach', 'engagement', 'email_subscribers', 'other')),
  target numeric(14,2) NOT NULL CHECK (target > 0),
  current numeric(14,2) NOT NULL DEFAULT 0 CHECK (current >= 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  campaign_id uuid,
  notes text CHECK (char_length(notes) <= 1000),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_goals_dates CHECK (ends_on >= starts_on),
  CONSTRAINT marketing_goals_campaign_fk FOREIGN KEY (campaign_id, business_id)
    REFERENCES public.marketing_campaigns (id, business_id) ON DELETE SET NULL (campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_goals_business_dates
  ON public.marketing_goals (business_id, starts_on, ends_on);

-- 4. Tareas ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  notes text CHECK (char_length(notes) <= 2000),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_on date,
  done_at timestamptz,
  done_by uuid,
  campaign_id uuid,
  post_id uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_tasks_campaign_fk FOREIGN KEY (campaign_id, business_id)
    REFERENCES public.marketing_campaigns (id, business_id) ON DELETE SET NULL (campaign_id),
  CONSTRAINT marketing_tasks_post_fk FOREIGN KEY (post_id, business_id)
    REFERENCES public.marketing_posts (id, business_id) ON DELETE SET NULL (post_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_tasks_business_due ON public.marketing_tasks (business_id, done_at, due_on);
CREATE INDEX IF NOT EXISTS idx_marketing_tasks_assignee ON public.marketing_tasks (assignee_id) WHERE done_at IS NULL;

-- 5. Permisos, RLS, auditoría y updated_at de las tablas nuevas ------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_campaigns', 'marketing_goals', 'marketing_tasks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);

    EXECUTE format('DROP POLICY IF EXISTS "Members view %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Members view %1$s" ON public.%1$I FOR SELECT TO authenticated
      USING (public.is_member_of_business(business_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins insert %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Admins insert %1$s" ON public.%1$I FOR INSERT TO authenticated
      WITH CHECK (public.has_min_role(business_id, ''admin''))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins update %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Admins update %1$s" ON public.%1$I FOR UPDATE TO authenticated
      USING (public.has_min_role(business_id, ''admin''))
      WITH CHECK (public.has_min_role(business_id, ''admin''))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins delete %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Admins delete %1$s" ON public.%1$I FOR DELETE TO authenticated
      USING (public.has_min_role(business_id, ''admin''))', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
      FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes()', t);
  END LOOP;
END $$;

-- 6. Ideas del personal (se suman a las políticas de administrador de marketing_posts) -----------
DROP POLICY IF EXISTS "Members insert own ideas" ON public.marketing_posts;
CREATE POLICY "Members insert own ideas" ON public.marketing_posts FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of_business(business_id) AND status = 'idea' AND created_by = auth.uid());

DROP POLICY IF EXISTS "Members update own ideas" ON public.marketing_posts;
CREATE POLICY "Members update own ideas" ON public.marketing_posts FOR UPDATE TO authenticated
  USING (public.is_member_of_business(business_id) AND status = 'idea' AND created_by = auth.uid())
  WITH CHECK (public.is_member_of_business(business_id) AND status = 'idea' AND created_by = auth.uid());

DROP POLICY IF EXISTS "Members delete own ideas" ON public.marketing_posts;
CREATE POLICY "Members delete own ideas" ON public.marketing_posts FOR DELETE TO authenticated
  USING (public.is_member_of_business(business_id) AND status = 'idea' AND created_by = auth.uid());

-- 7. Marcar una tarea como hecha (responsable o administrador) ------------------------------------
CREATE OR REPLACE FUNCTION public.set_marketing_task_done(_task_id uuid, _done boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business uuid;
  _assignee uuid;
BEGIN
  SELECT business_id, assignee_id INTO _business, _assignee
  FROM marketing_tasks WHERE id = _task_id;

  IF _business IS NULL OR NOT public.is_member_of_business(_business) THEN
    RAISE EXCEPTION 'Tarea no encontrada' USING ERRCODE = '42501';
  END IF;
  IF _assignee IS DISTINCT FROM auth.uid() AND NOT public.has_min_role(_business, 'admin') THEN
    RAISE EXCEPTION 'Solo la persona responsable o un administrador puede marcar esta tarea'
      USING ERRCODE = '42501';
  END IF;

  UPDATE marketing_tasks
  SET done_at = CASE WHEN _done THEN now() END,
      done_by = CASE WHEN _done THEN auth.uid() END
  WHERE id = _task_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_marketing_task_done(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_marketing_task_done(uuid, boolean) TO authenticated;

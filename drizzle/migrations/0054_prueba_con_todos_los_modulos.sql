-- Prueba de 14 días con todos los módulos que vende la web.
-- La web ofrece 14 días de prueba del plan Comercio (TPV, inventario, Shopify,
-- RR. HH. y marketing), pero el plan 'trial' solo traía clientes, productos,
-- facturas y cobros. Se añaden 'retail', 'hr' y 'marketing'.
-- Fuera: 'ai_advisor' (sin producto todavía) y 'reports' (solo plan business).
-- Aditiva e idempotente.

-- 1. Módulos del plan de prueba ----------------------------------------------
INSERT INTO public.plan_modules (plan_id, module_id, limits)
SELECT p.id, m.id, '{}'::jsonb
FROM public.plans p
CROSS JOIN public.modules m
WHERE p.key = 'trial'
  AND m.key IN ('retail', 'hr', 'marketing')
ON CONFLICT (plan_id, module_id) DO NOTHING;

-- 2. Negocios que ya están en prueba ------------------------------------------
-- El trigger sync_modules_on_subscription_change solo actúa al crear la
-- suscripción o al cambiar de plan, así que se rellenan aquí. DO NOTHING: no se
-- reactiva un módulo que el super admin haya apagado a mano en un negocio.
INSERT INTO public.business_modules (business_id, module_id, is_enabled, limits)
SELECT s.business_id, pm.module_id, true, pm.limits
FROM public.subscriptions s
JOIN public.plans p ON p.id = s.plan_id AND p.key = 'trial'
JOIN public.plan_modules pm ON pm.plan_id = p.id
WHERE s.status = 'trialing'
ON CONFLICT (business_id, module_id) DO NOTHING;

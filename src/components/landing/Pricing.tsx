import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";

// Duración de la prueba: coincide con el valor por defecto de subscriptions.trial_ends_at.
const TRIAL_DAYS = 14;

const plans = [
  {
    name: "Esencial",
    description: "Para autónomos y empresas de servicios",
    price: "19",
    features: [
      "Clientes y catálogo de productos",
      "Facturas con series y numeración correlativa",
      "Registro de cobros y control de impagos",
      "Equipo con roles de propietario, administrador y personal",
    ],
    variant: "outline" as const,
    popular: false,
  },
  {
    name: "Comercio",
    description: "Para tiendas con venta física y online",
    price: "39",
    features: [
      "Todo lo del plan Esencial",
      "TPV con caja, tickets y devoluciones",
      "Inventario con tallas, colores y variantes",
      "Sincronización de pedidos y existencias con Shopify",
      "Fichajes, ausencias y horarios del equipo",
      "Calendario de marketing",
    ],
    variant: "hero" as const,
    popular: true,
  },
];

export const Pricing = () => {
  return (
    <section className="py-24 bg-muted" id="pricing">
      <div className="container px-4">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-4">
            Planes simples, sin sorpresas
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Empieza con {TRIAL_DAYS} días de prueba gratis, sin tarjeta. Después eliges el plan
            que encaja con tu negocio.
          </p>
        </motion.div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className={`relative flex flex-col p-8 rounded-2xl bg-card border ${
                plan.popular
                  ? "border-primary shadow-lg shadow-primary/10"
                  : "border-border"
              } transition-all duration-300 hover:shadow-lg`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-primary text-primary-foreground text-sm font-semibold">
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  Más completo
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-1">
                  {plan.name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {plan.description}
                </p>
              </div>

              <div className="mb-6">
                <span className="text-4xl font-display font-bold text-foreground">
                  {plan.price} €
                </span>
                <span className="text-muted-foreground ml-1">/mes</span>
                <p className="text-xs text-muted-foreground mt-1">IVA no incluido</p>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-success/10 flex items-center justify-center">
                      <Check className="w-3 h-3 text-success" aria-hidden="true" />
                    </div>
                    <span className="text-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button asChild variant={plan.variant} size="lg" className="w-full">
                <Link to="/auth?tab=register">Probar {TRIAL_DAYS} días gratis</Link>
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

import { motion } from "framer-motion";
import { 
  Users, 
  Package, 
  FileText, 
  CreditCard, 
  BarChart3, 
  MessageSquare,
  Zap,
  Shield,
  Globe
} from "lucide-react";

const features = [
  {
    icon: Users,
    title: "Gestión de Clientes",
    description: "Mantén toda la información de tus clientes organizada. Historial, contactos y notas en un solo lugar.",
    color: "bg-primary/10 text-primary",
  },
  {
    icon: Package,
    title: "Productos y Servicios",
    description: "Catálogo completo de lo que ofreces. Precios, descripciones y disponibilidad actualizados.",
    color: "bg-accent/10 text-accent",
  },
  {
    icon: FileText,
    title: "Facturación Simple",
    description: "Crea facturas con sus líneas e impuestos y consulta su estado junto a los cobros registrados.",
    color: "bg-success/10 text-success",
  },
  {
    icon: CreditCard,
    title: "Control de Pagos",
    description: "Registra pagos, detecta impagos y mantén tu flujo de caja bajo control en tiempo real.",
    color: "bg-warning/10 text-warning",
  },
  {
    icon: BarChart3,
    title: "TPV y Shopify",
    description: "Registra ventas y devoluciones en tienda, imprime tickets y sincroniza pedidos y existencias con Shopify.",
    color: "bg-primary/10 text-primary",
  },
  {
    icon: MessageSquare,
    title: "Gestión de Equipos",
    description: "Consulta fichajes, horarios y ausencias de tu equipo desde el módulo de recursos humanos.",
    color: "bg-accent/10 text-accent",
  },
];

const benefits = [
  {
    icon: Zap,
    title: "Activa solo lo que necesitas",
    description: "Módulos independientes que puedes activar o desactivar según tu plan.",
  },
  {
    icon: Shield,
    title: "Datos seguros y privados",
    description: "Acceso por negocio con roles de propietario, administrador y personal para organizar los permisos.",
  },
  {
    icon: Globe,
    title: "Acceso desde cualquier lugar",
    description: "Web y móvil. Tu negocio siempre disponible cuando lo necesites.",
  },
];

export const Features = () => {
  return (
    <section className="py-24 bg-background" id="features">
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
            Herramientas para la operación diaria
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Clientes y facturación para pequeñas empresas; TPV, tickets y existencias
            para comercios; fichajes y ausencias para equipos. Activa los módulos disponibles en tu plan.
          </p>
        </motion.div>

        {/* Features grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="group p-6 rounded-2xl bg-card border border-border hover:shadow-lg hover:border-primary/20 transition-all duration-300"
            >
              <div className={`inline-flex p-3 rounded-xl ${feature.color} mb-4`}>
                <feature.icon className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold text-card-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Benefits section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="bg-gradient-card rounded-3xl p-8 sm:p-12 border border-border"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {benefits.map((benefit, index) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.2 + index * 0.1 }}
                className="text-center"
              >
                <div className="inline-flex p-4 rounded-2xl bg-primary/10 mb-4">
                  <benefit.icon className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {benefit.title}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {benefit.description}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
};

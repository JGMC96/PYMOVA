import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight } from "lucide-react";

const TITLE = "Mejores ERP para pymes en España (2026): guía comparativa";
const DESCRIPTION =
  "Comparativa de los mejores ERP para pymes en España: precios, funciones, TPV, facturación y RRHH. Descubre cuál encaja con tu negocio.";
const CANONICAL = "https://cogent-business-os.lovable.app/blog/mejores-erp-pymes";

const solutions = [
  {
    name: "Pymova",
    best: "Pymes que quieren ERP + TPV físico en una sola herramienta",
    highlights: [
      "Facturación, clientes, pagos e informes en tiempo real",
      "TPV para tienda física con variantes, códigos de barras y arqueo de caja",
      "Módulo de RRHH: fichaje, vacaciones y permisos",
      "Calendario de marketing e integraciones (Shopify y más)",
    ],
  },
  {
    name: "Holded",
    best: "Gestión contable y financiera avanzada",
    highlights: [
      "Contabilidad y conciliación bancaria completas",
      "Amplio ecosistema de módulos",
      "Curva de aprendizaje media",
    ],
  },
  {
    name: "Odoo",
    best: "Empresas con necesidades muy específicas y equipo técnico",
    highlights: [
      "Modular y personalizable al máximo",
      "Comunidad enorme y código abierto",
      "Requiere implantación y mantenimiento",
    ],
  },
  {
    name: "Sage 50",
    best: "Negocios con gestoría tradicional",
    highlights: [
      "Estándar consolidado en contabilidad española",
      "Buen soporte de asesorías",
      "Interfaz menos moderna y más lenta de adoptar",
    ],
  },
];

const criteria = [
  {
    title: "1. Facturación conforme a la normativa",
    body: "Verifica numeración correlativa, series, IVA configurable y trazabilidad de cambios. Es la base para cumplir con la factura electrónica y evitar sustos en una inspección.",
  },
  {
    title: "2. Multi-negocio y control de accesos",
    body: "Si gestionas varias marcas o tiendas, necesitas aislar los datos por negocio y asignar roles (propietario, administrador, empleado) sin que nadie vea de más.",
  },
  {
    title: "3. Punto de venta para tienda física",
    body: "Zapaterías, bares, floristerías o panaderías necesitan variantes (tallas, colores), lectura de códigos de barras, propinas, cambio en efectivo y arqueo de caja diario.",
  },
  {
    title: "4. Inventario en tiempo real",
    body: "El stock debe descontarse automáticamente con cada venta y sincronizarse con tu tienda online si vendes también por internet.",
  },
  {
    title: "5. Personas y horarios",
    body: "El fichaje horario es obligatorio en España. Un ERP que integre fichaje, vacaciones y permisos te ahorra una herramienta extra y mucho Excel.",
  },
  {
    title: "6. Precio real y curva de adopción",
    body: "Suma licencias, módulos, implantación y formación. Un ERP barato que nadie usa sale carísimo: prioriza el que tu equipo entienda en una tarde.",
  },
];

const faqs = [
  {
    q: "¿Qué es un ERP para pymes?",
    a: "Es un software de gestión que centraliza clientes, productos, facturación, cobros, inventario y equipo en una única base de datos, evitando hojas de cálculo dispersas.",
  },
  {
    q: "¿Cuánto cuesta un ERP para una pyme en España?",
    a: "Las soluciones cloud para pymes suelen moverse entre 20 y 100 € al mes por negocio, según módulos y número de usuarios. Los ERP tradicionales añaden costes de implantación.",
  },
  {
    q: "¿Necesito un ERP si solo tengo una tienda física?",
    a: "Sí. Un ERP con TPV integrado te permite vender, controlar stock, cuadrar caja y emitir facturas sin duplicar trabajo entre programas distintos.",
  },
  {
    q: "¿Cuánto tarda la implantación?",
    a: "Un ERP cloud modular como Pymova se pone en marcha el mismo día; los ERP a medida pueden requerir semanas o meses de consultoría.",
  },
];

function useHead() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = TITLE;

    const setMeta = (attr: "name" | "property", key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("name", "description", DESCRIPTION);
    setMeta("property", "og:title", TITLE);
    setMeta("property", "og:description", DESCRIPTION);
    setMeta("property", "og:url", CANONICAL);
    setMeta("property", "og:type", "article");

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevCanonical = canonical?.href;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = CANONICAL;

    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.text = JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: TITLE,
        description: DESCRIPTION,
        mainEntityOfPage: CANONICAL,
        inLanguage: "es-ES",
        publisher: { "@type": "Organization", name: "Pymova" },
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ]);
    document.head.appendChild(ld);

    return () => {
      document.title = prevTitle;
      if (prevCanonical && canonical) canonical.href = prevCanonical;
      ld.remove();
    };
  }, []);
}

const MejoresErpPymes = () => {
  useHead();

  return (
    <div className="min-h-screen bg-[#020617]">
      <Header />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-32">
        <article className="text-slate-300">
          <p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">Guía</p>
          <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl">
            Mejores ERP para pymes en España
          </h1>
          <p className="mb-10 text-lg text-muted-foreground">
            Elegir un ERP no va de tener más funciones, sino de que tu equipo lo use cada día. Esta
            guía compara las opciones más habituales para pequeñas y medianas empresas en España y
            te da los criterios para decidir sin perder semanas en demos.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            Comparativa rápida de soluciones
          </h2>
          <div className="space-y-4">
            {solutions.map((s) => (
              <section
                key={s.name}
                className="rounded-xl border border-border/60 bg-card/40 p-6 backdrop-blur"
              >
                <h3 className="text-xl font-semibold text-foreground">{s.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">Ideal para: {s.best}</p>
                <ul className="mt-4 space-y-2">
                  {s.highlights.map((h) => (
                    <li key={h} className="flex gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            6 criterios para elegir el ERP de tu pyme
          </h2>
          <div className="space-y-6">
            {criteria.map((c) => (
              <section key={c.title}>
                <h3 className="text-lg font-semibold text-foreground">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed">{c.body}</p>
              </section>
            ))}
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            ¿Dónde encaja Pymova?
          </h2>
          <p className="text-sm leading-relaxed">
            Pymova está pensado para el negocio pequeño que vende en tienda física y también factura
            a clientes: un único panel con clientes, productos con variantes, TPV con arqueo de caja,
            facturación, cobros, RRHH e integraciones como Shopify. Se activa por módulos, así que
            pagas y ves solo lo que usas.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth">
                Empezar gratis
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/">Ver funcionalidades</Link>
            </Button>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">Preguntas frecuentes</h2>
          <div className="space-y-6">
            {faqs.map((f) => (
              <section key={f.q}>
                <h3 className="text-lg font-semibold text-foreground">{f.q}</h3>
                <p className="mt-2 text-sm leading-relaxed">{f.a}</p>
              </section>
            ))}
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default MejoresErpPymes;

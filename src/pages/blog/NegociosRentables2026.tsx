import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight } from "lucide-react";

const TITLE = "Negocios rentables en 2026: 12 ideas para emprender en España";
const DESCRIPTION =
  "Ideas de negocios rentables y de baja inversión para emprender en España en 2026: inversión inicial, márgenes y cómo gestionarlos desde el primer día.";
const CANONICAL = "https://pymova.com/blog/negocios-rentables-2026";

const ideas = [
  {
    name: "Tienda especializada de barrio",
    invest: "Inversión: 8.000 – 20.000 €",
    margin: "Margen: 35 – 55 %",
    body: "Zapaterías, florerías, panaderías o tiendas gourmet siguen funcionando cuando se apoyan en un TPV que controle stock y variantes desde el primer día.",
  },
  {
    name: "Servicios profesionales freelance",
    invest: "Inversión: menos de 1.000 €",
    margin: "Margen: 60 – 85 %",
    body: "Diseño, contabilidad, marketing o consultoría técnica. El coste principal es tu tiempo: lo crítico es facturar puntualmente y controlar cobros.",
  },
  {
    name: "Cafetería de especialidad",
    invest: "Inversión: 25.000 – 60.000 €",
    margin: "Margen: 60 – 70 % en bebida",
    body: "Alto margen por ticket, pero muy sensible al control de caja y mermas. Un arqueo diario bien hecho marca la diferencia entre ganar y perder dinero.",
  },
  {
    name: "Ecommerce de nicho",
    invest: "Inversión: 3.000 – 10.000 €",
    margin: "Margen: 25 – 45 %",
    body: "Vender pocos productos muy bien elegidos gana a un catálogo enorme. Sincroniza el inventario de la tienda online con el del almacén para evitar sobreventa.",
  },
  {
    name: "Servicios a domicilio",
    invest: "Inversión: 2.000 – 8.000 €",
    margin: "Margen: 45 – 65 %",
    body: "Peluquería, fisioterapia, limpieza o mantenimiento. Vive de la agenda y de la recurrencia: necesitas ficha de cliente e historial de servicios.",
  },
  {
    name: "Formación y cursos presenciales",
    invest: "Inversión: 1.500 – 6.000 €",
    margin: "Margen: 55 – 75 %",
    body: "Talleres prácticos con grupos pequeños. Cobrar por adelantado y emitir factura automática reduce impagos casi a cero.",
  },
  {
    name: "Reparación y servicio técnico",
    invest: "Inversión: 4.000 – 12.000 €",
    margin: "Margen: 40 – 60 %",
    body: "Móviles, bicicletas o electrodomésticos. La rentabilidad está en el recambio: sin control de piezas, el margen se evapora.",
  },
  {
    name: "Producto artesano con marca propia",
    invest: "Inversión: 3.000 – 15.000 €",
    margin: "Margen: 45 – 70 %",
    body: "Cosmética, cerámica, alimentación. Vender en tienda física y online a la vez exige un inventario único para los dos canales.",
  },
  {
    name: "Agencia de marketing local",
    invest: "Inversión: menos de 2.000 €",
    margin: "Margen: 55 – 80 %",
    body: "Gestionar redes y campañas de comercios de tu ciudad. Un calendario de contenidos compartido con el cliente es tu mejor argumento de renovación.",
  },
  {
    name: "Alquiler de material y equipos",
    invest: "Inversión: 10.000 – 30.000 €",
    margin: "Margen: 50 – 70 %",
    body: "Material de obra, audiovisual o deportivo. Ingresos recurrentes sobre un activo que amortizas una sola vez.",
  },
  {
    name: "Catering y comida preparada",
    invest: "Inversión: 8.000 – 25.000 €",
    margin: "Margen: 30 – 50 %",
    body: "Menos coste de local que un restaurante. Necesitas escandallos y control de compras muy estrictos.",
  },
  {
    name: "Suscripción de servicios B2B",
    invest: "Inversión: 1.000 – 5.000 €",
    margin: "Margen: 60 – 85 %",
    body: "Mantenimiento informático, gestión documental o soporte. La cuota mensual da previsibilidad de caja desde el mes tres.",
  },
];

const steps = [
  {
    title: "1. Valida la demanda antes de invertir",
    body: "Habla con 20 clientes potenciales reales y cobra a los primeros aunque sea poco. Si nadie paga en fase de prueba, el problema no es el marketing.",
  },
  {
    title: "2. Calcula el punto de equilibrio",
    body: "Divide tus costes fijos mensuales entre el margen por venta. Ese número de ventas al mes es tu objetivo mínimo real.",
  },
  {
    title: "3. Elige la forma jurídica y date de alta",
    body: "Autónomo para empezar con poca inversión; sociedad limitada si hay socios, riesgo patrimonial o facturación alta desde el inicio.",
  },
  {
    title: "4. Ordena la gestión desde el día uno",
    body: "Clientes, productos, facturas y cobros en un solo sitio. Arrancar con hojas de cálculo cuesta meses de trabajo cuando toca migrar.",
  },
  {
    title: "5. Mide cada semana",
    body: "Ventas, margen, cobros pendientes y caja. Un negocio rentable en el papel puede quebrar por tesorería.",
  },
];

const faqs = [
  {
    q: "¿Cuáles son los negocios más rentables en 2026?",
    a: "Los de servicios profesionales y suscripción B2B lideran en margen (60–85 %) porque casi no tienen coste de material. En producto físico, la especialización de nicho y la cafetería de especialidad mantienen los mejores márgenes.",
  },
  {
    q: "¿Qué negocio puedo montar con poco dinero?",
    a: "Servicios freelance, agencia de marketing local y formación se pueden arrancar con menos de 2.000 € porque el activo principal es tu conocimiento y no necesitas local ni stock.",
  },
  {
    q: "¿Cuánto tarda un negocio en ser rentable?",
    a: "En servicios, entre 3 y 6 meses. En negocios con local y stock, lo habitual es entre 12 y 24 meses hasta recuperar la inversión inicial.",
  },
  {
    q: "¿Qué necesito para gestionar mi negocio desde el principio?",
    a: "Como mínimo: ficha de clientes, catálogo de productos o servicios, facturación con numeración correlativa, registro de cobros y control de inventario si vendes producto. Pymova reúne todo eso en un único panel.",
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

const NegociosRentables2026 = () => {
  useHead();

  return (
    <div className="min-h-screen bg-[#020617]">
      <Header />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-32">
        <article className="text-slate-300">
          <p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">Guía</p>
          <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl">
            Negocios rentables para emprender en 2026
          </h1>
          <p className="mb-10 text-lg text-muted-foreground">
            No hay negocios rentables por sí solos: hay modelos con buen margen y gestión ordenada.
            Esta guía recoge 12 ideas realistas para emprender en España, con inversión aproximada,
            margen esperado y lo que necesitas controlar para que el negocio no se te escape de las
            manos en el primer año.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            12 ideas de negocio rentables
          </h2>
          <div className="space-y-4">
            {ideas.map((idea) => (
              <section
                key={idea.name}
                className="rounded-xl border border-border/60 bg-card/40 p-6 backdrop-blur"
              >
                <h3 className="text-xl font-semibold text-foreground">{idea.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {idea.invest} · {idea.margin}
                </p>
                <p className="mt-3 text-sm leading-relaxed">{idea.body}</p>
              </section>
            ))}
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            Cómo empezar un negocio sin fallar en lo básico
          </h2>
          <div className="space-y-6">
            {steps.map((s) => (
              <section key={s.title}>
                <h3 className="text-lg font-semibold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed">{s.body}</p>
              </section>
            ))}
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            La herramienta con la que arrancar
          </h2>
          <p className="text-sm leading-relaxed">
            Casi todas estas ideas comparten las mismas necesidades: registrar clientes, emitir
            facturas correctas, cobrar a tiempo y saber qué queda en stock. Pymova reúne clientes,
            productos con variantes, TPV para tienda física con arqueo de caja, facturación, cobros
            y RRHH en un único panel, activando solo los módulos que uses.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth?tab=register">
                Empezar gratis
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/blog/mejores-erp-pymes">Comparativa de ERP para pymes</Link>
            </Button>
          </div>

          <ul className="mt-8 space-y-2">
            {[
              "Facturación con numeración correlativa y series",
              "TPV con códigos de barras, variantes y arqueo diario",
              "Control de cobros e informes en tiempo real",
            ].map((item) => (
              <li key={item} className="flex gap-2 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

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

export default NegociosRentables2026;

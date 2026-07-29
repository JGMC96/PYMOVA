import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Check, ArrowRight } from "lucide-react";

const TITLE = "VeriFactu 2026: guía de cumplimiento para pymes y autónomos";
const DESCRIPTION =
  "Qué es VeriFactu, plazos de entrada en vigor, requisitos técnicos del software de facturación y cómo adaptar tu pyme o negocio autónomo sin sustos.";
const CANONICAL = "https://pymova.com/blog/guia-verifactu-2026";

const requirements = [
  {
    title: "Registro de facturación por cada factura",
    body: "El software debe generar un registro de alta (y de anulación cuando toque) en el mismo momento de emitir la factura, sin posibilidad de borrarlo después.",
  },
  {
    title: "Encadenamiento con huella (hash)",
    body: "Cada registro incorpora la huella del anterior, formando una cadena. Si se altera una factura pasada, la cadena se rompe y queda evidencia.",
  },
  {
    title: "Firma electrónica o remisión a la AEAT",
    body: "En modo VeriFactu los registros se envían automáticamente a la Agencia Tributaria; en modo no verificable hay que firmarlos electrónicamente y conservarlos.",
  },
  {
    title: "Código QR en la factura",
    body: "Toda factura debe incluir un QR que permita al receptor cotejar sus datos, además de la mención «VERI*FACTU» cuando se use ese modo.",
  },
  {
    title: "Inalterabilidad, trazabilidad y conservación",
    body: "Nada de series duplicadas ni de reescribir importes: numeración correlativa, registro de eventos y conservación accesible durante el plazo legal.",
  },
  {
    title: "Declaración responsable del fabricante",
    body: "El software debe declarar expresamente que cumple el Reglamento. Exígesela a tu proveedor por escrito antes de contratar.",
  },
];

const deadlines = [
  {
    when: "Julio de 2025",
    body: "Fin del plazo para que los fabricantes de software de facturación adapten y certifiquen sus productos al Reglamento.",
  },
  {
    when: "1 de enero de 2026",
    body: "Obligación para contribuyentes del Impuesto sobre Sociedades.",
  },
  {
    when: "1 de julio de 2026",
    body: "Obligación para el resto de obligados: autónomos y demás contribuyentes que emitan factura.",
  },
];

const steps = [
  {
    title: "1. Comprueba si te aplica",
    body: "Afecta a empresas y autónomos que emiten facturas en territorio común. Quedan fuera quienes ya están en SII, ciertos regímenes forales y operaciones exentas por normativa específica.",
  },
  {
    title: "2. Pide la declaración responsable a tu proveedor",
    body: "Si facturas con Excel, Word o plantillas propias, ese sistema deja de ser válido. Necesitas software que emita registros de facturación conformes.",
  },
  {
    title: "3. Elige modo VeriFactu o no verificable",
    body: "VeriFactu (envío automático a la AEAT) es más simple: no exige firma electrónica ni conservar los registros por tu cuenta. Para la mayoría de pymes es la opción recomendable.",
  },
  {
    title: "4. Ordena tus series y numeración",
    body: "Antes de migrar, cierra series antiguas y define una numeración correlativa limpia. Arrastrar huecos o duplicados complica el alta de registros.",
  },
  {
    title: "5. Prueba antes de la fecha límite",
    body: "Emite facturas reales con el nuevo flujo unos meses antes. Descubrir un problema de datos fiscales de clientes en enero es caro; en octubre, no.",
  },
];

const faqs = [
  {
    q: "¿Qué es VeriFactu?",
    a: "Es el sistema de facturación verificable regulado por la Ley Antifraude y su Reglamento: obliga a que el software de facturación genere un registro inalterable y encadenado por cada factura, con QR, y permite remitirlo automáticamente a la Agencia Tributaria.",
  },
  {
    q: "¿Desde cuándo es obligatorio VeriFactu?",
    a: "Para contribuyentes del Impuesto sobre Sociedades, desde el 1 de enero de 2026. Para autónomos y el resto de obligados, desde el 1 de julio de 2026. Los fabricantes de software debían tener sus productos adaptados desde julio de 2025.",
  },
  {
    q: "¿Puedo seguir facturando con Excel o con plantillas de Word?",
    a: "No. Una hoja de cálculo no genera registros de facturación inalterables ni encadenados, ni puede emitir la declaración responsable exigida al software. Necesitas un programa de facturación adaptado.",
  },
  {
    q: "¿Qué diferencia hay entre VeriFactu y el SII?",
    a: "El SII es el suministro inmediato de los libros registro de IVA y afecta sobre todo a grandes empresas y grupos; VeriFactu actúa en el momento de emitir cada factura y afecta a la práctica totalidad de pymes y autónomos. Quien ya está en SII queda fuera de VeriFactu.",
  },
  {
    q: "¿Qué sanciones hay por no cumplir?",
    a: "Usar o comercializar software que no cumpla los requisitos está tipificado con multas que pueden alcanzar los 50.000 € por ejercicio para el usuario y 150.000 € por ejercicio y programa para el fabricante.",
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

const GuiaVerifactu2026 = () => {
  useHead();

  return (
    <div className="min-h-screen bg-[#020617]">
      <Header />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-32">
        <article className="text-slate-300">
          <p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">
            Cumplimiento
          </p>
          <h1 className="mb-6 text-4xl font-bold leading-tight text-foreground md:text-5xl">
            VeriFactu 2026: guía de cumplimiento para pymes y autónomos
          </h1>
          <p className="mb-10 text-lg text-muted-foreground">
            VeriFactu obliga a que tu software de facturación genere un registro inalterable por
            cada factura emitida. Aquí tienes, sin jerga, qué exige la norma, cuándo te aplica y qué
            tienes que hacer para llegar a la fecha límite sin rehacer tu forma de facturar a
            última hora.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            Qué es VeriFactu y a quién afecta
          </h2>
          <p className="text-sm leading-relaxed">
            VeriFactu es el sistema de facturación verificable que desarrolla la Ley Antifraude
            (Ley 11/2021) a través del Reglamento aprobado por el Real Decreto 1007/2023. Su
            objetivo es impedir el software de doble uso: programas que permitían borrar o
            modificar ventas ya emitidas. Afecta a empresas y autónomos que emitan factura en
            territorio común, salvo quienes ya están acogidos al SII, los territorios forales con
            su propia normativa (TicketBAI) y determinados supuestos exentos.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            Plazos de entrada en vigor
          </h2>
          <div className="space-y-4">
            {deadlines.map((d) => (
              <section
                key={d.when}
                className="rounded-xl border border-border/60 bg-card/40 p-6 backdrop-blur"
              >
                <h3 className="text-lg font-semibold text-foreground">{d.when}</h3>
                <p className="mt-2 text-sm leading-relaxed">{d.body}</p>
              </section>
            ))}
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            Requisitos técnicos que debe cumplir tu software de facturación
          </h2>
          <div className="space-y-6">
            {requirements.map((r) => (
              <section key={r.title}>
                <h3 className="text-lg font-semibold text-foreground">{r.title}</h3>
                <p className="mt-2 text-sm leading-relaxed">{r.body}</p>
              </section>
            ))}
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-semibold text-foreground">
            Cómo adaptar tu negocio paso a paso
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
            Prepara tu facturación con Pymova
          </h2>
          <p className="text-sm leading-relaxed">
            Pymova ya factura con numeración correlativa por series, registro de cambios y datos
            fiscales completos del emisor (razón social, CIF y nombre comercial), que es la base
            sobre la que se apoya cualquier adaptación a VeriFactu. Si hoy facturas en hojas de
            cálculo, ordenar clientes, productos y series ahora es el trabajo que evita el atasco
            de 2026.
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
              "Series y numeración correlativa sin huecos",
              "Datos fiscales completos y trazabilidad de cada factura",
              "Cobros, inventario y TPV en el mismo panel",
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

          <p className="mt-10 text-xs text-muted-foreground">
            Esta guía es informativa y no sustituye al asesoramiento fiscal profesional ni al texto
            oficial publicado por la Agencia Tributaria.
          </p>
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default GuiaVerifactu2026;

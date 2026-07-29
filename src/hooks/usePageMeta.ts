import { useEffect } from "react";

const SITE_URL = "https://pymova.com";

interface PageMeta {
  title: string;
  description: string;
  /** Ruta canónica de la página, p. ej. "/auth" */
  path: string;
}

/**
 * Aplica título, descripción, canonical y etiquetas Open Graph únicas por ruta.
 * Restaura los valores previos al desmontar para no contaminar otras vistas.
 */
export function usePageMeta({ title, description, path }: PageMeta) {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;
    const prevTitle = document.title;
    document.title = title;

    const touched: Array<{ el: HTMLMetaElement; prev: string | null; created: boolean }> = [];

    const setMeta = (attr: "name" | "property", key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      let created = false;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
        created = true;
      }
      touched.push({ el, prev: el.getAttribute("content"), created });
      el.setAttribute("content", content);
    };

    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", url);
    setMeta("property", "og:type", "website");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    let canonicalCreated = false;
    const prevCanonical = canonical?.getAttribute("href") ?? null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
      canonicalCreated = true;
    }
    canonical.setAttribute("href", url);

    return () => {
      document.title = prevTitle;
      touched.forEach(({ el, prev, created }) => {
        if (created) el.remove();
        else if (prev !== null) el.setAttribute("content", prev);
      });
      if (canonicalCreated) canonical?.remove();
      else if (prevCanonical && canonical) canonical.setAttribute("href", prevCanonical);
    };
  }, [title, description, path]);
}

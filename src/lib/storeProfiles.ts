// Presets por tipo de tienda física.
// Se usan para sugerir categorías, unidades y atributos de variante en el POS.

export type StoreProfile =
  | 'general'
  | 'shoe_store'
  | 'bar'
  | 'florist'
  | 'bakery'
  | 'fashion';

export interface StoreProfilePreset {
  key: StoreProfile;
  label: string;
  emoji: string;
  description: string;
  /** Categorías sugeridas para el catálogo */
  categories: string[];
  /** Unidades de venta habituales */
  units: string[];
  /** Atributos de variante típicos (talla, color, tamaño...) */
  variantAttributes: { key: string; label: string; suggestions: string[] }[];
  /** Métodos de pago destacados en el POS */
  paymentMethods: string[];
  /** Mostrar campo de propina en el cobro */
  tipEnabled: boolean;
}

export const STORE_PROFILES: Record<StoreProfile, StoreProfilePreset> = {
  general: {
    key: 'general',
    label: 'Tienda general',
    emoji: '🏪',
    description: 'Configuración estándar para cualquier comercio.',
    categories: ['General', 'Ofertas', 'Servicios'],
    units: ['ud', 'kg', 'h'],
    variantAttributes: [
      { key: 'variante', label: 'Variante', suggestions: [] },
    ],
    paymentMethods: ['cash', 'card', 'transfer'],
    tipEnabled: false,
  },
  shoe_store: {
    key: 'shoe_store',
    label: 'Zapatería',
    emoji: '👟',
    description: 'Calzado con tallas y colores por referencia.',
    categories: ['Hombre', 'Mujer', 'Infantil', 'Deportivo', 'Complementos'],
    units: ['par', 'ud'],
    variantAttributes: [
      {
        key: 'talla',
        label: 'Talla',
        suggestions: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
      },
      {
        key: 'color',
        label: 'Color',
        suggestions: ['Negro', 'Blanco', 'Marrón', 'Azul', 'Beige'],
      },
    ],
    paymentMethods: ['cash', 'card', 'transfer'],
    tipEnabled: false,
  },
  bar: {
    key: 'bar',
    label: 'Bar / Cafetería',
    emoji: '🍺',
    description: 'Consumiciones rápidas, raciones y propinas.',
    categories: ['Cafés', 'Refrescos', 'Cervezas', 'Vinos', 'Tapas', 'Bocadillos', 'Postres'],
    units: ['ud', 'caña', 'copa', 'ración'],
    variantAttributes: [
      { key: 'tamano', label: 'Tamaño', suggestions: ['Pequeño', 'Mediano', 'Grande'] },
    ],
    paymentMethods: ['cash', 'card'],
    tipEnabled: true,
  },
  florist: {
    key: 'florist',
    label: 'Floristería',
    emoji: '💐',
    description: 'Ramos y plantas con tamaños y composiciones.',
    categories: ['Ramos', 'Plantas', 'Centros', 'Coronas', 'Complementos'],
    units: ['ud', 'ramo', 'tallo'],
    variantAttributes: [
      { key: 'tamano', label: 'Tamaño', suggestions: ['Pequeño', 'Mediano', 'Grande', 'Premium'] },
      { key: 'color', label: 'Color', suggestions: ['Rojo', 'Blanco', 'Rosa', 'Amarillo', 'Mixto'] },
    ],
    paymentMethods: ['cash', 'card', 'transfer'],
    tipEnabled: false,
  },
  bakery: {
    key: 'bakery',
    label: 'Panadería / Pastelería',
    emoji: '🥐',
    description: 'Venta por unidad y por peso.',
    categories: ['Panes', 'Bollería', 'Pasteles', 'Bebidas', 'Encargos'],
    units: ['ud', 'kg', 'docena'],
    variantAttributes: [
      { key: 'tamano', label: 'Tamaño', suggestions: ['Individual', '4 raciones', '8 raciones'] },
    ],
    paymentMethods: ['cash', 'card'],
    tipEnabled: false,
  },
  fashion: {
    key: 'fashion',
    label: 'Moda / Textil',
    emoji: '👗',
    description: 'Prendas con tallas y colores.',
    categories: ['Camisetas', 'Pantalones', 'Vestidos', 'Abrigos', 'Accesorios'],
    units: ['ud'],
    variantAttributes: [
      { key: 'talla', label: 'Talla', suggestions: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
      { key: 'color', label: 'Color', suggestions: ['Negro', 'Blanco', 'Azul', 'Verde', 'Rojo'] },
    ],
    paymentMethods: ['cash', 'card', 'transfer'],
    tipEnabled: false,
  },
};

export const STORE_PROFILE_LIST = Object.values(STORE_PROFILES);

export function getStoreProfile(key?: string | null): StoreProfilePreset {
  return STORE_PROFILES[(key as StoreProfile) ?? 'general'] ?? STORE_PROFILES.general;
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  other: 'Otro',
};

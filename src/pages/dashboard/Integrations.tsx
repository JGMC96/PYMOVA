import { Routes, Route } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Plug, ShoppingBag, Globe, Store, Table2, CreditCard, Sparkles, Loader2, Check, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useIntegrationInterests } from '@/hooks/useIntegrationInterests';
import ShopifyIntegration from './integrations/ShopifyIntegration';
import type { LucideIcon } from 'lucide-react';


interface Integration {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'E-commerce' | 'CMS' | 'Datos' | 'Pagos';
  href?: string;
  available?: boolean;
}

const INTEGRATIONS: Integration[] = [
  {
    key: 'shopify',
    name: 'Shopify',
    description: 'Importa productos, variantes y stock desde tu tienda Shopify.',
    icon: ShoppingBag,
    category: 'E-commerce',
    href: '/dashboard/integrations/shopify',
    available: true,
  },
  {
    key: 'woocommerce',
    name: 'WooCommerce',
    description: 'Sincroniza el catálogo y los pedidos de tu tienda WooCommerce.',
    icon: Store,
    category: 'E-commerce',
  },
  {
    key: 'wordpress',
    name: 'WordPress',
    description: 'Conecta tu web para importar contenidos y fichas de producto.',
    icon: Globe,
    category: 'CMS',
  },
  {
    key: 'prestashop',
    name: 'PrestaShop',
    description: 'Importa catálogo, categorías y existencias desde PrestaShop.',
    icon: Store,
    category: 'E-commerce',
  },
  {
    key: 'csv',
    name: 'CSV / Excel',
    description: 'Sube un fichero para dar de alta productos y clientes en bloque.',
    icon: Table2,
    category: 'Datos',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    description: 'Concilia cobros online con tus facturas y pagos de Pymova.',
    icon: CreditCard,
    category: 'Pagos',
  },
];

const IntegrationsIndex = () => {
  const { interests, isLoading, savingKey, toggleInterest } = useIntegrationInterests();

  const priorityOf = (key: string) => {
    const index = interests.findIndex((i) => i.integration_key === key);
    return index === -1 ? null : index + 1;
  };

  const requestedNames = interests
    .map((i) => INTEGRATIONS.find((x) => x.key === i.integration_key)?.name ?? i.integration_key);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-2">
          <Plug className="w-7 h-7 text-accent" />
          Integraciones
        </h1>
        <p className="text-muted-foreground mt-1">
          Conecta Pymova con tus plataformas para importar productos, stock y clientes.
        </p>
      </div>

      <Card className="border-accent/30 bg-accent/5">
        <CardContent className="flex items-start gap-3 py-4">
          <Sparkles className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">Shopify ya está disponible</p>
            <p className="text-sm text-muted-foreground">
              El resto de importaciones están en desarrollo. Marca las plataformas que usas
              para priorizarlas.
            </p>
            {isLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Cargando tus prioridades…
              </p>
            ) : requestedNames.length > 0 ? (
              <p className="text-sm text-foreground">
                Prioridades de tu negocio:{' '}
                <span className="font-medium">
                  {requestedNames.map((n, i) => `${i + 1}. ${n}`).join(' · ')}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aún no has marcado ninguna integración como prioritaria.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.map((integration) => {
          const priority = priorityOf(integration.key);
          const isRequested = priority !== null;
          const isSaving = savingKey === integration.key;
          return (
            <Card
              key={integration.key}
              className={`flex flex-col ${
                integration.available ? 'border-accent/60' : isRequested ? 'border-accent/50' : ''
              }`}
            >
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center">
                    <integration.icon className="w-5 h-5 text-foreground" />
                  </div>
                  <div className="flex items-center gap-2">
                    {!integration.available && isRequested && (
                      <Badge className="bg-accent text-accent-foreground hover:bg-accent">
                        Prioridad {priority}
                      </Badge>
                    )}
                    <Badge variant="outline">{integration.category}</Badge>
                  </div>
                </div>
                <div>
                  <CardTitle className="text-lg">{integration.name}</CardTitle>
                  <CardDescription className="mt-1">{integration.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="mt-auto flex items-center justify-between gap-3">
                {integration.available ? (
                  <>
                    <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                      Conectada
                    </Badge>
                    <Button size="sm" asChild>
                      <Link to={integration.href!}>
                        Gestionar
                        <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                      </Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge variant="secondary">Próximamente</Badge>
                    <Button
                      variant={isRequested ? 'secondary' : 'outline'}
                      size="sm"
                      disabled={isSaving || isLoading}
                      onClick={() => toggleInterest(integration.key, integration.name)}
                    >
                      {isSaving ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : isRequested ? (
                        <Check className="w-3.5 h-3.5 mr-1.5" />
                      ) : null}
                      {isRequested ? 'Solicitada' : 'Me interesa'}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

const Integrations = () => (
  <Routes>
    <Route index element={<IntegrationsIndex />} />
    <Route path="shopify" element={<ShopifyIntegration />} />
  </Routes>
);

export default Integrations;

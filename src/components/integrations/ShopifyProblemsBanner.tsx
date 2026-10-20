import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useShopifyProblems } from '@/hooks/useShopifyProblems';
import { problemsSummary } from '@/lib/shopifyProblems';

/** Franja en Retail para administradores cuando algo no ha llegado a Shopify. */
export function ShopifyProblemsBanner() {
  const { problems, enabled } = useShopifyProblems();
  const summary = enabled ? problemsSummary(problems) : null;
  if (!summary) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm">
      <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
      <span className="flex-1">{summary}.</span>
      <Button asChild variant="outline" size="sm">
        <Link to="/dashboard/integrations/shopify">Ver y reintentar</Link>
      </Button>
    </div>
  );
}

import { cn } from '@/lib/utils';
import { promoPct } from '@/lib/promoPrice';

/** «179.00 € → 143.20 € · −20 %», con el precio anterior tachado. Sin rebaja, solo el precio. */
export function PromoPrice({
  price, listPrice, className, showPct = true,
}: {
  price: number;
  listPrice: number | null;
  className?: string;
  showPct?: boolean;
}) {
  if (!listPrice) return <span className={className}>{price.toFixed(2)} €</span>;
  return (
    <span className={cn('inline-flex flex-wrap items-baseline justify-end gap-x-1', className)}>
      <span className="text-xs font-normal text-muted-foreground line-through">{listPrice.toFixed(2)} €</span>
      <span>{price.toFixed(2)} €</span>
      {showPct && (
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">−{promoPct(price, listPrice)} %</span>
      )}
    </span>
  );
}

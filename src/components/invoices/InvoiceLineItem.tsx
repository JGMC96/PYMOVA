import { Control, useWatch, useFormContext } from 'react-hook-form';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import type { Product } from '@/types/database';
import { useMoney } from '@/hooks/useMoney';

interface InvoiceFormValues {
  client_id: string;
  due_date?: string;
  notes?: string;
  items: Array<{
    product_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
  }>;
}

interface InvoiceLineItemProps {
  index: number;
  control: Control<InvoiceFormValues>;
  products: Product[];
  onRemove: () => void;
  canRemove: boolean;
}

interface InvoiceLineItemProps {
  index: number;
  control: Control<InvoiceFormValues>;
  products: Product[];
  onRemove: () => void;
  canRemove: boolean;
}

export function InvoiceLineItem({
  index,
  control,
  products,
  onRemove,
  canRemove,
}: InvoiceLineItemProps) {
  const { format: formatPrice } = useMoney();
  const { setValue } = useFormContext<InvoiceFormValues>();
  
  // Watch quantity and unit_price for this line
  const quantity = useWatch({
    control,
    name: `items.${index}.quantity`,
    defaultValue: 1,
  });
  
  const unitPrice = useWatch({
    control,
    name: `items.${index}.unit_price`,
    defaultValue: 0,
  });

  // Calculate line total
  const lineTotal = (Number(quantity) || 0) * (Number(unitPrice) || 0);

  // Handle product selection - autofill description and price
  const handleProductChange = (productId: string) => {
    if (productId === 'none') {
      setValue(`items.${index}.product_id`, undefined);
      return;
    }
    
    const product = products.find((p) => p.id === productId);
    if (product) {
      setValue(`items.${index}.product_id`, productId);
      setValue(`items.${index}.description`, product.name);
      setValue(`items.${index}.unit_price`, product.price);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-2 items-start">
      {/* Product selector */}
      <div className="col-span-3">
        <FormField
          control={control}
          name={`items.${index}.product_id`}
          render={({ field }) => (
            <FormItem>
              <Select
                value={field.value || 'none'}
                onValueChange={handleProductChange}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Producto (opcional)" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">Sin producto</SelectItem>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
      </div>

      {/* Description */}
      <div className="col-span-3">
        <FormField
          control={control}
          name={`items.${index}.description`}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input {...field} placeholder="Descripción *" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Quantity */}
      <div className="col-span-2">
        <FormField
          control={control}
          name={`items.${index}.quantity`}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Cant."
                  onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Unit Price */}
      <div className="col-span-2">
        <FormField
          control={control}
          name={`items.${index}.unit_price`}
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Precio"
                  onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Line Total (calculated, read-only) */}
      <div className="col-span-1 flex items-center justify-end h-10">
        <span className="text-sm font-medium text-muted-foreground">
          {formatPrice(lineTotal)}
        </span>
      </div>

      {/* Remove button */}
      <div className="col-span-1 flex items-center justify-center h-10">
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

# Stock: quién cambia la cifra de Shopify

Aplica a los negocios con Shopify y Stockagile conectados (hoy, TUILUS). Sin Stockagile, PYMOVA envía sus cambios directamente a Shopify por la cola `shopify_inventory_pushes`.

## La regla

**Stockagile es el dueño de la cifra de Shopify.** Cuando cambia su stock, copia la cifra entera a Shopify.

Lo que PYMOVA envía a Shopify es una diferencia (+1/−1) y tiene que llegar **antes** que esa copia. Si llega después, la diferencia se aplica sobre la cifra ya copiada y cuenta dos veces. Eso fue el doble descuento de las ventas del TPV, arreglado en la PR #90.

Desde la PR #90, este orden lo garantiza el servidor:
- `shopify-pos-order` no crea el pedido de una venta hasta que su envío de stock está hecho;
- `stockagile` no manda un movimiento hasta que el envío de esa misma línea está hecho.

Ese envío, compartido, está en `_shared/shopify-stock-push.ts`.

PYMOVA sigue a Shopify. Su cifra es la de la ubicación de la tienda más los envíos pendientes (`recompute_local_stock`), y le llega por los avisos `inventory_levels/update` y por el refresco de las 03:00.

## Cada camino

| Camino | Escribe en Shopify | Cómo le llega a Stockagile | Cómo le llega a PYMOVA |
|---|---|---|---|
| Venta en el TPV de PYMOVA | 1) PYMOVA −1 (cola de envíos); 2) Stockagile copia su cifra, unos 75 s después | Por el pedido de Shopify (`pymova-tpv`, `inventoryBehaviour: BYPASS`) | Resta al vender (`decrement_stock_on_sale`) |
| Devolución en el TPV con reposición | 1) PYMOVA +1; 2) Stockagile copia | Movimiento `stockagile_stock_moves`, después del envío a Shopify | Suma al devolver. El reembolso en Shopify es `NO_RESTOCK` |
| Compra recibida (0040) | Igual que una devolución | Igual que una devolución | Igual que una devolución |
| Ajuste de stock en PYMOVA, con PIN (0057) | Solo Stockagile, al copiar. PYMOVA no envía nada a Shopify | Movimiento `stockagile_stock_moves` | Ajusta al guardar |
| Venta web | Shopify, al entrar el pedido; después Stockagile copia | Por el pedido | Solo por los avisos: las líneas web no tienen la talla enlazada |
| Devolución o cambio web | Sin comprobar: depende de si se repone en Shopify o se da de alta en Stockagile | — | Solo por los avisos |
| Venta o ajuste en Stockagile | Solo Stockagile, al copiar | — | Por los avisos. La copia de los tickets (`stockagile_sales`) no mueve stock |
| Ajuste a mano en Shopify | Shopify. Stockagile no lo ve | No le llega | Por los avisos |
| Refresco de las 03:00 (`shopify-stock-nocturno`) | Nada: solo lee Shopify | — | Se pone al día con Shopify |

## Antes de tocar un camino que mueve stock

- Para cambiar el stock, nada de escribir en `stock_quantity` con `update`: los cambios van por RPC transaccional.
- Si el camino nuevo escribe en Shopify y en Stockagile, primero Shopify. Usa `flushStockPushes`.
- Para corregir a mano una cifra de Shopify que ya está bien en Stockagile, se ajusta solo en Shopify. El ajuste de PYMOVA iría también a Stockagile.
- La Tarjeta Regalo no lleva stock en Shopify. Que PYMOVA tampoco se lo controle está pendiente: plan aprobado, sin código.

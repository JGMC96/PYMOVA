# Integración profesional con Shopify (tokens propios)

Hoy la app depende del token temporal de sesión de Shopify (`SHOPIFY_ONLINE_ACCESS_TOKEN:*`), que caduca — de ahí el error "La sesión de Shopify ha caducado". La forma profesional y estable es usar una **app personalizada** en tu tienda, con dos tokens permanentes.

## Qué tienes que hacer tú en Shopify (5 minutos)

1. Shopify Admin → Configuración → **Aplicaciones y canales de venta** → *Desarrollar aplicaciones* → **Crear una aplicación** (nombre: `Pymova`).
2. Pestaña **Configuración → Admin API**: marca los permisos
   `read_products`, `write_products`, `read_inventory`, `write_inventory`,
   `read_orders`, `write_orders`, `read_all_orders`, `read_fulfillments`, `write_fulfillments`,
   `read_customers`, `read_returns`, `write_returns`.
3. Pestaña **Storefront API**: marca `unauthenticated_read_product_listings`,
   `unauthenticated_read_product_inventory`, `unauthenticated_read_product_tags`.
   (Esto resuelve el error `Access denied for quantityAvailable`.)
4. **Instalar aplicación** → copia:
   - *Admin API access token* (`shpat_…`) — solo se muestra una vez.
   - *Storefront API access token*.

Cuando los tengas, te abriré el formulario seguro para pegarlos (no se guardan en el código).

## Qué implemento yo

### Secretos
- `SHOPIFY_ADMIN_ACCESS_TOKEN` (token `shpat_…`, solo backend)
- `SHOPIFY_STOREFRONT_TOKEN` y `SHOPIFY_STORE_DOMAIN` (públicos, van al `.env` como `VITE_…`)
- `SHOPIFY_WEBHOOK_SECRET` para validar los webhooks con firma HMAC

### Backend
- `_shared/shopify-admin.ts`: usar `SHOPIFY_ADMIN_ACCESS_TOKEN` como fuente principal y el token de sesión solo como reserva; errores 401/403 con instrucciones claras (qué scope falta y dónde activarlo).
- `shopify-orders`: ampliar `diagnose` para devolver estado del token, dominio, scopes concedidos y los que faltan (Admin y Storefront), con un veredicto tipo "listo / falta X".
- `shopify-orders-webhook`: verificar la cabecera `X-Shopify-Hmac-Sha256` contra `SHOPIFY_WEBHOOK_SECRET` en lugar del token en la URL.

### Frontend
- Quitar el token y el dominio hardcodeados de `src/lib/shopify.ts`; leerlos de las variables de entorno con aviso claro si faltan.
- Nueva tarjeta **"Conexión y permisos"** en `/dashboard/integrations/shopify`:
  - Estado de la conexión (dominio, tokens presentes, última sincronización).
  - Botón **Comprobar conexión** que muestra la lista de scopes con ✓/✗ y el enlace directo a la pantalla de Shopify donde se corrige cada uno.
  - Guía paso a paso plegable con las instrucciones de arriba.

## Detalles técnicos

- API version `2025-07` en Admin y Storefront.
- Los tokens de app personalizada no caducan, así que desaparecen los 500 por sesión expirada.
- La validación HMAC evita webhooks falsos y es requisito de Shopify para apps en producción.
- El fallback al token de sesión se mantiene para que nada deje de funcionar mientras configuras la app.

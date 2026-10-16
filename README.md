# 403 · Caja y Barra (carta-cocteleria)

Web aparte de 403 para el día del evento y la venta en efectivo. Usa el **mismo
Supabase** de 403events.com (mismos usuarios).

| Ruta | Para quién | Qué hace |
|---|---|---|
| `/barra` | Cajero de barra | Elige licor (Whisky, Tequila…) o Botellas, arma el pedido, cobra (efectivo / transferencia / DeUna). Funciona **sin señal**: guarda el pedido y lo sube solo al volver la conexión. |
| `/bartender` | Bartender | Pedidos por preparar (#número), botón *Entregado*, recetas y "Tomé otra botella". |
| `/caja` | Caja de entradas (ej. D'VORA) | Busca a la persona **aprobada**, elige localidad, cobra en efectivo y la entrada con QR le aparece en su cuenta. |
| `/admin` | Inventario / admin | Carta (precios y recetas), licores, carga y conteo de botellas, cierre de caja y personal. |

## Puesta en marcha (una sola vez)

1. **Supabase → SQL Editor:** pega todo `sql/migration-barra-caja.sql` y dale **Run**.
2. **Vercel → Add New Project →** importa el repo `carta-cocteleria-`. Framework: *Vite*. No hace falta configurar nada más
   (si quieres, agrega las variables de `.env.example`).
3. **Personal:** crea la cuenta en King → Usuarios → Crear (rol *Staff de puerta*). Luego en esta web → Inventario y carta →
   **Personal**, pon su correo y el permiso (Cajero de barra, Bartender, Caja de entradas o Inventario).
   Los administradores de King entran a todo sin permisos extra.

## Cómo cuadra el licor

- Las botellas se cargan en dos grupos: **Cocteleria** (para tragos) y **Venta** (botella entera).
- Cada cóctel descuenta los ml de su receta del grupo Cocteleria; cada botella vendida sale del grupo Venta.
- Si el bartender toma una botella de Venta para cócteles, la registra en **Tomé otra botella**.
- Al cerrar, en **Inventario → Conteo de cierre** se cuenta lo que queda: la tabla muestra en rojo si falta licor.

## Desarrollo

```
npm install
npm run dev
```

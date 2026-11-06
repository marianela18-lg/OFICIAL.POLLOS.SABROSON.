# POLLITOSUPABASE — vanilla2

Sitio de **Pollos Sabroson** escrito en HTML, CSS y JavaScript reales: sin React,
sin Tailwind, sin build y sin paso de compilación. Cualquier archivo `.html`,
`.css` o `.js` se puede abrir y editar directamente.

Esta versión toma el diseño y las funciones de `POLLITOSUPABASE_ESTRUCTURA3`
(que en realidad era una aplicación React compilada) y las reescribe sobre la
base limpia de la versión vanilla.

---

## Estructura

```
POLLITOSUPABASE_vanilla2/
├── index.html            Tienda completa + panel de administración
├── admin.html            Gestor de catálogo independiente
├── css/
│   └── style.css         Todo el sistema de diseño (paleta, layout, componentes)
├── js/
│   ├── icons.js          Iconos SVG en línea (estilo Lucide)
│   ├── supabaseClient.js Configuración pública del cliente Supabase
│   ├── data.js           Catálogo de respaldo, opciones fijas y utilidades
│   ├── app.js            Tienda: menú, carrito, checkout, cuenta
│   ├── adminPanel.js     Panel de administración dentro de index.html
│   └── adminCrud.js      CRUD de productos de admin.html
├── assets/
│   ├── hero-pollos-sabroson.jpg   Portada principal
│   ├── food/             Imagen por categoría
│   └── products/         Una imagen por producto
└── sql/                  Esquema y migraciones de Supabase
```

### Qué hace cada archivo JavaScript

| Archivo | Responsabilidad |
|---|---|
| `icons.js` | Define 23 iconos SVG y la función `icon(nombre, tamaño)`. También rellena los `<span data-icon="...">` del HTML. |
| `supabaseClient.js` | Crea `window.sb`, el cliente compartido por todo el sitio. |
| `data.js` | Catálogo de respaldo (11 productos), presas, acompañantes, categorías y utilidades de formato (`formatPrice`, `normalizeCategory`, `mapProduct`). |
| `app.js` | Encabezado, buscador, filtros, tarjetas de producto, modal de producto, carrito, formulario de pedido, cuenta de cliente y acceso al panel. |
| `adminPanel.js` | Panel con Resumen, Productos, Pedidos, Clientes y Ajustes. Incluye crear, editar, ocultar y eliminar productos. |
| `adminCrud.js` | Misma gestión de catálogo, pero como página aparte (`admin.html`). |

---

## Cómo probarlo

El sitio necesita un servidor estático (no basta con abrir el archivo con doble clic,
porque el navegador bloquea las peticiones desde `file://`).

- **Visual Studio Code:** abre la carpeta e instala la extensión *Live Server*.
  Luego haz clic derecho sobre `index.html` → *Open with Live Server*.
- **Con Python:** `python3 -m http.server` dentro de la carpeta, y abre
  `http://localhost:8000`.

Si Supabase no responde, el menú se muestra igual con el catálogo de respaldo
de `js/data.js`, así que el sitio nunca se ve vacío.

---

## Configurar Supabase

1. Copia todo `sql/schema.sql` en **Supabase → SQL Editor → New query → Run**.
   *(Solo para instalar desde cero: `schema.sql` borra los productos que no estén en su lista de productos base (11 de comida y 3 bebidas). No lo vuelvas a ejecutar en un negocio que ya tiene productos propios; para eso están las migraciones.)*
2. Ejecuta después `sql/migracion_rls.sql`, `sql/migracion_storage.sql` y
   **`sql/migracion_pedidos_seguros.sql`** (obligatoria: los pedidos se crean con la
   función `crear_pedido()`, ya no con un insert directo).
   Después ejecuta **`sql/migracion_fase2.sql`** (pausar tienda, horarios y avisos de
   pedidos nuevos en tiempo real).
   Para la contabilidad ejecuta **`sql/migracion_contabilidad.sql`** (crea la tabla `movimientos_contables`; solo el administrador puede verla).
   Después ejecuta **`sql/migracion_fase3.sql`** (bebidas, seguimiento del pedido y
   tiempo estimado).
   Por último ejecuta **`sql/migracion_editar_pedido.sql`** (el cliente puede editar o eliminar
   su pedido durante unos minutos, y la fecha y hora del pedido se ve en ambos lados).
3. Antes de registrar el primer usuario, ejecuta `sql/REPARAR_SIGNUP.sql`.
   Después, como **ÚLTIMO archivo SQL, ejecuta `sql/migracion_tablas_cortas.sql`**: divide
   `configuracion` y `pedidos` en tablas cortas (ver la sección *Tablas que usa*) y ya incluye
   todo lo de ajustes del negocio, colores, mapa, portada y logo. Por eso **no necesitas**
   `migracion_ajustes_todo.sql`, `migracion_ajustes_negocio.sql`, `migracion_marca_colores.sql`,
   `migracion_color_fondo.sql`, `migracion_mapa.sql`, `migracion_hero.sql` ni `migracion_logo.sql`
   (si ya los ejecutaste antes, no pasa nada). Tampoco los vuelvas a ejecutar *después* de la
   migración: crean columnas en la tabla vieja, que ya no existe.
4. Revisa `js/supabaseClient.js`: debe tener la URL y la *publishable key*
   (o *anon key*) de tu proyecto. Esa clave pública sí puede ir en el frontend;
   **nunca** uses una `service_role` key.
5. En **Authentication** crea el usuario administrador y asígnale el rol con:

   ```sql
   update public.perfiles set rol = 'administrador' where id = 'UUID_DEL_USUARIO';
   ```

### Migraciones opcionales

| Archivo | Para qué sirve |
|---|---|
| `migracion_tablas_cortas.sql` | **Último archivo SQL.** Divide `configuracion` (22 columnas) en 5 tablas cortas y `pedidos` (19 columnas) en 5 tablas cortas, copia los datos existentes, comprueba que los conteos y totales coincidan y deja una copia de seguridad en el esquema `respaldo_v1`. Crea las vistas `configuracion_completa` y `pedidos_completos`. Es seguro ejecutarlo varias veces. Debe subirse junto con la versión del sitio que trae esta migración (carpeta `js/`). |
| `migracion_9_tablas.sql` | **Se ejecuta después de `migracion_tablas_cortas.sql`.** Reduce de 13 a 9 tablas: junta `config_tienda` en `config_negocio`, `config_imagenes` en `config_marca` y `pedido_clientes` + `pedido_entregas` + `pedido_pagos` en `pedido_datos`. Copia los datos, comprueba conteos y totales, y no hace falta cambiar el sitio. No vuelvas a ejecutar `migracion_tablas_cortas.sql` después. |
| `migracion_stock.sql` | Agrega la columna de stock al catálogo existente. |
| `migracion_pedidos_seguros.sql` | Pedidos seguros: precio y total calculados en el servidor, descuento de stock (y devolución al cancelar), código de pedido único, anti-duplicados y límite de 5 pedidos por teléfono por hora. Se puede ejecutar varias veces sin borrar pedidos. |
| `migracion_fase2.sql` | Requiere `migracion_pedidos_seguros.sql`. Agrega **pausar tienda**, **horarios de atención** (con cierre automático, también si pasan de medianoche) y activa **Realtime** en `pedidos` para los avisos del panel. Los pedidos se rechazan en la base de datos si la tienda está cerrada. Se puede ejecutar varias veces. |
| `migracion_fase3.sql` | Requiere `migracion_fase2.sql`. Agrega la categoría **Bebidas** (con 3 bebidas de ejemplo: **sus precios son de referencia, ajústalos en Admin > Productos** o bórralas), la función `ver_pedido()` para que el cliente siga su pedido con su código + su teléfono (sin cuenta) y el **tiempo estimado de entrega**. Se puede ejecutar varias veces. |
| `migracion_editar_pedido.sql` | Requiere `migracion_fase3.sql`. Agrega `editar_pedido()`, `cancelar_pedido_cliente()` y amplía `ver_pedido()` (fecha, si se puede editar y segundos restantes). Crea `configuracion.minutos_edicion` (por defecto 10) y las columnas `pedidos.editado_en` y `pedidos.cancelado_por_cliente`. Se puede ejecutar varias veces. |
| `migracion_logo.sql` | Para editar el **logo de la portada** desde Admin > Ajustes (cambiar, quitar o restaurar el original). Agrega `configuracion.logo_url` y `configuracion.logo_oculto`. Usa el bucket `productos` (`migracion_storage.sql`). Se puede ejecutar varias veces. |
| `migracion_imagenes.sql` | Asigna una imagen por categoría. |
| `migracion_imagenes_productos.sql` | Asigna una imagen distinta a cada producto. |
| `migracion_hero.sql` | Habilita la portada editable desde el panel. |
| `migracion_ajustes_todo.sql` | **Imprescindible para Admin > Ajustes.** Un solo archivo con todo lo necesario (nombre, teléfono, delivery, dirección, mapa, título y colores) + permisos. Ejecútalo una vez en el SQL Editor. Lo guardado en el panel manda sobre `js/config.js`. |
| `migracion_ajustes_negocio.sql` | Necesaria para que el botón "Guardar cambios" de Admin > Ajustes funcione (nombre, teléfono, texto de delivery, dirección). |

---

## Acceso al panel de administración

Hay dos caminos, y los dos piden una cuenta con rol `administrador`:

- **Dentro del sitio:** botón **Administrador** del encabezado. El panel reemplaza
  la tienda y se vuelve con *Ver tienda*.
- **Página aparte:** `admin.html`, pensada para la gestión de catálogo más detallada
  (clave interna de tamaño, stock, disponibilidad).

---

## Tablas que usa

Cada tabla tiene pocas columnas, para que se lea bien en el Table Editor de Supabase
y quepa en un documento.

**En total son 9 tablas** (se llega a este número ejecutando `migracion_9_tablas.sql`).

**Configuración del negocio** (`config_negocio` y `config_marca` tienen una sola fila, `id = 1`):

| Tabla | Columnas | Qué guarda |
|---|---|---|
| `config_negocio` | id, negocio_nombre, telefono, direccion, mapa_url, texto_delivery, tienda_pausada, mensaje_cierre, tiempo_estimado, minutos_edicion, usar_horarios, zona_horaria | Datos del local y estado de la tienda |
| `config_marca` | id, eslogan, color_primario, color_secundario, color_oscuro, color_fondo, logo_url, logo_oculto, hero_url, qr_url | Textos, colores, logo, portada y QR de pago |
| `config_horarios` | dia, abierto, desde, hasta | 7 filas, una por día (`dom` … `sab`) |

**Pedidos** (se unen por `pedido_id`):

| Tabla | Columnas | Qué guarda |
|---|---|---|
| `pedidos` | id, codigo_pedido, usuario_id, estado, creado_en, editado_en, cancelado_por_cliente, clave_idempotencia | El pedido en sí |
| `pedido_datos` | pedido_id, nombre_cliente, telefono, correo, tipo_entrega, direccion, notas, metodo_pago, subtotal, costo_envio, total | Cliente, entrega y pago (una fila por pedido) |
| `pedido_items` | id, pedido_id, producto_id, nombre_producto, tamano_etiqueta, presa, acompanante, precio_unitario, cantidad | Una fila por producto del pedido |

**Sin cambios:** `productos`, `perfiles` y `movimientos_contables`.

**Vistas de solo lectura** (juntan las tablas cortas; el sitio las usa para leer, no se editan):
`configuracion_completa` y `pedidos_completos`. Si quieres ver un pedido completo en
Supabase, abre la vista `pedidos_completos`.

**Cómo se escribe:** los pedidos se crean con `crear_pedido()` y el cliente los edita o
elimina con `editar_pedido()` y `cancelar_pedido_cliente()`; los ajustes se guardan con
`guardar_configuracion()` (solo administrador). El administrador cambia el estado de un
pedido directamente en la tabla `pedidos`.

**Copia de seguridad:** al migrar, las tablas viejas se copian al esquema `respaldo_v1`
(`respaldo_v1.pedidos` y `respaldo_v1.configuracion`). No lo usa el sitio ni aparece en el
Table Editor normal. Cuando confirmes que todo funciona, puedes borrarlo con
`drop schema respaldo_v1 cascade;`.

Además hay dos buckets de Storage: `pagos` (imagen QR) y `productos` (fotos del catálogo).
Las políticas RLS permiten leer el catálogo y la configuración públicamente y reservar la
gestión para administradores. Los pedidos sin cuenta se crean únicamente con
`crear_pedido()`, que valida datos, precios y stock en el servidor.

---

## Notas sobre esta versión

- El SDK de Supabase está incluido **localmente** en `js/supabase.js` (no se descarga
  de ningún CDN externo). Esto evita que un bloqueador de anuncios, un firewall
  corporativo o la "Prevención de seguimiento" de navegadores como Edge impidan
  que el sitio funcione. Si en el futuro quieres actualizar la versión del SDK,
  descarga el archivo `dist/umd/supabase.js` del paquete `@supabase/supabase-js`
  de npm y reemplaza `js/supabase.js`.
- Las rutas de imágenes son **relativas** (`./assets/...`), así que el sitio funciona
  también dentro de un subdirectorio, por ejemplo en GitHub Pages.
- El carrito se guarda en `localStorage`, así que sobrevive a una recarga.
- **Resumen del panel con datos reales:** ventas, pedidos, clientes y consumo promedio
  de los últimos 7 días, comparados con los 7 días anteriores (los pedidos cancelados no
  cuentan). La gráfica semanal y la dona por categoría también se calculan con los
  pedidos reales.
- **Aviso de pedido nuevo:** al entrar un pedido el panel muestra un aviso, suena un
  "ding-dong" (se puede silenciar con la campana), marca la pestaña del navegador con
  `(1) Pedido nuevo` y, si das permiso, envía una notificación del sistema. Usa
  Realtime y, como respaldo, revisa cada 20 segundos. El navegador solo deja sonar
  audio después de que hagas un clic en la página: abre el panel y haz clic una vez.
- **Ticket imprimible:** en Pedidos, el botón de la impresora arma un ticket para
  cocina (ancho de impresora térmica de 80 mm) y abre el diálogo de impresión.
- **Pausar tienda / horarios:** Admin > Ajustes > *Estado de la tienda* y el botón de
  la parte superior del panel. Los clientes ven un aviso y no pueden confirmar pedidos.
  La hora de la tienda es la de Bolivia (`America/La_Paz`).
- **Venta cruzada de bebidas:** en la bolsa aparece "¿Le agregas una bebida?" con hasta 3
  bebidas disponibles (solo si el pedido no tiene ya una). Si no hay bebidas cargadas, el
  bloque y el filtro "Bebidas" no se muestran. Se administran en Admin > Productos,
  categoría *Bebida*; cambia el ícono genérico `assets/products/bebida.svg` subiendo tus propias fotos.
- **Confirmación y seguimiento del pedido:** al confirmar, el cliente ve su código, el total,
  la línea de tiempo (recibido → preparando → en camino / listo para recoger → entregado), el
  tiempo estimado y un botón para compartir por WhatsApp. El estado se actualiza solo cada 15
  segundos. Si el pago es por QR y aún no se confirma, muestra el QR y el botón de comprobante
  con el código. Mientras el pedido siga en curso, queda un botón flotante **Mi pedido** que
  vuelve a abrir el seguimiento (también después de recargar la página).
- **Tiempo estimado:** Admin > Ajustes > *Estado de la tienda* (por ejemplo "30 a 40 min").
- **Imágenes livianas:** el paquete de imágenes pasó de 7,2 MB a 1,5 MB (la portada de 4,6 MB
  a ~200 KB) con los mismos nombres de archivo, así que las rutas guardadas en Supabase no cambian.
- **Vista previa al compartir el enlace:** `index.html` incluye etiquetas Open Graph / Twitter y
  `assets/og-image.jpg` (1200 × 630). **WhatsApp y Facebook no leen rutas relativas:** cuando tengas tu
  dominio, cambia `og:image` y `twitter:image` en `index.html` por la dirección completa
  (por ejemplo `https://tudominio.com/assets/og-image.jpg`).
- **Buscador:** funciona sin importar tildes ni mayúsculas, acepta varias palabras
  ("broaster entero") y hay un campo también dentro del menú. En celular la lupa del
  encabezado lleva a ese campo.
- **Nombre de usuario en la esquina:** con sesión iniciada aparece tu primer nombre
  (o **Admin** si eres administrador), con un menú para ver tu correo, abrir el panel
  y cerrar sesión.
- **Editar o eliminar el pedido (cliente):** en la pantalla de seguimiento (y desde el botón flotante
  **Mi pedido** o **Mis pedidos > Ver seguimiento**) aparece una cuenta regresiva con los botones
  **Editar pedido** y **Eliminar pedido**. Se puede cambiar la cantidad de cada producto, quitar
  productos, el tipo de entrega, la dirección, las notas y la forma de pago. El plazo (por defecto
  **10 minutos desde que se hizo el pedido**) se cambia en Admin > Ajustes > *Estado de la tienda*
  (0 = desactivado). Solo se puede mientras el pedido siga en **Pendiente de pago**: en cuanto el
  administrador lo pase a otro estado, queda bloqueado. Todo lo valida el servidor (tiempo, estado,
  precios y stock). Los productos que ya estaban en el pedido conservan su precio original; el stock se
  ajusta solo (baja o vuelve según los cambios). *No se pueden agregar productos nuevos desde la edición:*
  para eso el cliente elimina el pedido y hace uno nuevo.
- **"Eliminar" = cancelar por el cliente:** el pedido no se borra de la base; pasa a *Cancelado*, se
  devuelve el stock y el administrador lo ve con la marca **Eliminado por el cliente** (no cuenta como
  venta). Así queda el historial y no se rompe la numeración de códigos.
- **Fecha y hora del pedido:** el cliente la ve en el seguimiento (con "Editado el..." si lo cambió) y
  en su ticket. El administrador la ve debajo del código de cada pedido en Pedidos y en el Resumen,
  junto con la marca **Editado hh:mm** y en el ticket de cocina (**PEDIDO EDITADO**).
- **Aviso al administrador:** si el cliente edita o elimina un pedido, el panel muestra un aviso y suena
  el "ding-dong" (Realtime con respaldo cada 20 s), para que cocina no prepare la versión anterior.
- **Compartir la tienda:** botón de compartir en el encabezado y enlace "Compartir la tienda" en el pie.
  Abre una ventana con el logo (`assets/logo-sabroson.jpg`), el enlace de la tienda, **Copiar**,
  **WhatsApp**, **Facebook** y, en celulares que lo permiten, **Más opciones** (menú de compartir del
  teléfono). El enlace se toma de la dirección donde esté publicada la tienda.
- **Portada con el logo (editable):** la portada muestra el logo de Sabroson sobre fondo oscuro con un brillo
  del color de la marca. El administrador lo maneja en **Admin > Ajustes > Logo de la portada**: *Seleccionar
  imagen* + *Guardar logo* (PNG, JPG o WEBP, hasta 5 MB), **Quitar logo** (la portada queda solo con el texto) y
  **Restaurar original** (vuelve a `assets/logo-sabroson.jpg`). Al cambiar o restaurar se borra del almacenamiento
  el logo anterior. Si el logo subido no carga, la tienda muestra el original. Requiere
  `sql/migracion_logo.sql`. El campo antiguo de foto de portada ya no se usa. En celular el logo baja debajo
  del título.

## Stock y favoritos (actualización)

- **Stock 99 en cada producto:** ejecuta una sola vez `sql/migracion_stock_99.sql` en el SQL Editor de Supabase
  (después de `sql/migracion_stock.sql`). Los productos nuevos también empiezan con 99.
- **Editar el stock (administrador):** panel → Productos. Cada fila tiene `−`, un campo numérico, `+` y **Guardar**.
  También está el formulario **Editar** y el botón **Stock 99 a todos**. Con stock 0 el producto se oculta de la tienda
  y, al volver a tener stock, se reactiva solo. Requiere cuenta con rol `administrador` (políticas RLS ya existentes).
- **Tienda:** cada producto muestra su stock (`Stock: 99`, `¡Últimas N!` o `Agotado`). La bolsa no deja pedir más
  de lo que hay; además la función SQL del servidor sigue validando el stock al confirmar el pedido.
- **Favoritos:** el corazón de cada producto lo guarda o lo quita. Los favoritos se guardan en el navegador de cada
  cliente (`localStorage`, clave `ps_favoritos`), por lo que no necesitan una tabla nueva ni inicio de sesión.
  El filtro **Favoritos** del menú muestra solo los guardados.

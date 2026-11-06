-- =====================================================================
-- POLLOS SABROSON · TABLAS CORTAS
--
-- Divide las dos tablas más anchas en varias tablas pequeñas:
--
--   configuracion (22 columnas)  ->  config_negocio    (6)
--                                    config_marca      (6)
--                                    config_imagenes   (5)
--                                    config_tienda     (7)
--                                    config_horarios   (4, una fila por día)
--
--   pedidos (19 columnas)        ->  pedidos           (8)  datos del pedido
--                                    pedido_clientes   (4)  quién pide
--                                    pedido_entregas   (4)  delivery / recojo
--                                    pedido_pagos      (5)  método y montos
--                                    pedido_items      (9)  una fila por producto
--
-- Para que el sitio siga leyendo "todo junto" se crean dos VISTAS
-- (solo lectura, no se editan a mano):
--   configuracion_completa   y   pedidos_completos
--
-- QUÉ NO TOCA: productos, perfiles y movimientos_contables quedan igual.
--
-- CÓMO EJECUTARLO
--   * Es el ÚLTIMO archivo SQL de la lista. Requiere haber ejecutado antes
--     schema.sql, migracion_rls.sql, migracion_pedidos_seguros.sql y
--     migracion_fase2.sql (y fase3 y editar_pedido, si usas esas funciones).
--     Los ajustes de negocio, colores, mapa, portada y logo ya van incluidos
--     aquí: no hace falta ejecutar migracion_ajustes_*.sql ni migracion_logo.sql.
--   * Pégalo completo en Supabase > SQL Editor > New query > Run.
--   * Se ejecuta como una sola operación: si algo falla, no se cambia nada.
--   * Copia los datos existentes (pedidos y ajustes) a las tablas nuevas,
--     comprueba que los conteos y totales coincidan, y guarda una copia de
--     las tablas viejas en el esquema "respaldo_v1" (no aparece en el
--     Table Editor normal ni es accesible desde el sitio).
--   * Es seguro ejecutarlo más de una vez: si ya está migrado, no repite.
--   * NO vuelvas a ejecutar migracion_ajustes_*.sql, migracion_mapa.sql,
--     migracion_marca_colores.sql, migracion_color_fondo.sql,
--     migracion_hero.sql ni migracion_logo.sql después de esta migración
--     (esos archivos crean columnas en la tabla vieja que ya no existe).
--   * Sube al mismo tiempo la nueva versión del sitio (carpeta js/).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) TABLAS NUEVAS DE CONFIGURACIÓN
-- ---------------------------------------------------------------------
create table if not exists public.config_negocio (
  id integer primary key default 1 check (id = 1),
  negocio_nombre text not null default 'Pollos Sabroson',
  telefono       text not null default '70000000',
  direccion      text not null default 'Av. Principal 123, Zona Centro',
  mapa_url       text not null default '',
  texto_delivery text not null default 'Coordinamos la entrega en tu dirección'
);

create table if not exists public.config_marca (
  id integer primary key default 1 check (id = 1),
  eslogan           text not null default 'El sabor que|une a la familia.',
  color_primario    text not null default '#e65636',
  color_secundario  text not null default '#e9ab35',
  color_oscuro      text not null default '#28241f',
  color_fondo       text not null default '#fffdfa'
);

create table if not exists public.config_imagenes (
  id integer primary key default 1 check (id = 1),
  logo_url    text,                          -- null = logo original del sitio
  logo_oculto boolean not null default false,
  hero_url    text,
  qr_url      text
);

create table if not exists public.config_tienda (
  id integer primary key default 1 check (id = 1),
  tienda_pausada  boolean not null default false,
  mensaje_cierre  text    not null default '',
  tiempo_estimado text    not null default '',
  minutos_edicion integer not null default 10 check (minutos_edicion between 0 and 120),
  usar_horarios   boolean not null default false,   -- false = siempre abierto
  zona_horaria    text    not null default 'America/La_Paz'
);

-- Una fila por día. Si "hasta" es menor que "desde", cierra pasada la medianoche.
create table if not exists public.config_horarios (
  dia     text primary key check (dia in ('dom','lun','mar','mie','jue','vie','sab')),
  abierto boolean not null default true,
  desde   time    not null default '11:00',
  hasta   time    not null default '22:00'
);


-- ---------------------------------------------------------------------
-- 2) TABLAS NUEVAS DE PEDIDOS (las columnas se agregan antes de copiar)
-- ---------------------------------------------------------------------
-- "pedidos" ya existe: aquí solo se asegura que tenga las columnas que
-- se quedan en ella. Las demás se mueven a las tablas hijas.
alter table public.pedidos
  add column if not exists clave_idempotencia   text,
  add column if not exists editado_en           timestamptz,
  add column if not exists cancelado_por_cliente boolean not null default false;

create table if not exists public.pedido_clientes (
  pedido_id      uuid primary key references public.pedidos(id) on delete cascade,
  nombre_cliente text not null,
  telefono       text not null,
  correo         text
);

create table if not exists public.pedido_entregas (
  pedido_id    uuid primary key references public.pedidos(id) on delete cascade,
  tipo_entrega text not null check (tipo_entrega in ('delivery', 'recojo')),
  direccion    text,
  notas        text
);

create table if not exists public.pedido_pagos (
  pedido_id   uuid primary key references public.pedidos(id) on delete cascade,
  metodo_pago text not null default 'efectivo' check (metodo_pago in ('efectivo', 'qr')),
  subtotal    numeric(10,2) not null check (subtotal >= 0),
  costo_envio numeric(10,2) not null default 0 check (costo_envio >= 0),
  total       numeric(10,2) not null check (total >= 0)
);

-- producto_id es texto y sin llave foránea a propósito: el pedido conserva
-- su historial aunque el producto se borre o sea un pedido muy antiguo.
create table if not exists public.pedido_items (
  id              bigint generated always as identity primary key,
  pedido_id       uuid not null references public.pedidos(id) on delete cascade,
  producto_id     text,
  nombre_producto text not null,
  tamano_etiqueta text,
  presa           text,
  acompanante     text,
  precio_unitario numeric(10,2) not null default 0,
  cantidad        integer not null default 1
);

create index if not exists pedido_items_pedido_idx    on public.pedido_items (pedido_id);
create index if not exists pedido_clientes_tel_idx    on public.pedido_clientes (telefono);


-- ---------------------------------------------------------------------
-- 3) COPIA DE LOS DATOS EXISTENTES (solo si todavía están en las tablas viejas)
-- ---------------------------------------------------------------------
create or replace function pg_temp.num(p_texto text, p_defecto numeric)
returns numeric language sql immutable as $$
  select case when p_texto ~ '^-?[0-9]+(\.[0-9]+)?$' then p_texto::numeric else p_defecto end
$$;

do $$
declare
  v_h        jsonb;
  v_dia      text;
  v_n_viejos integer;
  v_t_viejo  numeric;
  v_i_viejos integer;
begin
  -- 3a) Configuración -------------------------------------------------
  if to_regclass('public.configuracion') is not null then
    -- Asegura que existan todas las columnas viejas (por si faltó alguna migración).
    alter table public.configuracion
      add column if not exists negocio_nombre   text,
      add column if not exists telefono         text,
      add column if not exists texto_delivery   text,
      add column if not exists direccion        text,
      add column if not exists mapa_url         text,
      add column if not exists eslogan          text,
      add column if not exists color_primario   text,
      add column if not exists color_secundario text,
      add column if not exists color_oscuro     text,
      add column if not exists color_fondo      text,
      add column if not exists hero_url         text,
      add column if not exists qr_url           text,
      add column if not exists logo_url         text,
      add column if not exists logo_oculto      boolean,
      add column if not exists tienda_pausada   boolean,
      add column if not exists mensaje_cierre   text,
      add column if not exists horarios         jsonb,
      add column if not exists zona_horaria     text,
      add column if not exists tiempo_estimado  text,
      add column if not exists minutos_edicion  integer;

    create schema if not exists respaldo_v1;
    drop table if exists respaldo_v1.configuracion;
    create table respaldo_v1.configuracion as table public.configuracion;
    alter table respaldo_v1.configuracion enable row level security;

    insert into public.config_negocio (id, negocio_nombre, telefono, direccion, mapa_url, texto_delivery)
    select 1,
           coalesce(negocio_nombre, 'Pollos Sabroson'),
           coalesce(telefono, '70000000'),
           coalesce(direccion, 'Av. Principal 123, Zona Centro'),
           coalesce(mapa_url, ''),
           coalesce(texto_delivery, 'Coordinamos la entrega en tu dirección')
    from public.configuracion where id = 1
    on conflict (id) do nothing;

    insert into public.config_marca (id, eslogan, color_primario, color_secundario, color_oscuro, color_fondo)
    select 1,
           coalesce(eslogan, 'El sabor que|une a la familia.'),
           coalesce(color_primario, '#e65636'),
           coalesce(color_secundario, '#e9ab35'),
           coalesce(color_oscuro, '#28241f'),
           coalesce(color_fondo, '#fffdfa')
    from public.configuracion where id = 1
    on conflict (id) do nothing;

    insert into public.config_imagenes (id, logo_url, logo_oculto, hero_url, qr_url)
    select 1, logo_url, coalesce(logo_oculto, false), hero_url, qr_url
    from public.configuracion where id = 1
    on conflict (id) do nothing;

    insert into public.config_tienda (id, tienda_pausada, mensaje_cierre, tiempo_estimado,
                                      minutos_edicion, usar_horarios, zona_horaria)
    select 1,
           coalesce(tienda_pausada, false),
           coalesce(mensaje_cierre, ''),
           coalesce(tiempo_estimado, ''),
           least(120, greatest(0, coalesce(minutos_edicion, 10))),
           (horarios is not null and jsonb_typeof(horarios) = 'object'),
           coalesce(nullif(zona_horaria, ''), 'America/La_Paz')
    from public.configuracion where id = 1
    on conflict (id) do nothing;

    -- Horarios: del JSON viejo a una fila por día
    insert into public.config_horarios (dia)
    select unnest(array['dom','lun','mar','mie','jue','vie','sab'])
    on conflict (dia) do nothing;

    select horarios into v_h from public.configuracion where id = 1;
    if v_h is not null and jsonb_typeof(v_h) = 'object' then
      foreach v_dia in array array['dom','lun','mar','mie','jue','vie','sab'] loop
        begin
          update public.config_horarios
          set abierto = coalesce((v_h -> v_dia ->> 'abierto')::boolean, true),
              desde   = coalesce(nullif(v_h -> v_dia ->> 'desde', '')::time, '11:00'),
              hasta   = coalesce(nullif(v_h -> v_dia ->> 'hasta', '')::time, '22:00')
          where dia = v_dia;
        exception when others then
          null;  -- horario mal escrito en ese día: se deja el valor por defecto
        end;
      end loop;
    end if;
  end if;

  -- 3b) Pedidos -------------------------------------------------------
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'pedidos' and column_name = 'items') then

    alter table public.pedidos
      add column if not exists correo      text,
      add column if not exists metodo_pago text,
      add column if not exists costo_envio numeric(10,2),
      add column if not exists subtotal    numeric(10,2);

    create schema if not exists respaldo_v1;
    drop table if exists respaldo_v1.pedidos;
    create table respaldo_v1.pedidos as table public.pedidos;
    alter table respaldo_v1.pedidos enable row level security;

    -- Se vacían las hijas por si una ejecución anterior se cortó a medias
    delete from public.pedido_items;
    delete from public.pedido_clientes;
    delete from public.pedido_entregas;
    delete from public.pedido_pagos;

    insert into public.pedido_clientes (pedido_id, nombre_cliente, telefono, correo)
    select id, coalesce(nombre_cliente, ''), coalesce(telefono, ''), correo from public.pedidos;

    insert into public.pedido_entregas (pedido_id, tipo_entrega, direccion, notas)
    select id, coalesce(tipo_entrega, 'recojo'), direccion, notas from public.pedidos;

    insert into public.pedido_pagos (pedido_id, metodo_pago, subtotal, costo_envio, total)
    select id,
           case when metodo_pago in ('efectivo', 'qr') then metodo_pago else 'efectivo' end,
           coalesce(subtotal, total, 0), coalesce(costo_envio, 0), coalesce(total, 0)
    from public.pedidos;

    insert into public.pedido_items (pedido_id, producto_id, nombre_producto, tamano_etiqueta,
                                     presa, acompanante, precio_unitario, cantidad)
    select p.id,
           coalesce(i.e ->> 'producto_id', i.e ->> 'id'),
           coalesce(nullif(i.e ->> 'nombre_producto', ''), nullif(i.e ->> 'nombre', ''),
                    nullif(i.e ->> 'name', ''), 'Producto'),
           i.e ->> 'tamano_etiqueta',
           i.e ->> 'presa',
           i.e ->> 'acompanante',
           pg_temp.num(coalesce(i.e ->> 'precio_unitario', i.e ->> 'precio', i.e ->> 'price'), 0),
           greatest(1, pg_temp.num(coalesce(i.e ->> 'cantidad', i.e ->> 'qty', i.e ->> 'quantity'), 1)::integer)
    from public.pedidos p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.items) = 'array' then p.items else '[]'::jsonb end
    ) with ordinality as i(e, n)
    order by p.creado_en, p.id, i.n;

    -- Comprobación: conteos y totales deben coincidir con lo que había
    select count(*), coalesce(sum(total), 0),
           coalesce(sum(case when jsonb_typeof(items) = 'array' then jsonb_array_length(items) else 0 end), 0)
      into v_n_viejos, v_t_viejo, v_i_viejos
    from public.pedidos;

    if (select count(*) from public.pedido_clientes) <> v_n_viejos
       or (select count(*) from public.pedido_entregas) <> v_n_viejos
       or (select count(*) from public.pedido_pagos) <> v_n_viejos then
      raise exception 'MIGRACION: la cantidad de pedidos copiados no coincide. No se cambió nada.';
    end if;
    if (select coalesce(sum(total), 0) from public.pedido_pagos) <> v_t_viejo then
      raise exception 'MIGRACION: el total de los pedidos copiados no coincide. No se cambió nada.';
    end if;
    if (select count(*) from public.pedido_items) <> v_i_viejos then
      raise exception 'MIGRACION: la cantidad de productos copiados no coincide. No se cambió nada.';
    end if;
  end if;
end $$;

-- Reglas que antes tenía la tabla pedidos, ahora en las tablas hijas.
-- "not valid": protegen los pedidos nuevos sin fallar por pedidos viejos.
alter table public.pedido_clientes drop constraint if exists pedidos_telefono_check;
alter table public.pedido_clientes add constraint pedidos_telefono_check
  check (telefono ~ '^[0-9]{7,15}$') not valid;

alter table public.pedido_entregas drop constraint if exists pedidos_direccion_delivery_check;
alter table public.pedido_entregas add constraint pedidos_direccion_delivery_check
  check (tipo_entrega <> 'delivery' or length(btrim(coalesce(direccion, ''))) >= 8) not valid;

alter table public.pedido_items drop constraint if exists pedido_items_cantidad_check;
alter table public.pedido_items add constraint pedido_items_cantidad_check
  check (cantidad >= 1) not valid;


-- ---------------------------------------------------------------------
-- 4) FUNCIONES (reescritas para las tablas nuevas)
-- ---------------------------------------------------------------------

-- 4a) Estado de la tienda (abierta / cerrada) --------------------------
create or replace function public.tienda_estado(p_ahora timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_tz text;
  v_ahora timestamp;
  v_t time;
  v_dow int;
  v_dias text[] := array['dom','lun','mar','mie','jue','vie','sab'];
  v_nombres text[] := array['el domingo','el lunes','el martes','el miércoles','el jueves','el viernes','el sábado'];
  h_hoy record;
  h_ayer record;
  h_cand record;
  v_d time;
  v_h time;
  v_abierta boolean := false;
  v_hasta text;
  v_proxima text;
  v_i int;
  v_idx int;
begin
  select tienda_pausada, mensaje_cierre, usar_horarios, zona_horaria into c
  from public.config_tienda where id = 1;

  if not found then
    return jsonb_build_object('abierta', true);
  end if;

  if c.tienda_pausada then
    return jsonb_build_object(
      'abierta', false,
      'motivo', 'pausada',
      'mensaje', coalesce(nullif(btrim(c.mensaje_cierre), ''),
                          'Estamos tomando una pausa. Vuelve en unos minutos.')
    );
  end if;

  -- Sin horarios activados: siempre abierto
  if not c.usar_horarios then
    return jsonb_build_object('abierta', true);
  end if;

  begin
    v_tz := coalesce(nullif(c.zona_horaria, ''), 'America/La_Paz');
    v_ahora := p_ahora at time zone v_tz;
    v_t := v_ahora::time;
    v_dow := extract(dow from v_ahora)::int;       -- 0 = domingo

    select * into h_hoy  from public.config_horarios where dia = v_dias[v_dow + 1];
    select * into h_ayer from public.config_horarios where dia = v_dias[((v_dow + 6) % 7) + 1];

    -- ¿Abierto por el horario de hoy?
    if h_hoy.dia is not null and h_hoy.abierto then
      v_d := h_hoy.desde;
      v_h := h_hoy.hasta;
      if v_d < v_h then
        v_abierta := v_t >= v_d and v_t < v_h;
      else
        v_abierta := v_t >= v_d;                    -- cruza la medianoche
      end if;
      v_hasta := to_char(v_h, 'HH24:MI');
    end if;

    -- ¿Abierto por la madrugada que viene del horario de ayer?
    if not v_abierta and h_ayer.dia is not null and h_ayer.abierto then
      v_d := h_ayer.desde;
      v_h := h_ayer.hasta;
      if v_h <= v_d and v_t < v_h then
        v_abierta := true;
        v_hasta := to_char(v_h, 'HH24:MI');
      end if;
    end if;

    if v_abierta then
      return jsonb_build_object('abierta', true, 'hasta', v_hasta);
    end if;

    -- Próxima apertura
    for v_i in 0..7 loop
      v_idx := (v_dow + v_i) % 7;
      select * into h_cand from public.config_horarios where dia = v_dias[v_idx + 1];
      if h_cand.dia is not null and h_cand.abierto then
        v_d := h_cand.desde;
        if v_i = 0 and v_t < v_d then
          v_proxima := 'Abrimos hoy a las ' || to_char(v_d, 'HH24:MI');
          exit;
        elsif v_i = 1 then
          v_proxima := 'Abrimos mañana a las ' || to_char(v_d, 'HH24:MI');
          exit;
        elsif v_i >= 2 then
          v_proxima := 'Abrimos ' || v_nombres[v_idx + 1] || ' a las ' || to_char(v_d, 'HH24:MI');
          exit;
        end if;
      end if;
    end loop;

    return jsonb_build_object(
      'abierta', false,
      'motivo', 'fuera_horario',
      'mensaje', 'Ahora estamos cerrados.' || coalesce(' ' || v_proxima || '.', ''),
      'proxima', v_proxima
    );
  exception when others then
    -- Si el horario guardado está mal escrito, no bloqueamos la tienda
    return jsonb_build_object('abierta', true);
  end;
end;
$$;

revoke all on function public.tienda_estado(timestamptz) from public;
grant execute on function public.tienda_estado(timestamptz) to anon, authenticated;


-- 4b) Crear pedido -----------------------------------------------------
create or replace function public.crear_pedido(
  p_nombre text,
  p_telefono text,
  p_tipo_entrega text,
  p_direccion text,
  p_notas text,
  p_metodo_pago text,
  p_items jsonb,
  p_clave text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre   text := btrim(coalesce(p_nombre, ''));
  v_telefono text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_direccion text := nullif(btrim(coalesce(p_direccion, '')), '');
  v_notas    text := nullif(left(btrim(coalesce(p_notas, '')), 160), '');
  v_clave    text := nullif(btrim(coalesce(p_clave, '')), '');
  v_uid      uuid := auth.uid();
  v_correo   text;
  v_existente record;
  v_linea    jsonb;
  v_prod     public.productos%rowtype;
  v_id       uuid;
  v_qty      integer;
  v_pid      text;
  v_presa    text;
  v_acomp    text;
  v_items    jsonb := '[]'::jsonb;
  v_subtotal numeric(10,2) := 0;
  v_codigo   text;
  v_recientes integer;
  v_pedido_id uuid;
  v_agrupado record;
begin
  -- Reintento del mismo envío: devolvemos el pedido ya creado (no duplicamos).
  if v_clave is not null then
    select p.id, p.codigo_pedido, coalesce(g.total, 0) as total into v_existente
    from public.pedidos p
    left join public.pedido_pagos g on g.pedido_id = p.id
    where p.clave_idempotencia = v_clave;
    if found then
      return jsonb_build_object('codigo', v_existente.codigo_pedido,
                                'total', v_existente.total, 'repetido', true);
    end if;
  end if;

  -- Validación de datos del cliente
  if length(v_nombre) < 2 or length(v_nombre) > 80 then
    raise exception 'DATOS:Escribe tu nombre para continuar.';
  end if;
  if v_telefono !~ '^[0-9]{7,15}$' then
    raise exception 'DATOS:Escribe un número de teléfono válido.';
  end if;
  if p_tipo_entrega not in ('delivery', 'recojo') then
    raise exception 'DATOS:Elige delivery o recojo en tienda.';
  end if;
  if p_tipo_entrega = 'delivery' and (v_direccion is null or length(v_direccion) < 8) then
    raise exception 'DATOS:Escribe una dirección válida para el delivery.';
  end if;
  if p_metodo_pago not in ('efectivo', 'qr') then
    raise exception 'DATOS:Elige una forma de pago.';
  end if;
  if p_tipo_entrega = 'recojo' then v_direccion := null; end if;
  v_direccion := left(v_direccion, 160);

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'DATOS:Tu bolsa está vacía o tiene demasiados productos.';
  end if;

  -- Anti-spam: máximo 5 pedidos por teléfono en la última hora
  select count(*) into v_recientes
  from public.pedidos p
  join public.pedido_clientes c on c.pedido_id = p.id
  where c.telefono = v_telefono and p.creado_en > now() - interval '1 hour';
  if v_recientes >= 5 then
    raise exception 'LIMITE:Hiciste varios pedidos seguidos. Llámanos para confirmar o espera un momento.';
  end if;

  -- Tomamos cada producto UNA vez, en orden fijo (evita bloqueos cruzados),
  -- sumando cantidades si el mismo producto aparece en varias líneas.
  begin
    for v_agrupado in
      select (e->>'producto_id')::uuid as pid,
             sum(least(greatest(coalesce((e->>'cantidad')::integer, 0), 0), 50))::integer as qty
      from jsonb_array_elements(p_items) e
      group by 1
      order by 1
    loop
      if v_agrupado.qty < 1 then
        raise exception 'DATOS:Cantidad no válida en tu bolsa.';
      end if;

      select * into v_prod from public.productos where id = v_agrupado.pid for update;
      if not found or v_prod.disponible is not true then
        raise exception 'PRODUCTO:Un producto de tu bolsa ya no está disponible. Actualiza el menú e inténtalo de nuevo.';
      end if;
      if v_prod.stock < v_agrupado.qty then
        raise exception 'STOCK:%', 'Quedan solo ' || v_prod.stock || ' de "' || v_prod.nombre || '". Ajusta la cantidad.';
      end if;

      update public.productos
      set stock = stock - v_agrupado.qty,
          disponible = (stock - v_agrupado.qty) > 0
      where id = v_agrupado.pid;
    end loop;
  exception
    when invalid_text_representation then
      raise exception 'PRODUCTO:Un producto de tu bolsa no es válido. Actualiza el menú e inténtalo de nuevo.';
  end;

  -- Armamos las líneas con datos del SERVIDOR (precio y nombre reales)
  for v_linea in select * from jsonb_array_elements(p_items) loop
    v_id  := (v_linea->>'producto_id')::uuid;
    v_pid := v_id::text;
    v_qty := least(greatest(coalesce((v_linea->>'cantidad')::integer, 1), 1), 50);

    select * into v_prod from public.productos where id = v_id;

    v_presa := case when (v_linea->>'presa') in ('pecho', 'contra', 'ala', 'pierna')
                    then v_linea->>'presa' else null end;
    v_acomp := case when (v_linea->>'acompanante') in ('Soda', 'Ensalada', 'Sin acompañante')
                    then v_linea->>'acompanante' else null end;

    v_items := v_items || jsonb_build_object(
      'producto_id', v_pid,
      'nombre_producto', v_prod.nombre,
      'tamano_etiqueta', v_prod.tamano_etiqueta,
      'presa', v_presa,
      'acompanante', v_acomp,
      'precio_unitario', v_prod.precio,
      'cantidad', v_qty
    );
    v_subtotal := v_subtotal + (v_prod.precio * v_qty);
  end loop;

  -- Código único legible (salta cualquier código que ya exista)
  loop
    v_codigo := 'PS-' || nextval('public.pedidos_codigo_seq');
    exit when not exists (select 1 from public.pedidos where codigo_pedido = v_codigo);
  end loop;

  if v_uid is not null then
    select email into v_correo from auth.users where id = v_uid;
  end if;

  -- El pedido se reparte en sus tablas (todo dentro de la misma transacción)
  insert into public.pedidos (codigo_pedido, usuario_id, estado, clave_idempotencia)
  values (v_codigo, v_uid, 'pendiente_pago', v_clave)
  returning id into v_pedido_id;

  insert into public.pedido_clientes (pedido_id, nombre_cliente, telefono, correo)
  values (v_pedido_id, v_nombre, v_telefono, v_correo);

  insert into public.pedido_entregas (pedido_id, tipo_entrega, direccion, notas)
  values (v_pedido_id, p_tipo_entrega, v_direccion, v_notas);

  insert into public.pedido_pagos (pedido_id, metodo_pago, subtotal, costo_envio, total)
  values (v_pedido_id, p_metodo_pago, v_subtotal, 0, v_subtotal);

  insert into public.pedido_items (pedido_id, producto_id, nombre_producto, tamano_etiqueta,
                                   presa, acompanante, precio_unitario, cantidad)
  select v_pedido_id, i.e->>'producto_id', i.e->>'nombre_producto', i.e->>'tamano_etiqueta',
         i.e->>'presa', i.e->>'acompanante', (i.e->>'precio_unitario')::numeric, (i.e->>'cantidad')::integer
  from jsonb_array_elements(v_items) with ordinality as i(e, n)
  order by i.n;

  return jsonb_build_object('codigo', v_codigo, 'total', v_subtotal, 'repetido', false);
end;
$$;

revoke all on function public.crear_pedido(text, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.crear_pedido(text, text, text, text, text, text, jsonb, text)
  to anon, authenticated;


-- 4c) Stock: devolver al cancelar y volver a descontar si se reactiva ----
create or replace function public.ajustar_stock_por_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linea record;
  v_id uuid;
  v_qty integer;
begin
  if new.estado = old.estado then
    return new;
  end if;

  if new.estado = 'cancelado' and old.estado <> 'cancelado' then
    for v_linea in select producto_id, cantidad from public.pedido_items where pedido_id = old.id order by id loop
      begin
        v_id := v_linea.producto_id::uuid;
        v_qty := coalesce(v_linea.cantidad, 0);
        update public.productos
        set disponible = case when stock = 0 and v_qty > 0 then true else disponible end,
            stock = stock + v_qty
        where id = v_id;
      exception when invalid_text_representation then
        null; -- pedidos antiguos con ids que no son UUID: no hay stock que devolver
      end;
    end loop;

  elsif old.estado = 'cancelado' and new.estado <> 'cancelado' then
    for v_linea in select producto_id, cantidad from public.pedido_items where pedido_id = old.id order by id loop
      begin
        v_id := v_linea.producto_id::uuid;
        v_qty := coalesce(v_linea.cantidad, 0);
        update public.productos
        set stock = stock - v_qty,
            disponible = (stock - v_qty) > 0
        where id = v_id;
      exception
        when invalid_text_representation then null;
        when check_violation then
          raise exception 'No hay stock suficiente para reactivar este pedido cancelado.';
      end;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists pedidos_ajustar_stock on public.pedidos;
create trigger pedidos_ajustar_stock
  after update of estado on public.pedidos
  for each row execute function public.ajustar_stock_por_estado();


-- 4d) Seguimiento del pedido (cliente con código + teléfono) -----------
create or replace function public.ver_pedido(p_codigo text, p_telefono text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v record;
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
  v_tiempo text;
  v_min integer;
  v_segs integer;
begin
  if length(v_cod) < 4 or length(v_tel) < 7 then
    return null;
  end if;

  select p.id, p.codigo_pedido, p.estado, p.creado_en, p.editado_en, p.cancelado_por_cliente,
         e.tipo_entrega, e.direccion, e.notas,
         g.metodo_pago, g.total
    into v
  from public.pedidos p
  join public.pedido_clientes c on c.pedido_id = p.id
  join public.pedido_entregas e on e.pedido_id = p.id
  join public.pedido_pagos    g on g.pedido_id = p.id
  where p.codigo_pedido = v_cod and c.telefono = v_tel;

  if not found then
    return null;
  end if;

  select coalesce(tiempo_estimado, ''), coalesce(minutos_edicion, 10)
    into v_tiempo, v_min
  from public.config_tienda where id = 1;
  v_min := coalesce(v_min, 10);

  v_segs := greatest(0, floor(extract(epoch from
              (v.creado_en + make_interval(mins => v_min) - now())))::integer);

  return jsonb_build_object(
    'codigo', v.codigo_pedido,
    'estado', v.estado,
    'tipo_entrega', v.tipo_entrega,
    'metodo_pago', v.metodo_pago,
    'total', v.total,
    'creado_en', v.creado_en,
    'editado_en', v.editado_en,
    'cancelado_por_cliente', v.cancelado_por_cliente,
    'direccion', coalesce(v.direccion, ''),
    'notas', coalesce(v.notas, ''),
    'tiempo_estimado', coalesce(v_tiempo, ''),
    'minutos_edicion', v_min,
    'segundos_restantes', v_segs,
    'editable', (v.estado = 'pendiente_pago' and v_min > 0 and v_segs > 0),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'producto_id', i.producto_id,
        'nombre_producto', i.nombre_producto,
        'cantidad', i.cantidad,
        'tamano_etiqueta', i.tamano_etiqueta,
        'presa', i.presa,
        'presa_etiqueta', case i.presa
                            when 'pecho' then 'Pecho' when 'contra' then 'Contra'
                            when 'ala' then 'Ala' when 'pierna' then 'Pierna'
                            else 'Sin preferencia' end,
        'acompanante', i.acompanante,
        'precio_unitario', i.precio_unitario
      ) order by i.id), '[]'::jsonb)
      from public.pedido_items i where i.pedido_id = v.id
    )
  );
end;
$$;

revoke all on function public.ver_pedido(text, text) from public;
grant execute on function public.ver_pedido(text, text) to anon, authenticated;


-- 4e) Editar el pedido (el cliente, durante unos minutos) --------------
create or replace function public.editar_pedido(
  p_codigo text,
  p_telefono text,
  p_tipo_entrega text,
  p_direccion text,
  p_notas text,
  p_metodo_pago text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel       text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_cod       text := upper(btrim(coalesce(p_codigo, '')));
  v_direccion text := nullif(btrim(coalesce(p_direccion, '')), '');
  v_notas     text := nullif(left(btrim(coalesce(p_notas, '')), 160), '');
  v_ped       public.pedidos%rowtype;
  v_envio     numeric(10,2);
  v_min       integer;
  v_ag        record;
  v_prod      public.productos%rowtype;
  v_delta     integer;
  v_linea     jsonb;
  v_viejo     record;
  v_pid       text;
  v_qty       integer;
  v_presa     text;
  v_acomp     text;
  v_items     jsonb := '[]'::jsonb;
  v_subtotal  numeric(10,2) := 0;
  v_total     numeric(10,2);
  v_ahora     timestamptz := now();
begin
  -- El pedido se identifica con código + teléfono (igual que ver_pedido)
  select p.* into v_ped
  from public.pedidos p
  join public.pedido_clientes c on c.pedido_id = p.id
  where p.codigo_pedido = v_cod and c.telefono = v_tel
  for update of p;
  if not found then
    raise exception 'NOENCONTRADO:No encontramos este pedido.';
  end if;

  select coalesce(costo_envio, 0) into v_envio from public.pedido_pagos where pedido_id = v_ped.id;
  select coalesce(minutos_edicion, 10) into v_min from public.config_tienda where id = 1;
  v_min := coalesce(v_min, 10);

  if v_ped.estado <> 'pendiente_pago' then
    raise exception 'BLOQUEADO:Tu pedido ya está en marcha y no se puede modificar. Llámanos si necesitas un cambio.';
  end if;
  if v_min <= 0 or v_ahora > v_ped.creado_en + make_interval(mins => v_min) then
    raise exception 'EXPIRADO:Se terminó el tiempo para modificar el pedido. Llámanos si necesitas un cambio.';
  end if;

  -- Validación de datos (mismas reglas que crear_pedido)
  if p_tipo_entrega not in ('delivery', 'recojo') then
    raise exception 'DATOS:Elige delivery o recojo en tienda.';
  end if;
  if p_tipo_entrega = 'delivery' and (v_direccion is null or length(v_direccion) < 8) then
    raise exception 'DATOS:Escribe una dirección válida para el delivery.';
  end if;
  if p_metodo_pago not in ('efectivo', 'qr') then
    raise exception 'DATOS:Elige una forma de pago.';
  end if;
  if p_tipo_entrega = 'recojo' then v_direccion := null; end if;
  v_direccion := left(v_direccion, 160);

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'DATOS:Deja al menos un producto en el pedido, o elimínalo.';
  end if;

  -- Stock: se compara lo que había contra lo que queda, producto por producto
  -- (orden fijo para evitar bloqueos cruzados).
  begin
    if exists (
      select 1 from jsonb_array_elements(p_items) e
      where coalesce((e->>'cantidad')::integer, 0) < 1
    ) then
      raise exception 'DATOS:Cantidad no válida en el pedido.';
    end if;

    for v_ag in
      select pid, sum(nuevo)::integer as nuevo, sum(viejo)::integer as viejo
      from (
        select (e->>'producto_id')::uuid as pid,
               least(greatest(coalesce((e->>'cantidad')::integer, 0), 0), 50) as nuevo,
               0 as viejo
        from jsonb_array_elements(p_items) e
        union all
        select o.producto_id::uuid, 0, greatest(coalesce(o.cantidad, 0), 0)
        from public.pedido_items o
        where o.pedido_id = v_ped.id
      ) t
      group by pid
      order by pid
    loop
      v_delta := v_ag.nuevo - v_ag.viejo;

      if v_delta = 0 then continue; end if;

      select * into v_prod from public.productos where id = v_ag.pid for update;

      if v_delta > 0 then
        if not found or v_prod.disponible is not true then
          raise exception 'PRODUCTO:Un producto ya no está disponible. Actualiza el menú e inténtalo de nuevo.';
        end if;
        if v_prod.stock < v_delta then
          raise exception 'STOCK:%', 'Solo quedan ' || v_prod.stock || ' más de "' || v_prod.nombre || '". Ajusta la cantidad.';
        end if;
        update public.productos
        set stock = stock - v_delta,
            disponible = (stock - v_delta) > 0
        where id = v_ag.pid;
      elsif found then
        -- v_delta < 0: devolvemos stock (y reactivamos si estaba agotado)
        update public.productos
        set disponible = case when stock = 0 then true else disponible end,
            stock = stock - v_delta
        where id = v_ag.pid;
      end if;
    end loop;
  exception
    when invalid_text_representation then
      raise exception 'PRODUCTO:Un producto del pedido no es válido. Actualiza el menú e inténtalo de nuevo.';
  end;

  -- Armamos las líneas. Si el producto ya estaba en el pedido se conserva su
  -- nombre y precio original (editar no cambia lo que ya acordaste).
  for v_linea in select * from jsonb_array_elements(p_items) loop
    v_pid := v_linea->>'producto_id';
    v_qty := least(greatest(coalesce((v_linea->>'cantidad')::integer, 1), 1), 50);

    select o.nombre_producto, o.tamano_etiqueta, o.precio_unitario into v_viejo
    from public.pedido_items o
    where o.pedido_id = v_ped.id and o.producto_id = v_pid
    order by o.id
    limit 1;

    v_presa := case when (v_linea->>'presa') in ('pecho', 'contra', 'ala', 'pierna')
                    then v_linea->>'presa' else null end;
    v_acomp := case when (v_linea->>'acompanante') in ('Soda', 'Ensalada', 'Sin acompañante')
                    then v_linea->>'acompanante' else null end;

    if v_viejo.nombre_producto is not null then
      v_items := v_items || jsonb_build_object(
        'producto_id', v_pid,
        'nombre_producto', v_viejo.nombre_producto,
        'tamano_etiqueta', v_viejo.tamano_etiqueta,
        'presa', v_presa,
        'acompanante', v_acomp,
        'precio_unitario', v_viejo.precio_unitario,
        'cantidad', v_qty
      );
      v_subtotal := v_subtotal + (v_viejo.precio_unitario * v_qty);
    else
      select * into v_prod from public.productos where id = v_pid::uuid;
      if not found then
        raise exception 'PRODUCTO:Un producto ya no está disponible. Actualiza el menú e inténtalo de nuevo.';
      end if;
      v_items := v_items || jsonb_build_object(
        'producto_id', v_pid,
        'nombre_producto', v_prod.nombre,
        'tamano_etiqueta', v_prod.tamano_etiqueta,
        'presa', v_presa,
        'acompanante', v_acomp,
        'precio_unitario', v_prod.precio,
        'cantidad', v_qty
      );
      v_subtotal := v_subtotal + (v_prod.precio * v_qty);
    end if;
  end loop;

  v_total := v_subtotal + coalesce(v_envio, 0);

  update public.pedidos set editado_en = v_ahora where id = v_ped.id;

  update public.pedido_entregas
  set tipo_entrega = p_tipo_entrega, direccion = v_direccion, notas = v_notas
  where pedido_id = v_ped.id;

  update public.pedido_pagos
  set metodo_pago = p_metodo_pago, subtotal = v_subtotal, total = v_total
  where pedido_id = v_ped.id;

  delete from public.pedido_items where pedido_id = v_ped.id;
  insert into public.pedido_items (pedido_id, producto_id, nombre_producto, tamano_etiqueta,
                                   presa, acompanante, precio_unitario, cantidad)
  select v_ped.id, i.e->>'producto_id', i.e->>'nombre_producto', i.e->>'tamano_etiqueta',
         i.e->>'presa', i.e->>'acompanante', (i.e->>'precio_unitario')::numeric, (i.e->>'cantidad')::integer
  from jsonb_array_elements(v_items) with ordinality as i(e, n)
  order by i.n;

  return jsonb_build_object('codigo', v_ped.codigo_pedido, 'total', v_total, 'editado_en', v_ahora);
end;
$$;

revoke all on function public.editar_pedido(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.editar_pedido(text, text, text, text, text, text, jsonb)
  to anon, authenticated;


-- 4f) Eliminar (cancelar) el pedido por el cliente ----------------------
-- El trigger pedidos_ajustar_stock devuelve el stock al pasar a "cancelado".
create or replace function public.cancelar_pedido_cliente(p_codigo text, p_telefono text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_cod text := upper(btrim(coalesce(p_codigo, '')));
  v_ped public.pedidos%rowtype;
  v_min integer;
begin
  select p.* into v_ped
  from public.pedidos p
  join public.pedido_clientes c on c.pedido_id = p.id
  where p.codigo_pedido = v_cod and c.telefono = v_tel
  for update of p;
  if not found then
    raise exception 'NOENCONTRADO:No encontramos este pedido.';
  end if;

  select coalesce(minutos_edicion, 10) into v_min from public.config_tienda where id = 1;
  v_min := coalesce(v_min, 10);

  if v_ped.estado = 'cancelado' then
    return jsonb_build_object('codigo', v_ped.codigo_pedido, 'cancelado', true);
  end if;
  if v_ped.estado <> 'pendiente_pago' then
    raise exception 'BLOQUEADO:Tu pedido ya está en marcha y no se puede eliminar. Llámanos si necesitas ayuda.';
  end if;
  if v_min <= 0 or now() > v_ped.creado_en + make_interval(mins => v_min) then
    raise exception 'EXPIRADO:Se terminó el tiempo para eliminar el pedido. Llámanos si necesitas ayuda.';
  end if;

  update public.pedidos
  set estado = 'cancelado',
      cancelado_por_cliente = true
  where id = v_ped.id;

  return jsonb_build_object('codigo', v_ped.codigo_pedido, 'cancelado', true);
end;
$$;

revoke all on function public.cancelar_pedido_cliente(text, text) from public;
grant execute on function public.cancelar_pedido_cliente(text, text) to anon, authenticated;


-- 4g) Guardar la configuración (solo administrador) ---------------------
-- Recibe un JSON con los campos que cambian (cualquier combinación) y los
-- reparte en las tablas config_*. Devuelve la configuración completa.
create or replace function public.guardar_configuracion(p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia text;
  v_h   jsonb;
begin
  if not public.es_administrador() then
    raise exception 'PERMISO:Solo el administrador puede guardar la configuración.';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'DATOS:No llegaron datos para guardar.';
  end if;

  -- Filas únicas (por si alguna se borró a mano)
  insert into public.config_negocio  (id) values (1) on conflict (id) do nothing;
  insert into public.config_marca    (id) values (1) on conflict (id) do nothing;
  insert into public.config_imagenes (id) values (1) on conflict (id) do nothing;
  insert into public.config_tienda   (id) values (1) on conflict (id) do nothing;
  insert into public.config_horarios (dia)
    select unnest(array['dom','lun','mar','mie','jue','vie','sab']) on conflict (dia) do nothing;

  update public.config_negocio set
    negocio_nombre = coalesce(p_datos->>'negocio_nombre', negocio_nombre),
    telefono       = coalesce(p_datos->>'telefono', telefono),
    direccion      = coalesce(p_datos->>'direccion', direccion),
    mapa_url       = coalesce(p_datos->>'mapa_url', mapa_url),
    texto_delivery = coalesce(p_datos->>'texto_delivery', texto_delivery)
  where id = 1;

  update public.config_marca set
    eslogan          = coalesce(p_datos->>'eslogan', eslogan),
    color_primario   = coalesce(p_datos->>'color_primario', color_primario),
    color_secundario = coalesce(p_datos->>'color_secundario', color_secundario),
    color_oscuro     = coalesce(p_datos->>'color_oscuro', color_oscuro),
    color_fondo      = coalesce(p_datos->>'color_fondo', color_fondo)
  where id = 1;

  -- Imágenes: enviar null borra el valor (ej. restaurar el logo original)
  update public.config_imagenes set
    logo_url    = case when p_datos ? 'logo_url' then nullif(p_datos->>'logo_url', '') else logo_url end,
    logo_oculto = coalesce((p_datos->>'logo_oculto')::boolean, logo_oculto),
    hero_url    = case when p_datos ? 'hero_url' then nullif(p_datos->>'hero_url', '') else hero_url end,
    qr_url      = case when p_datos ? 'qr_url'   then nullif(p_datos->>'qr_url', '')   else qr_url   end
  where id = 1;

  update public.config_tienda set
    tienda_pausada  = coalesce((p_datos->>'tienda_pausada')::boolean, tienda_pausada),
    mensaje_cierre  = coalesce(p_datos->>'mensaje_cierre', mensaje_cierre),
    tiempo_estimado = coalesce(p_datos->>'tiempo_estimado', tiempo_estimado),
    minutos_edicion = coalesce((p_datos->>'minutos_edicion')::integer, minutos_edicion),
    zona_horaria    = coalesce(nullif(p_datos->>'zona_horaria', ''), zona_horaria)
  where id = 1;

  -- Horarios: un objeto {lun:{abierto,desde,hasta},...} los activa; null los desactiva
  if p_datos ? 'horarios' then
    if jsonb_typeof(p_datos->'horarios') = 'object' then
      update public.config_tienda set usar_horarios = true where id = 1;
      foreach v_dia in array array['dom','lun','mar','mie','jue','vie','sab'] loop
        v_h := p_datos->'horarios'->v_dia;
        if v_h is not null and jsonb_typeof(v_h) = 'object' then
          update public.config_horarios set
            abierto = coalesce((v_h->>'abierto')::boolean, abierto),
            desde   = coalesce(nullif(v_h->>'desde', '')::time, desde),
            hasta   = coalesce(nullif(v_h->>'hasta', '')::time, hasta)
          where dia = v_dia;
        end if;
      end loop;
    else
      update public.config_tienda set usar_horarios = false where id = 1;
    end if;
  end if;

  return (select to_jsonb(c) from public.configuracion_completa c);
end;
$$;

revoke all on function public.guardar_configuracion(jsonb) from public;
grant execute on function public.guardar_configuracion(jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 5) VISTAS "COMPLETAS" (solo lectura; respetan los permisos del usuario)
-- ---------------------------------------------------------------------
create or replace view public.configuracion_completa
with (security_invoker = true) as
select
  1 as id,
  n.negocio_nombre, n.telefono, n.texto_delivery, n.direccion, n.mapa_url,
  m.eslogan, m.color_primario, m.color_secundario, m.color_oscuro, m.color_fondo,
  i.logo_url, i.logo_oculto, i.hero_url, i.qr_url,
  t.tienda_pausada, t.mensaje_cierre, t.tiempo_estimado, t.minutos_edicion,
  t.zona_horaria, t.usar_horarios,
  case when t.usar_horarios then (
    select jsonb_object_agg(h.dia, jsonb_build_object(
             'abierto', h.abierto,
             'desde', to_char(h.desde, 'HH24:MI'),
             'hasta', to_char(h.hasta, 'HH24:MI')))
    from public.config_horarios h
  ) else null end as horarios
from public.config_negocio n
cross join public.config_marca m
cross join public.config_imagenes i
cross join public.config_tienda t;

create or replace view public.pedidos_completos
with (security_invoker = true) as
select
  p.id, p.codigo_pedido, p.usuario_id, p.estado, p.creado_en, p.editado_en, p.cancelado_por_cliente,
  c.nombre_cliente, c.telefono, c.correo,
  e.tipo_entrega, e.direccion, e.notas,
  g.metodo_pago, g.subtotal, g.costo_envio, g.total,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'producto_id', i.producto_id,
      'nombre_producto', i.nombre_producto,
      'cantidad', i.cantidad,
      'tamano_etiqueta', i.tamano_etiqueta,
      'presa', i.presa,
      'presa_etiqueta', case i.presa
                          when 'pecho' then 'Pecho' when 'contra' then 'Contra'
                          when 'ala' then 'Ala' when 'pierna' then 'Pierna'
                          else 'Sin preferencia' end,
      'acompanante', i.acompanante,
      'precio_unitario', i.precio_unitario
    ) order by i.id)
    from public.pedido_items i where i.pedido_id = p.id
  ), '[]'::jsonb) as items
from public.pedidos p
left join public.pedido_clientes c on c.pedido_id = p.id
left join public.pedido_entregas e on e.pedido_id = p.id
left join public.pedido_pagos    g on g.pedido_id = p.id;


-- ---------------------------------------------------------------------
-- 6) PERMISOS (RLS)
-- ---------------------------------------------------------------------
-- Configuración: todos LEEN (la tienda la necesita); solo el administrador escribe.
do $$
declare t text;
begin
  foreach t in array array['config_negocio','config_marca','config_imagenes','config_tienda','config_horarios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_publica', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_publica', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (public.es_administrador()) with check (public.es_administrador())', t || '_admin', t);
  end loop;
end $$;

-- Tablas hijas de pedidos: las ve el administrador y el dueño del pedido
-- (se apoyan en la política de "pedidos"). Nadie las escribe directo:
-- solo las funciones crear_pedido(), editar_pedido() y cancelar_pedido_cliente().
do $$
declare t text;
begin
  foreach t in array array['pedido_clientes','pedido_entregas','pedido_pagos','pedido_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.pedidos p where p.id = pedido_id))', t || '_ver', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select on public.configuracion_completa to anon, authenticated;
grant select on public.pedidos_completos      to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7) LIMPIEZA: quitar de las tablas viejas lo que ya se movió
-- ---------------------------------------------------------------------
-- (La copia completa de lo anterior queda en el esquema respaldo_v1.)
alter table public.pedidos
  drop column if exists nombre_cliente,
  drop column if exists telefono,
  drop column if exists correo,
  drop column if exists tipo_entrega,
  drop column if exists direccion,
  drop column if exists notas,
  drop column if exists items,
  drop column if exists subtotal,
  drop column if exists costo_envio,
  drop column if exists total,
  drop column if exists metodo_pago;

drop table if exists public.configuracion;

-- Filas únicas por defecto (instalación nueva sin datos)
insert into public.config_negocio  (id) values (1) on conflict (id) do nothing;
insert into public.config_marca    (id) values (1) on conflict (id) do nothing;
insert into public.config_imagenes (id) values (1) on conflict (id) do nothing;
insert into public.config_tienda   (id) values (1) on conflict (id) do nothing;
insert into public.config_horarios (dia)
  select unnest(array['dom','lun','mar','mie','jue','vie','sab']) on conflict (dia) do nothing;

-- Realtime sigue en "pedidos" (el panel recibe el aviso y luego lee el pedido completo)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos'
     ) then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end $$;

-- Que la API de Supabase vea las tablas y vistas nuevas de inmediato
notify pgrst, 'reload schema';

-- =====================================================================
-- POLLOS SABROSON · EDITAR Y ELIMINAR EL PEDIDO (por el cliente)
--
-- Qué hace:
--   1) El cliente puede EDITAR (cantidades, quitar productos, tipo de
--      entrega, dirección, notas y forma de pago) o ELIMINAR su pedido
--      durante un lapso de tiempo (por defecto 10 minutos desde que lo
--      hizo) y mientras la cocina no lo haya empezado (estado
--      "pendiente_pago").
--   2) El lapso se cambia en Admin > Ajustes (0 = no se puede editar).
--   3) Todo se valida en el SERVIDOR: precios, total, stock y tiempo.
--      El stock se ajusta solo (si baja una cantidad o se elimina el
--      pedido, el stock vuelve; si sube, se descuenta).
--   4) "Eliminar" = cancelar por el cliente: el pedido queda guardado
--      como cancelado (el administrador lo ve marcado "Eliminado por el
--      cliente" y NO cuenta como venta). No se pierde el historial.
--   5) ver_pedido() ahora devuelve la fecha y hora, si todavía se puede
--      editar y cuántos segundos quedan.
--
-- Ejecutar en Supabase > SQL Editor > New query > Run.
-- Requiere haber ejecutado antes migracion_pedidos_seguros.sql,
-- migracion_fase2.sql y migracion_fase3.sql.
-- Es seguro ejecutarlo varias veces y NO borra datos.
-- =====================================================================

-- 1) Columnas nuevas --------------------------------------------------
alter table public.configuracion
  add column if not exists minutos_edicion integer not null default 10;

alter table public.configuracion drop constraint if exists configuracion_minutos_edicion_check;
alter table public.configuracion add constraint configuracion_minutos_edicion_check
  check (minutos_edicion between 0 and 120);

insert into public.configuracion (id) values (1) on conflict (id) do nothing;

alter table public.pedidos
  add column if not exists editado_en timestamptz,
  add column if not exists cancelado_por_cliente boolean not null default false;

-- 2) Seguimiento del pedido (ahora con fecha, edición y tiempo restante) -
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

  select codigo_pedido, estado, tipo_entrega, metodo_pago, total, creado_en, items,
         direccion, notas, editado_en, cancelado_por_cliente
    into v
  from public.pedidos
  where codigo_pedido = v_cod and telefono = v_tel;

  if not found then
    return null;
  end if;

  select coalesce(tiempo_estimado, ''), coalesce(minutos_edicion, 10)
    into v_tiempo, v_min
  from public.configuracion where id = 1;
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
        'producto_id', i->>'producto_id',
        'nombre_producto', i->>'nombre_producto',
        'cantidad', i->'cantidad',
        'tamano_etiqueta', i->>'tamano_etiqueta',
        'presa', i->>'presa',
        'presa_etiqueta', i->>'presa_etiqueta',
        'acompanante', i->>'acompanante',
        'precio_unitario', i->'precio_unitario'
      )), '[]'::jsonb)
      from jsonb_array_elements(v.items) i
    )
  );
end;
$$;

revoke all on function public.ver_pedido(text, text) from public;
grant execute on function public.ver_pedido(text, text) to anon, authenticated;

-- 3) Editar el pedido -------------------------------------------------
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
  v_min       integer;
  v_ag        record;
  v_prod      public.productos%rowtype;
  v_delta     integer;
  v_linea     jsonb;
  v_viejo     jsonb;
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
  select * into v_ped from public.pedidos
  where codigo_pedido = v_cod and telefono = v_tel
  for update;
  if not found then
    raise exception 'NOENCONTRADO:No encontramos este pedido.';
  end if;

  select coalesce(minutos_edicion, 10) into v_min from public.configuracion where id = 1;
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
        select (o->>'producto_id')::uuid, 0, greatest(coalesce((o->>'cantidad')::integer, 0), 0)
        from jsonb_array_elements(v_ped.items) o
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

    select o into v_viejo
    from jsonb_array_elements(v_ped.items) o
    where o->>'producto_id' = v_pid
    limit 1;

    v_presa := case when (v_linea->>'presa') in ('pecho', 'contra', 'ala', 'pierna')
                    then v_linea->>'presa' else null end;
    v_acomp := case when (v_linea->>'acompanante') in ('Soda', 'Ensalada', 'Sin acompañante')
                    then v_linea->>'acompanante' else null end;

    if v_viejo is not null then
      v_items := v_items || jsonb_build_object(
        'producto_id', v_pid,
        'nombre_producto', v_viejo->>'nombre_producto',
        'tamano_etiqueta', v_viejo->>'tamano_etiqueta',
        'presa', v_presa,
        'presa_etiqueta', case v_presa
                            when 'pecho' then 'Pecho' when 'contra' then 'Contra'
                            when 'ala' then 'Ala' when 'pierna' then 'Pierna'
                            else 'Sin preferencia' end,
        'acompanante', v_acomp,
        'precio_unitario', (v_viejo->>'precio_unitario')::numeric,
        'cantidad', v_qty
      );
      v_subtotal := v_subtotal + ((v_viejo->>'precio_unitario')::numeric * v_qty);
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
        'presa_etiqueta', case v_presa
                            when 'pecho' then 'Pecho' when 'contra' then 'Contra'
                            when 'ala' then 'Ala' when 'pierna' then 'Pierna'
                            else 'Sin preferencia' end,
        'acompanante', v_acomp,
        'precio_unitario', v_prod.precio,
        'cantidad', v_qty
      );
      v_subtotal := v_subtotal + (v_prod.precio * v_qty);
    end if;
  end loop;

  v_total := v_subtotal + coalesce(v_ped.costo_envio, 0);

  update public.pedidos
  set tipo_entrega = p_tipo_entrega,
      direccion    = v_direccion,
      notas        = v_notas,
      metodo_pago  = p_metodo_pago,
      items        = v_items,
      subtotal     = v_subtotal,
      total        = v_total,
      editado_en   = v_ahora
  where id = v_ped.id;

  return jsonb_build_object('codigo', v_ped.codigo_pedido, 'total', v_total, 'editado_en', v_ahora);
end;
$$;

revoke all on function public.editar_pedido(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.editar_pedido(text, text, text, text, text, text, jsonb)
  to anon, authenticated;

-- 4) Eliminar (cancelar) el pedido -------------------------------------
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
  select * into v_ped from public.pedidos
  where codigo_pedido = v_cod and telefono = v_tel
  for update;
  if not found then
    raise exception 'NOENCONTRADO:No encontramos este pedido.';
  end if;

  select coalesce(minutos_edicion, 10) into v_min from public.configuracion where id = 1;
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

-- 5) El administrador ve las ediciones en tiempo real (UPDATE) ----------
-- (el INSERT ya estaba activo desde migracion_fase2.sql)
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

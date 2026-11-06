-- =====================================================================
-- POLLOS SABROSON · PEDIDOS SEGUROS
-- Ejecutar en Supabase > SQL Editor > New query > Run.
-- Es seguro ejecutarlo varias veces y NO borra pedidos existentes.
--
-- Qué hace:
--   1) Los precios, el total y el estado los decide el SERVIDOR, no el
--      navegador. El cliente solo envía producto + cantidad.
--   2) Descuenta el stock dentro de la misma transacción (sin vender de más
--      aunque dos personas pidan a la vez) y devuelve el stock si el pedido
--      se cancela.
--   3) Código de pedido único generado en la base (PS-100001, PS-100002...).
--   4) Evita pedidos duplicados por doble clic o reintento de red
--      (clave de idempotencia).
--   5) Límite anti-spam: máximo 5 pedidos por teléfono por hora.
--   6) Cierra el INSERT público directo sobre la tabla pedidos.
-- =====================================================================

-- 1) Columnas y secuencia -------------------------------------------------
alter table public.pedidos add column if not exists clave_idempotencia text;
create unique index if not exists pedidos_clave_idempotencia_uidx
  on public.pedidos (clave_idempotencia) where clave_idempotencia is not null;
create index if not exists pedidos_telefono_creado_idx
  on public.pedidos (telefono, creado_en desc);

create sequence if not exists public.pedidos_codigo_seq start with 100001;

-- 2) Reglas de datos que antes solo validaba el navegador -----------------
alter table public.pedidos drop constraint if exists pedidos_direccion_delivery_check;
alter table public.pedidos add constraint pedidos_direccion_delivery_check
  check (tipo_entrega <> 'delivery' or length(btrim(coalesce(direccion, ''))) >= 8) not valid;

alter table public.pedidos drop constraint if exists pedidos_telefono_check;
alter table public.pedidos add constraint pedidos_telefono_check
  check (telefono ~ '^[0-9]{7,15}$') not valid;
-- "not valid": protege los pedidos nuevos sin fallar por pedidos viejos.

-- 3) Función principal: crear_pedido -------------------------------------
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
    select id, codigo_pedido, total into v_existente
    from public.pedidos where clave_idempotencia = v_clave;
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
  from public.pedidos
  where telefono = v_telefono and creado_en > now() - interval '1 hour';
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
      'presa_etiqueta', case v_presa
                          when 'pecho' then 'Pecho' when 'contra' then 'Contra'
                          when 'ala' then 'Ala' when 'pierna' then 'Pierna'
                          else 'Sin preferencia' end,
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

  insert into public.pedidos (
    codigo_pedido, usuario_id, nombre_cliente, telefono, correo, tipo_entrega,
    direccion, notas, items, subtotal, costo_envio, total, metodo_pago, estado,
    clave_idempotencia
  ) values (
    v_codigo, v_uid, v_nombre, v_telefono, v_correo, p_tipo_entrega,
    v_direccion, v_notas, v_items, v_subtotal, 0, v_subtotal, p_metodo_pago,
    'pendiente_pago', v_clave
  ) returning id into v_pedido_id;

  return jsonb_build_object('codigo', v_codigo, 'total', v_subtotal, 'repetido', false);
end;
$$;

revoke all on function public.crear_pedido(text, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.crear_pedido(text, text, text, text, text, text, jsonb, text)
  to anon, authenticated;

-- 4) Stock: devolver al cancelar y volver a descontar si se reactiva ------
create or replace function public.ajustar_stock_por_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linea jsonb;
  v_id uuid;
  v_qty integer;
begin
  if new.estado = old.estado then
    return new;
  end if;

  if new.estado = 'cancelado' and old.estado <> 'cancelado' then
    for v_linea in select * from jsonb_array_elements(old.items) loop
      begin
        v_id := (v_linea->>'producto_id')::uuid;
        v_qty := coalesce((v_linea->>'cantidad')::integer, 0);
        update public.productos
        set disponible = case when stock = 0 and v_qty > 0 then true else disponible end,
            stock = stock + v_qty
        where id = v_id;
      exception when invalid_text_representation then
        null; -- pedidos antiguos con ids que no son UUID: no hay stock que devolver
      end;
    end loop;

  elsif old.estado = 'cancelado' and new.estado <> 'cancelado' then
    for v_linea in select * from jsonb_array_elements(old.items) loop
      begin
        v_id := (v_linea->>'producto_id')::uuid;
        v_qty := coalesce((v_linea->>'cantidad')::integer, 0);
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

-- 5) Cerrar el INSERT directo: ahora solo se puede crear con crear_pedido()
drop policy if exists pedidos_crear_publico on public.pedidos;
revoke insert on public.pedidos from anon, authenticated;

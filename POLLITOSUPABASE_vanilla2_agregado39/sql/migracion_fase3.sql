-- =====================================================================
-- POLLOS SABROSON · FASE 3
--   1) Categoría "Bebidas" (para vender bebidas desde el carrito)
--   2) Seguimiento del pedido para el cliente (función ver_pedido)
--   3) Tiempo estimado de entrega, editable desde el panel
--
-- Ejecutar en Supabase > SQL Editor > New query > Run.
-- Requiere haber ejecutado antes migracion_pedidos_seguros.sql y
-- migracion_fase2.sql. Es seguro ejecutarlo varias veces y NO borra datos.
-- =====================================================================

-- 1) Categoría "bebida" ---------------------------------------------------
alter table public.productos drop constraint if exists productos_categoria_check;
alter table public.productos drop constraint if exists productos_categoria_valida;
alter table public.productos drop constraint if exists productos_categoria_exacta_check;
alter table public.productos add constraint productos_categoria_exacta_check
  check (categoria in ('brasa', 'broaster', 'lomito', 'hamburguesa', 'bebida'));

-- Bebidas de ejemplo. LOS PRECIOS SON DE REFERENCIA: ajústalos en
-- Admin > Productos (o bórralos / ocúltalos si no vendes bebidas).
insert into public.productos (categoria, tamano_clave, tamano_etiqueta, nombre, descripcion, precio, imagen_url, etiqueta)
select * from (values
  ('bebida', 'personal', 'Personal 500 ml', 'Gaseosa personal',
   'Bien fría, ideal para acompañar tu pedido.', 8.00, '/assets/products/bebida.svg', null),
  ('bebida', '2-litros', '2 litros', 'Gaseosa 2 litros',
   'Para compartir en familia.', 18.00, '/assets/products/bebida.svg', null),
  ('bebida', 'vaso', 'Vaso', 'Refresco de la casa',
   'Refresco natural, preparado al día.', 6.00, '/assets/products/bebida.svg', null)
) as seed(categoria, tamano_clave, tamano_etiqueta, nombre, descripcion, precio, imagen_url, etiqueta)
where not exists (select 1 from public.productos p where lower(p.nombre) = lower(seed.nombre));

-- 2) Tiempo estimado (texto libre, por ejemplo "30 a 40 min") --------------
alter table public.configuracion add column if not exists tiempo_estimado text not null default '';

-- 3) Seguimiento del pedido -----------------------------------------------
-- El cliente consulta con SU código y SU teléfono (no hace falta cuenta).
-- Solo devuelve datos del pedido; nunca nombre, teléfono ni dirección.
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
begin
  if length(v_cod) < 4 or length(v_tel) < 7 then
    return null;
  end if;

  select codigo_pedido, estado, tipo_entrega, metodo_pago, total, creado_en, items
    into v
  from public.pedidos
  where codigo_pedido = v_cod and telefono = v_tel;

  if not found then
    return null;
  end if;

  select coalesce(tiempo_estimado, '') into v_tiempo from public.configuracion where id = 1;

  return jsonb_build_object(
    'codigo', v.codigo_pedido,
    'estado', v.estado,
    'tipo_entrega', v.tipo_entrega,
    'metodo_pago', v.metodo_pago,
    'total', v.total,
    'creado_en', v.creado_en,
    'tiempo_estimado', coalesce(v_tiempo, ''),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'nombre_producto', i->>'nombre_producto',
        'cantidad', i->'cantidad',
        'tamano_etiqueta', i->>'tamano_etiqueta',
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

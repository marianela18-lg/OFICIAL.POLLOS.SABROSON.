-- =========================================================
-- Pollos Sabroson — migracion_marca_colores.sql
--
-- Agrega a la tabla "configuracion" los campos de marca:
--   eslogan            -> titulo grande de la portada
--   color_primario     -> color principal (botones, acentos)
--   color_secundario   -> color secundario (etiquetas, detalles)
--   color_oscuro       -> color oscuro (textos, franjas, footer)
--
-- Cómo ejecutarlo: pega este archivo completo en el SQL Editor
-- de Supabase y presiona "Run".
-- =========================================================

alter table public.configuracion
  add column if not exists eslogan text not null default 'El sabor que|une a la familia.',
  add column if not exists color_primario text not null default '#e65636',
  add column if not exists color_secundario text not null default '#e9ab35',
  add column if not exists color_oscuro text not null default '#28241f';

-- Asegura que exista la fila única de configuración (id = 1).
insert into public.configuracion (id)
values (1)
on conflict (id) do nothing;

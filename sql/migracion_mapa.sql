-- =========================================================
-- Pollos Sabroson — migracion_mapa.sql
--
-- Agrega a la tabla "configuracion" el campo "mapa_url", para
-- que desde Admin > Ajustes se pueda pegar un link de Google
-- Maps y ese mapa aparezca en la sección "Ubicación" del sitio.
--
-- Cómo ejecutarlo: pega este archivo completo en el SQL Editor
-- de Supabase y presiona "Run".
-- =========================================================

alter table public.configuracion
  add column if not exists mapa_url text not null default '';

-- Asegura que exista la fila única de configuración (id = 1).
insert into public.configuracion (id)
values (1)
on conflict (id) do nothing;

-- =========================================================
-- Pollos Sabroson — migracion_color_fondo.sql
--
-- Agrega el campo "color_fondo" a la tabla "configuracion"
-- para que desde Admin > Ajustes se pueda cambiar el color
-- de fondo del sitio (además de los colores principal,
-- secundario y oscuro que ya existían).
--
-- Cómo ejecutarlo: pega este archivo completo en el SQL Editor
-- de Supabase y presiona "Run".
-- =========================================================

alter table public.configuracion
  add column if not exists color_fondo text not null default '#fffdfa';

insert into public.configuracion (id)
values (1)
on conflict (id) do nothing;

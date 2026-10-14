-- Agrega la portada editable del Inicio.
alter table public.configuracion add column if not exists hero_url text;
-- La política configuracion_admin de migracion_rls.sql permite al administrador guardar hero_url.

-- =====================================================================
-- POLLOS SABROSON · LOGO DE LA PORTADA EDITABLE
--
-- Permite al administrador cambiar, quitar o restaurar el logo que se
-- ve grande en el inicio (Admin > Ajustes > Logo de la portada).
--   logo_url    : dirección del logo subido (null = logo original del sitio)
--   logo_oculto : true = no se muestra ningún logo en la portada
--
-- Ejecutar en Supabase > SQL Editor > New query > Run.
-- Requiere haber ejecutado migracion_ajustes_todo.sql y migracion_storage.sql
-- (las imágenes se guardan en el bucket "productos").
-- Es seguro ejecutarlo varias veces y NO borra datos.
-- =====================================================================
alter table public.configuracion
  add column if not exists logo_url text,
  add column if not exists logo_oculto boolean not null default false;

insert into public.configuracion (id) values (1) on conflict (id) do nothing;
-- Los permisos ya existen: todos leen la configuración y solo el administrador la guarda.

-- =========================================================
-- Pollos Sabroson — migracion_ajustes_negocio.sql
--
-- Agrega a la tabla "configuracion" los campos que se editan
-- en Admin > Ajustes (nombre del negocio, teléfono, texto de
-- delivery y dirección), para que el botón "Guardar cambios"
-- tenga dónde guardar la información.
--
-- Cómo ejecutarlo: pega este archivo completo en el SQL Editor
-- de Supabase y presiona "Run".
-- =========================================================

alter table public.configuracion
  add column if not exists negocio_nombre text not null default 'Pollos Sabroson',
  add column if not exists telefono text not null default '70000000',
  add column if not exists texto_delivery text not null default 'Coordinamos la entrega en tu dirección',
  add column if not exists direccion text not null default 'Av. Principal 123, Zona Centro';

-- Asegura que exista la fila única de configuración (id = 1).
insert into public.configuracion (id)
values (1)
on conflict (id) do nothing;

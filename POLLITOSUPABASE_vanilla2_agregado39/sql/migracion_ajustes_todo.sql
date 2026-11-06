-- =========================================================
-- Pollos Sabroson — migracion_ajustes_todo.sql
--
-- TODO lo que necesita Admin > Ajustes en un solo archivo
-- (reemplaza correr por separado migracion_ajustes_negocio,
-- migracion_marca_colores, migracion_color_fondo y migracion_mapa).
-- Se puede ejecutar varias veces sin problema.
--
-- Cómo ejecutarlo: pega este archivo completo en el SQL Editor
-- de Supabase y presiona "Run".
-- =========================================================

alter table public.configuracion
  add column if not exists negocio_nombre   text not null default 'Pollos Sabroson',
  add column if not exists telefono         text not null default '70000000',
  add column if not exists texto_delivery   text not null default 'Coordinamos la entrega en tu dirección',
  add column if not exists direccion        text not null default 'Av. Principal 123, Zona Centro',
  add column if not exists mapa_url         text not null default '',
  add column if not exists eslogan          text not null default 'El sabor que|une a la familia.',
  add column if not exists color_primario   text not null default '#e65636',
  add column if not exists color_secundario text not null default '#e9ab35',
  add column if not exists color_oscuro     text not null default '#28241f',
  add column if not exists color_fondo      text not null default '#fffdfa',
  add column if not exists hero_url         text,
  add column if not exists actualizado_en   timestamptz not null default now();

-- Fila única de configuración (id = 1)
insert into public.configuracion (id) values (1) on conflict (id) do nothing;

-- Permisos: todos pueden LEER la configuración (la tienda la necesita),
-- pero solo el administrador puede GUARDARLA.
alter table public.configuracion enable row level security;

drop policy if exists configuracion_publica on public.configuracion;
create policy configuracion_publica on public.configuracion
  for select using (true);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'es_administrador') then
    execute 'drop policy if exists configuracion_admin on public.configuracion';
    execute 'create policy configuracion_admin on public.configuracion
             for all using (public.es_administrador()) with check (public.es_administrador())';
  else
    raise notice 'Falta la función es_administrador(): ejecuta primero sql/migracion_rls.sql';
  end if;
end $$;

-- REPARAR "Database error saving new user"
-- Copia y pega TODO este archivo en Supabase > SQL Editor > New query > Run.
-- Es seguro ejecutarlo aunque ya hayas corrido schema.sql antes (no borra nada).

-- 1) Asegura que exista la tabla configuracion (por si tu primera ejecución
--    de schema.sql se cortó aquí antes de crear la función y el disparador).
create table if not exists public.configuracion (
  id integer primary key default 1 check (id = 1),
  qr_url text,
  hero_url text,
  actualizado_en timestamptz not null default now()
);
alter table public.configuracion add column if not exists hero_url text;
alter table public.configuracion enable row level security;
drop policy if exists configuracion_publica on public.configuracion;
create policy configuracion_publica on public.configuracion for select using (true);

-- 2) Recrea las funciones necesarias para el registro de usuarios.
create or replace function public.es_administrador()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'administrador');
$$;

create or replace function public.crear_perfil_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre_completo', new.raw_user_meta_data->>'name', ''), 'cliente')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 3) Recrea el disparador que crea el perfil automáticamente al registrarse.
--    Esto es lo que probablemente faltaba y causaba el error.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.crear_perfil_cliente();

-- 4) Red de seguridad: permite que un usuario cree su propio perfil
--    aunque el disparador fallara por algún motivo.
alter table public.perfiles enable row level security;
drop policy if exists perfiles_crear_propio on public.perfiles;
create policy perfiles_crear_propio on public.perfiles for insert with check (auth.uid() = id);

-- 5) Repara usuarios que ya se registraron pero se quedaron sin perfil
--    por culpa de este mismo error (usuarios "huérfanos").
insert into public.perfiles (id, nombre, rol)
select u.id, coalesce(u.raw_user_meta_data->>'nombre_completo', u.raw_user_meta_data->>'name', ''), 'cliente'
from auth.users u
left join public.perfiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Listo. Ahora intenta crear una cuenta nueva desde la web; debería funcionar.

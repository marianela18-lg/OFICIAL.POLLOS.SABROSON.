-- POLLOS SABROSON · INSTALACIÓN COMPLETA SUPABASE
-- Copia y pega TODO este archivo en Supabase > SQL Editor > New query > Run.
-- Incluye tablas, productos exactos, perfiles, pedidos, RLS y Storage para el QR.

create extension if not exists pgcrypto;

-- 1) Tablas principales
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  telefono text,
  rol text not null default 'cliente' check (rol in ('cliente', 'administrador')),
  creado_en timestamptz not null default now()
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  tamano_clave text,
  tamano_etiqueta text,
  nombre text not null,
  descripcion text not null default '',
  precio numeric(10,2) not null check (precio >= 0),
  imagen_url text,
  etiqueta text,
  stock integer not null default 99 check (stock >= 0),
  disponible boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Compatibilidad con proyectos que ya tenían estos campos.
alter table public.productos add column if not exists tamano_clave text;
alter table public.productos add column if not exists tamano_etiqueta text;
alter table public.productos add column if not exists stock integer not null default 99;
alter table public.productos drop constraint if exists productos_stock_check;
alter table public.productos add constraint productos_stock_check check (stock >= 0);

-- Reemplaza la restricción antigua si tu proyecto ya tenía categorías anteriores.
alter table public.productos drop constraint if exists productos_categoria_check;
alter table public.productos drop constraint if exists productos_categoria_exacta_check;
alter table public.productos drop constraint if exists productos_categoria_valida;

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  codigo_pedido text not null unique,
  usuario_id uuid references auth.users(id) on delete set null,
  nombre_cliente text not null,
  telefono text not null,
  correo text,
  tipo_entrega text not null check (tipo_entrega in ('delivery', 'recojo')),
  direccion text,
  notas text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  costo_envio numeric(10,2) not null default 0 check (costo_envio >= 0),
  total numeric(10,2) not null check (total >= 0),
  metodo_pago text not null default 'efectivo' check (metodo_pago in ('efectivo', 'qr')),
  estado text not null default 'pendiente_pago' check (estado in ('pendiente_pago','pagado','en_preparacion','en_camino','entregado','cancelado')),
  creado_en timestamptz not null default now()
);

alter table public.pedidos add column if not exists metodo_pago text not null default 'efectivo';

create table if not exists public.configuracion (
  id integer primary key default 1 check (id = 1),
  qr_url text,
  hero_url text,
  actualizado_en timestamptz not null default now()
);

alter table public.configuracion add column if not exists hero_url text;

-- 2) Deja el catálogo limpio y exacto: 4 categorías, 11 opciones.
delete from public.productos
where lower(nombre) not in (
  'pollo a la brasa económico', 'pollo a la brasa cuarto', 'pollo a la brasa entero',
  'pollo broaster económico', 'pollo broaster cuarto', 'pollo broaster medio', 'pollo broaster entero',
  'lomito con papas', 'lomito sin papas', 'hamburguesa con papas', 'hamburguesa sin papas',
  'gaseosa personal', 'gaseosa 2 litros', 'refresco de la casa'
);

alter table public.productos add constraint productos_categoria_exacta_check
  check (categoria in ('brasa', 'broaster', 'lomito', 'hamburguesa', 'bebida'));

insert into public.productos (categoria, tamano_clave, tamano_etiqueta, nombre, descripcion, precio, imagen_url, etiqueta)
select * from (values
  ('brasa', 'economico', 'Económico', 'Pollo a la brasa económico', 'La opción sabrosa y rendidora de la casa.', 28.00, '/assets/products/brasa-economico.jpg', null),
  ('brasa', 'cuarto', 'Cuarto de pollo', 'Pollo a la brasa cuarto', 'Cuarto de pollo jugoso, recién salido de la brasa.', 35.00, '/assets/products/brasa-cuarto.jpg', null),
  ('brasa', 'entero', 'Pollo entero', 'Pollo a la brasa entero', 'Nuestro pollo entero, marinado con hierbas de la casa.', 78.00, '/assets/products/brasa-entero.jpg', 'Favorito'),
  ('broaster', 'economico', 'Económico', 'Pollo broaster económico', 'Crujiente, dorado y perfecto para un antojo rápido.', 25.00, '/assets/products/broaster-economico.jpg', null),
  ('broaster', 'cuarto', 'Cuarto de pollo', 'Pollo broaster cuarto', 'Cuarto de pollo broaster con nuestro toque especial.', 32.00, '/assets/products/broaster-cuarto.jpg', null),
  ('broaster', 'medio', 'Medio pollo', 'Pollo broaster medio', 'Media porción crujiente para compartir o disfrutar solo.', 48.00, '/assets/products/broaster-medio.jpg', null),
  ('broaster', 'entero', 'Pollo entero', 'Pollo broaster entero', 'Pollo broaster entero, dorado al momento.', 82.00, '/assets/products/broaster-entero.jpg', 'Más pedido'),
  ('lomito', 'con-papas', 'Con papas', 'Lomito con papas', 'Lomito sazonado, jugoso y servido con papas doradas.', 45.00, '/assets/products/lomito-con-papas.jpg', null),
  ('lomito', 'sin-papas', 'Sin papas', 'Lomito sin papas', 'Lomito de la casa para disfrutar sin papas.', 38.00, '/assets/products/lomito-sin-papas.jpg', null),
  ('hamburguesa', 'con-papas', 'Con papas', 'Hamburguesa con papas', 'Hamburguesa sabrosa con papas doradas de la casa.', 32.00, '/assets/products/hamburguesa-con-papas.jpg', null),
  ('hamburguesa', 'sin-papas', 'Sin papas', 'Hamburguesa sin papas', 'Hamburguesa casera, preparada sin papas.', 26.00, '/assets/products/hamburguesa-sin-papas.jpg', null)
) as seed(categoria, tamano_clave, tamano_etiqueta, nombre, descripcion, precio, imagen_url, etiqueta)
where not exists (select 1 from public.productos p where lower(p.nombre) = lower(seed.nombre));

-- 3) Perfil automático al registrarse un cliente
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.crear_perfil_cliente();

-- 4) RLS
alter table public.perfiles enable row level security;
alter table public.productos enable row level security;
alter table public.pedidos enable row level security;
alter table public.configuracion enable row level security;

drop policy if exists perfiles_propios on public.perfiles;
create policy perfiles_propios on public.perfiles for select using (auth.uid() = id or public.es_administrador());

drop policy if exists productos_publicos on public.productos;
create policy productos_publicos on public.productos for select using (disponible = true or public.es_administrador());
drop policy if exists productos_admin_insert on public.productos;
create policy productos_admin_insert on public.productos for insert with check (public.es_administrador());
drop policy if exists productos_admin_update on public.productos;
create policy productos_admin_update on public.productos for update using (public.es_administrador()) with check (public.es_administrador());
drop policy if exists productos_admin_delete on public.productos;
create policy productos_admin_delete on public.productos for delete using (public.es_administrador());

-- Los pedidos ya NO se insertan directo: se crean con public.crear_pedido()
-- (ver sql/migracion_pedidos_seguros.sql).
drop policy if exists pedidos_crear_publico on public.pedidos;
drop policy if exists pedidos_propios on public.pedidos;
create policy pedidos_propios on public.pedidos for select using (public.es_administrador() or usuario_id = auth.uid());
drop policy if exists pedidos_admin_update on public.pedidos;
create policy pedidos_admin_update on public.pedidos for update using (public.es_administrador()) with check (public.es_administrador());

drop policy if exists configuracion_publica on public.configuracion;
create policy configuracion_publica on public.configuracion for select using (true);
drop policy if exists configuracion_admin on public.configuracion;
create policy configuracion_admin on public.configuracion for all using (public.es_administrador()) with check (public.es_administrador());

-- 5) Storage público para la imagen QR, administrado por usuarios administradores
insert into storage.buckets (id, name, public) values ('pagos', 'pagos', true)
on conflict (id) do update set public = true;

drop policy if exists pagos_lectura_publica on storage.objects;
create policy pagos_lectura_publica on storage.objects for select using (bucket_id = 'pagos');
drop policy if exists pagos_admin_insert on storage.objects;
create policy pagos_admin_insert on storage.objects for insert with check (bucket_id = 'pagos' and public.es_administrador());
drop policy if exists pagos_admin_update on storage.objects;
create policy pagos_admin_update on storage.objects for update using (bucket_id = 'pagos' and public.es_administrador());
drop policy if exists pagos_admin_delete on storage.objects;
create policy pagos_admin_delete on storage.objects for delete using (bucket_id = 'pagos' and public.es_administrador());

-- Fin. Después de ejecutar este archivo, crea un usuario en Authentication
-- y asígnale rol administrador ejecutando, con su UUID real:
-- update public.perfiles set rol = 'administrador' where id = 'UUID_DEL_USUARIO';

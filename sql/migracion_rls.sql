alter table public.perfiles enable row level security;
alter table public.productos enable row level security;
alter table public.pedidos enable row level security;

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


alter table public.configuracion enable row level security;
drop policy if exists configuracion_publica on public.configuracion;
create policy configuracion_publica on public.configuracion for select using (true);
drop policy if exists configuracion_admin on public.configuracion;
create policy configuracion_admin on public.configuracion for all using (public.es_administrador()) with check (public.es_administrador());

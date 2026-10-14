insert into storage.buckets (id, name, public) values ('pagos', 'pagos', true) on conflict (id) do update set public = true;

drop policy if exists pagos_lectura_publica on storage.objects;
create policy pagos_lectura_publica on storage.objects for select using (bucket_id = 'pagos');
drop policy if exists pagos_admin_insert on storage.objects;
create policy pagos_admin_insert on storage.objects for insert with check (bucket_id = 'pagos' and public.es_administrador());
drop policy if exists pagos_admin_update on storage.objects;
create policy pagos_admin_update on storage.objects for update using (bucket_id = 'pagos' and public.es_administrador());
drop policy if exists pagos_admin_delete on storage.objects;
create policy pagos_admin_delete on storage.objects for delete using (bucket_id = 'pagos' and public.es_administrador());

insert into storage.buckets (id, name, public) values ('productos', 'productos', true)
on conflict (id) do update set public = true;

drop policy if exists productos_lectura_publica on storage.objects;
create policy productos_lectura_publica on storage.objects for select using (bucket_id = 'productos');
drop policy if exists productos_admin_insert_storage on storage.objects;
create policy productos_admin_insert_storage on storage.objects for insert with check (bucket_id = 'productos' and public.es_administrador());
drop policy if exists productos_admin_update_storage on storage.objects;
create policy productos_admin_update_storage on storage.objects for update using (bucket_id = 'productos' and public.es_administrador());
drop policy if exists productos_admin_delete_storage on storage.objects;
create policy productos_admin_delete_storage on storage.objects for delete using (bucket_id = 'productos' and public.es_administrador());

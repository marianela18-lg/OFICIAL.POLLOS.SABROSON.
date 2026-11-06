-- Agrega inventario al catálogo sin borrar productos existentes.
alter table public.productos add column if not exists stock integer not null default 99;
alter table public.productos drop constraint if exists productos_stock_check;
alter table public.productos add constraint productos_stock_check check (stock >= 0);

-- Mantiene disponible sincronizado para los productos ya existentes.
update public.productos
set disponible = (stock > 0)
where disponible is distinct from (stock > 0);

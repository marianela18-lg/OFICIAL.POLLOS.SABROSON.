-- =========================================================
-- Stock inicial: 99 unidades en CADA producto.
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- (Después, el administrador cambia el stock desde el panel > Productos.)
-- Requiere haber ejecutado antes sql/migracion_stock.sql.
-- =========================================================

-- 1) Los productos que estaban agotados (stock 0) vuelven a mostrarse.
update public.productos
set disponible = true
where stock <= 0 and disponible = false;

-- 2) 99 unidades en todos los productos.
update public.productos
set stock = 99;

-- 3) Los productos nuevos que se creen sin stock también empiezan en 99.
alter table public.productos alter column stock set default 99;

-- Comprobación: debe mostrar 99 en todas las filas.
select nombre, stock, disponible from public.productos order by categoria, nombre;

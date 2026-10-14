-- Asigna una imagen individual a cada producto existente.
-- Ejecuta este archivo una vez en Supabase SQL Editor.
update public.productos set imagen_url = '/assets/products/brasa-economico.jpg' where lower(nombre) = 'pollo a la brasa económico';
update public.productos set imagen_url = '/assets/products/brasa-cuarto.jpg' where lower(nombre) = 'pollo a la brasa cuarto';
update public.productos set imagen_url = '/assets/products/brasa-entero.jpg' where lower(nombre) = 'pollo a la brasa entero';
update public.productos set imagen_url = '/assets/products/broaster-economico.jpg' where lower(nombre) = 'pollo broaster económico';
update public.productos set imagen_url = '/assets/products/broaster-cuarto.jpg' where lower(nombre) = 'pollo broaster cuarto';
update public.productos set imagen_url = '/assets/products/broaster-medio.jpg' where lower(nombre) = 'pollo broaster medio';
update public.productos set imagen_url = '/assets/products/broaster-entero.jpg' where lower(nombre) = 'pollo broaster entero';
update public.productos set imagen_url = '/assets/products/lomito-con-papas.jpg' where lower(nombre) = 'lomito con papas';
update public.productos set imagen_url = '/assets/products/lomito-sin-papas.jpg' where lower(nombre) = 'lomito sin papas';
update public.productos set imagen_url = '/assets/products/hamburguesa-con-papas.jpg' where lower(nombre) = 'hamburguesa con papas';
update public.productos set imagen_url = '/assets/products/hamburguesa-sin-papas.jpg' where lower(nombre) = 'hamburguesa sin papas';

-- Asigna las imágenes incluidas en assets/food al catálogo existente.
-- Si publicas el sitio en otra ruta, cambia /assets/ por la ruta base correspondiente.
update public.productos
set imagen_url = case categoria
  when 'brasa' then '/assets/food/pollo-brasa.jpg'
  when 'broaster' then '/assets/food/pollo-broaster.jpg'
  when 'hamburguesa' then '/assets/food/hamburguesa.jpg'
  when 'lomito' then '/assets/food/lomito.jpg'
  else imagen_url
end
where categoria in ('brasa', 'broaster', 'hamburguesa', 'lomito');

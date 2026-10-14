-- =====================================================================
-- POLLOS SABROSON · CONTABILIDAD (ingresos y egresos)
--
-- Agrega UNA tabla nueva: public.movimientos_contables
--   * No quita ni modifica ninguna tabla existente.
--   * Solo el administrador puede ver, crear, editar o borrar movimientos.
--   * Las ventas de la tienda NO se duplican aquí: el panel las toma
--     automáticamente de la tabla "pedidos" (pedidos que ya no están
--     pendientes de pago ni cancelados). Aquí se guardan los movimientos
--     MANUALES: gastos (egresos) y otros ingresos.
--
-- Ejecutar en Supabase > SQL Editor > New query > Run.
-- Requiere haber ejecutado antes schema.sql (usa public.es_administrador()).
-- Es seguro ejecutarlo varias veces y NO borra datos.
-- =====================================================================

create table if not exists public.movimientos_contables (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  concepto text not null check (length(trim(concepto)) > 0),
  categoria text not null default 'otros',
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null default 'efectivo' check (metodo_pago in ('efectivo', 'qr', 'transferencia', 'otro')),
  fecha date not null default ((now() at time zone 'America/La_Paz')::date),
  notas text,
  creado_por uuid references auth.users(id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now()
);

create index if not exists movimientos_contables_fecha_idx
  on public.movimientos_contables (fecha desc);

alter table public.movimientos_contables enable row level security;

drop policy if exists contab_admin_select on public.movimientos_contables;
create policy contab_admin_select on public.movimientos_contables
  for select using (public.es_administrador());

drop policy if exists contab_admin_insert on public.movimientos_contables;
create policy contab_admin_insert on public.movimientos_contables
  for insert with check (public.es_administrador());

drop policy if exists contab_admin_update on public.movimientos_contables;
create policy contab_admin_update on public.movimientos_contables
  for update using (public.es_administrador()) with check (public.es_administrador());

drop policy if exists contab_admin_delete on public.movimientos_contables;
create policy contab_admin_delete on public.movimientos_contables
  for delete using (public.es_administrador());

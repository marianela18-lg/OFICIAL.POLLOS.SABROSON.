-- =====================================================================
-- POLLOS SABROSON · FASE 2
--   1) Pausar la tienda + horarios de atención (abierto / cerrado)
--   2) Avisos de pedidos nuevos en tiempo real (Realtime) en el panel admin
--
-- Ejecutar en Supabase > SQL Editor > New query > Run.
-- Requiere haber ejecutado antes sql/migracion_pedidos_seguros.sql.
-- Es seguro ejecutarlo varias veces y NO borra datos.
-- =====================================================================

-- 1) Campos de configuración -------------------------------------------
alter table public.configuracion
  add column if not exists tienda_pausada boolean not null default false,
  add column if not exists mensaje_cierre text not null default '',
  add column if not exists horarios jsonb,                       -- null = sin horario (siempre abierto)
  add column if not exists zona_horaria text not null default 'America/La_Paz';

insert into public.configuracion (id) values (1) on conflict (id) do nothing;

-- Formato de "horarios" (lo escribe el panel admin > Ajustes):
--   { "lun": {"abierto": true, "desde": "11:00", "hasta": "22:00"}, "mar": {...}, ...
--     claves: dom, lun, mar, mie, jue, vie, sab
-- Si "hasta" es menor que "desde" se entiende que cierra pasada la medianoche.

-- 2) Estado de la tienda (lo calcula el servidor, con la hora de la tienda) --
create or replace function public.tienda_estado(p_ahora timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_tz text;
  v_ahora timestamp;
  v_t time;
  v_dow int;
  v_dias text[] := array['dom','lun','mar','mie','jue','vie','sab'];
  v_nombres text[] := array['el domingo','el lunes','el martes','el miércoles','el jueves','el viernes','el sábado'];
  v_hoy jsonb;
  v_ayer jsonb;
  v_d time;
  v_h time;
  v_abierta boolean := false;
  v_hasta text;
  v_proxima text;
  v_i int;
  v_cand jsonb;
  v_idx int;
begin
  select tienda_pausada, mensaje_cierre, horarios, zona_horaria into c
  from public.configuracion where id = 1;

  if not found then
    return jsonb_build_object('abierta', true);
  end if;

  if c.tienda_pausada then
    return jsonb_build_object(
      'abierta', false,
      'motivo', 'pausada',
      'mensaje', coalesce(nullif(btrim(c.mensaje_cierre), ''),
                          'Estamos tomando una pausa. Vuelve en unos minutos.')
    );
  end if;

  -- Sin horarios configurados: siempre abierto
  if c.horarios is null or jsonb_typeof(c.horarios) <> 'object' then
    return jsonb_build_object('abierta', true);
  end if;

  begin
    v_tz := coalesce(nullif(c.zona_horaria, ''), 'America/La_Paz');
    v_ahora := p_ahora at time zone v_tz;
    v_t := v_ahora::time;
    v_dow := extract(dow from v_ahora)::int;       -- 0 = domingo

    v_hoy  := c.horarios -> v_dias[v_dow + 1];
    v_ayer := c.horarios -> v_dias[((v_dow + 6) % 7) + 1];

    -- ¿Abierto por el horario de hoy?
    if v_hoy is not null and coalesce((v_hoy->>'abierto')::boolean, false) then
      v_d := (v_hoy->>'desde')::time;
      v_h := (v_hoy->>'hasta')::time;
      if v_d < v_h then
        v_abierta := v_t >= v_d and v_t < v_h;
        v_hasta := to_char(v_h, 'HH24:MI');
      else
        v_abierta := v_t >= v_d;                    -- cruza la medianoche
        v_hasta := to_char(v_h, 'HH24:MI');
      end if;
    end if;

    -- ¿Abierto por la madrugada que viene del horario de ayer?
    if not v_abierta and v_ayer is not null and coalesce((v_ayer->>'abierto')::boolean, false) then
      v_d := (v_ayer->>'desde')::time;
      v_h := (v_ayer->>'hasta')::time;
      if v_h <= v_d and v_t < v_h then
        v_abierta := true;
        v_hasta := to_char(v_h, 'HH24:MI');
      end if;
    end if;

    if v_abierta then
      return jsonb_build_object('abierta', true, 'hasta', v_hasta);
    end if;

    -- Próxima apertura
    for v_i in 0..7 loop
      v_idx := (v_dow + v_i) % 7;
      v_cand := c.horarios -> v_dias[v_idx + 1];
      if v_cand is not null and coalesce((v_cand->>'abierto')::boolean, false) then
        v_d := (v_cand->>'desde')::time;
        if v_i = 0 and v_t < v_d then
          v_proxima := 'Abrimos hoy a las ' || to_char(v_d, 'HH24:MI');
          exit;
        elsif v_i = 1 then
          v_proxima := 'Abrimos mañana a las ' || to_char(v_d, 'HH24:MI');
          exit;
        elsif v_i >= 2 then
          v_proxima := 'Abrimos ' || v_nombres[v_idx + 1] || ' a las ' || to_char(v_d, 'HH24:MI');
          exit;
        end if;
      end if;
    end loop;

    return jsonb_build_object(
      'abierta', false,
      'motivo', 'fuera_horario',
      'mensaje', 'Ahora estamos cerrados.' || coalesce(' ' || v_proxima || '.', ''),
      'proxima', v_proxima
    );
  exception when others then
    -- Si el horario guardado está mal escrito, no bloqueamos la tienda
    return jsonb_build_object('abierta', true);
  end;
end;
$$;

revoke all on function public.tienda_estado(timestamptz) from public;
grant execute on function public.tienda_estado(timestamptz) to anon, authenticated;

-- 3) Bloquear pedidos nuevos si la tienda está cerrada o pausada ----------
--    (se valida en la base: nadie puede saltarse el aviso del navegador)
create or replace function public.pedidos_verificar_tienda_abierta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb := public.tienda_estado();
begin
  if coalesce((e->>'abierta')::boolean, true) is not true then
    raise exception 'CERRADO:%', coalesce(e->>'mensaje', 'La tienda está cerrada por ahora.');
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_tienda_abierta on public.pedidos;
create trigger pedidos_tienda_abierta
  before insert on public.pedidos
  for each row execute function public.pedidos_verificar_tienda_abierta();

-- 4) Realtime: el panel admin recibe los pedidos nuevos al instante ------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos'
     ) then
    alter publication supabase_realtime add table public.pedidos;
  end if;
end $$;

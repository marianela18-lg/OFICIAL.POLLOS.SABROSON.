/* =========================================================
   Pollos Sabroson — adminPanel.js

   Panel de administración que se muestra dentro de index.html
   cuando entra una cuenta con rol "administrador".
   Secciones: Resumen, Productos, Pedidos, Clientes, Contabilidad y Ajustes.
   ========================================================= */
(function () {
  "use strict";

  var sb = window.sb;
  var D = window.PS_DATA;
  var icon = window.icon;
  var esc = function (s) {
    return window.PS_APP.esc(s);
  };

  var $ = function (sel, ctx) {
    return (ctx || document).querySelector(sel);
  };
  var $$ = function (sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  };

  /* ---------------------------------------------------------
     Estado del panel
     --------------------------------------------------------- */
  var CLAVE_TAB = "ps_admin_tab";
  var CLAVE_SCROLL = "ps_admin_scroll";
  var TABS_VALIDAS = ["resumen", "productos", "pedidos", "clientes", "contabilidad", "ajustes"];
  function leerGuardado(k) {
    try { return sessionStorage.getItem(k); } catch (e) { return null; }
  }
  function escribirGuardado(k, v) {
    try { sessionStorage.setItem(k, v); } catch (e) {}
  }
  var tabGuardada = leerGuardado(CLAVE_TAB);
  var scrollGuardado = Number(leerGuardado(CLAVE_SCROLL)) || 0;

  var state = {
    tab: TABS_VALIDAS.indexOf(tabGuardada) >= 0 ? tabGuardada : "resumen",
    pedidos: [],
    productos: [],
    cargando: true,
    ocupado: "",
    conta: { periodo: "mes", filtro: "todos", pedidos: [], movimientos: [], cargando: false, error: "" },
    // --- Fase 2 ---
    tienda: { listo: false, pausada: false, mensaje: "", tiempo: "", soportaTiempo: false, usarHorarios: false, horarios: {} },
    estadoTienda: { abierta: true, mensaje: "" },
    semana: [],           // pedidos de los últimos 14 días (para el resumen)
    nuevos: 0,            // pedidos nuevos sin revisar
    alerta: null,         // { id, codigo, nombre, total }
    sonido: true,
    ids: {},              // ids de pedidos ya conocidos
    avisosListos: false,
    qrUrl: "",
    archivoQr: null,
    logoUrl: "",          // logo subido por el admin ("" = el original del sitio)
    logoOculto: false,
    soportaLogo: false,   // la columna existe (sql/migracion_tablas_cortas.sql)
    archivoLogo: null,
    errorAjustes: "",
    ajustesFaltan: [], // columnas que faltan en Supabase (diagnóstico)
    borrador: {}, // cambios de Ajustes escritos pero todavía sin guardar
    ajustes: {
      negocio_nombre: "Pollos Sabroson",
      telefono: "70000000",
      texto_delivery: "Coordinamos la entrega en tu dirección",
      direccion: ((window.CONFIG_MANUAL && window.CONFIG_MANUAL.DIRECCION) || "Frente a la parada de Warnes, Warnes - Santa Cruz"),
      mapa_url: "",
      eslogan: "El sabor que|une a la familia.",
      color_primario: "#e65636",
      color_secundario: "#e9ab35",
      color_oscuro: "#28241f",
      color_fondo: "#fffdfa"
    }
  };

  var TABS = [
    ["resumen", "Resumen", "chart-column"],
    ["productos", "Productos", "package-check"],
    ["pedidos", "Pedidos", "shopping-bag"],
    ["clientes", "Clientes", "users-round"],
    ["contabilidad", "Contabilidad", "wallet"],
    ["ajustes", "Ajustes", "zap"]
  ];

  var ESTADOS = [
    ["pendiente_pago", "Pendiente de pago"],
    ["pagado", "Pagado"],
    ["en_preparacion", "En preparación"],
    ["en_camino", "En camino"],
    ["entregado", "Entregado"],
    ["cancelado", "Cancelado"]
  ];

  function avisar(mensaje, duracionMs) {
    /* Aviso flotante y fijo (independiente del re-render del panel), para
       que siempre sea visible sin importar el scroll ni la sección activa. */
    var root = $("#toastRoot");
    if (!root) return;
    root.innerHTML = '<div class="toast">' + icon("check", 16) + "<span>" + esc(mensaje) + "</span></div>";
    clearTimeout(avisar._t);
    avisar._t = setTimeout(function () {
      root.innerHTML = "";
    }, duracionMs || 2800);
  }

  /** Nombre del negocio dividido en dos piezas para el logo del panel. */
  function marcaHtml() {
    var partes = String(state.ajustes.negocio_nombre || "Pollos Sabroson").trim().split(/\s+/);
    var primera = partes.shift();
    var resto = partes.join(" ");
    return "<strong>" + esc(primera) + "</strong>" + (resto ? "<em>" + esc(resto) + "</em>" : "");
  }

  /** Nombre con el que inició sesión el administrador (lo calcula app.js). */
  function nombreAdmin() {
    var ses = window.PS_APP && window.PS_APP.state && window.PS_APP.state.sesion;
    return (ses && ses.nombre) || "Administrador";
  }

  /** Iniciales del negocio para los avatares del panel. */
  function iniciales() {
    return String(state.ajustes.negocio_nombre || "PS")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (p) {
        return p.charAt(0).toUpperCase();
      })
      .join("");
  }

  function tonoEstado(estado) {
    if (estado === "entregado") return "success";
    if (estado === "cancelado") return "danger";
    if (estado === "en_preparacion" || estado === "pendiente_pago") return "warning";
    return "info";
  }

  /* ---------------------------------------------------------
     Carga de datos
     --------------------------------------------------------- */
  var COLS_PEDIDO = "id,codigo_pedido,nombre_cliente,telefono,tipo_entrega,direccion,creado_en,total,subtotal,costo_envio,estado,items,notas,metodo_pago";
  var COLS_PEDIDO_EDIT = COLS_PEDIDO + ",editado_en,cancelado_por_cliente";
  var soportaEdicionPedido = true; // pasa a false si falta sql/migracion_editar_pedido.sql

  /** Pedidos más recientes. Si la migración de edición aún no se ejecutó, repite la consulta sin esas columnas. */
  async function pedidosRecientes(limite) {
    function consulta() {
      return sb.from("pedidos_completos")
        .select(soportaEdicionPedido ? COLS_PEDIDO_EDIT : COLS_PEDIDO)
        .order("creado_en", { ascending: false })
        .limit(limite);
    }
    var r = await consulta();
    if (r.error && soportaEdicionPedido && /editado_en|cancelado_por_cliente/.test(String(r.error.message || ""))) {
      soportaEdicionPedido = false;
      r = await consulta();
    }
    return r;
  }

  /** Un pedido con todos sus datos (cliente, entrega, pago y productos), o null. */
  async function pedidoCompleto(id) {
    var r = await sb.from("pedidos_completos").select(COLS_PEDIDO_EDIT).eq("id", id).maybeSingle();
    return r && r.data ? r.data : null;
  }

  /** "14/10/2026 · 15:32" */
  function fechaHoraPedido(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" }) +
      " · " + d.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
  }

  async function cargar() {
    state.cargando = true;
    pintar();

    var resultados = await Promise.all([
      pedidosRecientes(30),
      sb
        .from("productos")
        .select("id,nombre,categoria,precio,disponible,imagen_url,stock,descripcion,tamano_etiqueta,etiqueta,tamano_clave")
        .order("categoria", { ascending: true })
        .order("nombre", { ascending: true }),
      // Resumen: últimos 14 días (7 actuales + 7 anteriores para comparar), sin cancelados
      sb
        .from("pedidos_completos")
        .select("id,creado_en,total,telefono,items")
        .gte("creado_en", inicioDia(13).toISOString())
        .neq("estado", "cancelado")
        .order("creado_en", { ascending: false })
        .limit(2000)
    ]);

    if (resultados[2] && resultados[2].data) state.semana = resultados[2].data;

    if (resultados[0].data) {
      var filas = resultados[0].data;
      // Pedidos que llegaron mientras tanto (botón actualizar): se avisan
      var llegados = state.avisosListos ? filas.filter(function (r) { return !state.ids[r.id]; }) : [];
      state.pedidos = filas;
      filas.forEach(function (r) { state.ids[r.id] = true; });
      state.avisosListos = true;
      llegados.reverse().forEach(function (r) { avisarNuevoPedido(r, true); });
    }
    if (resultados[1].data) state.productos = resultados[1].data;

    state.cargando = false;
    pintar();
    if (scrollGuardado) {
      var y = scrollGuardado;
      scrollGuardado = 0;
      window.scrollTo(0, y);
    }
  }

  async function cargarQr() {
    var res = await sb
      .from("configuracion_completa")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (res.data) {
      if (res.data.qr_url) state.qrUrl = res.data.qr_url;
      state.logoUrl = res.data.logo_url || "";
      state.logoOculto = !!res.data.logo_oculto;
      state.soportaLogo = Object.prototype.hasOwnProperty.call(res.data, "logo_oculto");
      state.ajustesFaltan = ["negocio_nombre", "telefono", "texto_delivery", "direccion", "mapa_url", "eslogan",
        "color_primario", "color_secundario", "color_oscuro", "color_fondo"].filter(function (c) {
        return !Object.prototype.hasOwnProperty.call(res.data, c);
      });
      state.ajustes = {
        negocio_nombre: res.data.negocio_nombre || "Pollos Sabroson",
        telefono: (res.data.telefono && res.data.telefono !== "70000000") ? res.data.telefono : ((window.CONFIG_MANUAL && window.CONFIG_MANUAL.TELEFONO) || res.data.telefono || "70000000"),
        texto_delivery: res.data.texto_delivery || "Coordinamos la entrega en tu dirección",
        direccion: (res.data.direccion && !/^\s*Av\.?\s*Principal\s*123/i.test(res.data.direccion) ? res.data.direccion : "") || ((window.CONFIG_MANUAL && window.CONFIG_MANUAL.DIRECCION) || "Frente a la parada de Warnes, Warnes - Santa Cruz"),
        mapa_url: res.data.mapa_url || "",
        eslogan: res.data.eslogan || "El sabor que|une a la familia.",
        color_primario: res.data.color_primario || "#e65636",
        color_secundario: res.data.color_secundario || "#e9ab35",
        color_oscuro: res.data.color_oscuro || "#28241f",
        color_fondo: res.data.color_fondo || "#fffdfa"
      };
      state.tienda = {
        listo: Object.prototype.hasOwnProperty.call(res.data, "tienda_pausada"),
        pausada: !!res.data.tienda_pausada,
        mensaje: res.data.mensaje_cierre || "",
        tiempo: res.data.tiempo_estimado || "",
        soportaTiempo: Object.prototype.hasOwnProperty.call(res.data, "tiempo_estimado"),
        minutosEdicion: res.data.minutos_edicion != null ? Number(res.data.minutos_edicion) : 10,
        soportaEdicion: Object.prototype.hasOwnProperty.call(res.data, "minutos_edicion"),
        usarHorarios: !!(res.data.horarios && typeof res.data.horarios === "object"),
        horarios: normalizarHorarios(res.data.horarios)
      };
      if (state.tienda.listo) await refrescarEstadoTienda();
      pintar();
    }
  }

  async function guardarAjustes(shell) {
    var root = shell; // los campos de color están fuera de .settings-grid: se busca en todo el panel
    if (!$(".settings-grid", shell)) return;
    var campo = function (n) { var el = $("[name='" + n + "']", root); return el ? String(el.value).trim() : ""; };

    var datos = {
      negocio_nombre: campo("negocio_nombre") || "Pollos Sabroson",
      telefono: campo("telefono") || "70000000",
      texto_delivery: campo("texto_delivery") || "Coordinamos la entrega en tu dirección",
      direccion: campo("direccion") || ((window.CONFIG_MANUAL && window.CONFIG_MANUAL.DIRECCION) || "Frente a la parada de Warnes, Warnes - Santa Cruz"),
      mapa_url: campo("mapa_url"),
      eslogan: campo("eslogan") || "El sabor que|une a la familia.",
      color_primario: campo("color_primario") || "#e65636",
      color_secundario: campo("color_secundario") || "#e9ab35",
      color_oscuro: campo("color_oscuro") || "#28241f",
      color_fondo: campo("color_fondo") || "#fffdfa"
    };

    state.errorAjustes = "";
    state.ocupado = "ajustes";
    pintar();

    var res = await window.guardarConfiguracion(datos);
    state.ocupado = "";

    // Si no hubo error pero tampoco volvió la fila, el servidor no dejó guardar (permisos).
    if (!res.error && (!res.data || (Array.isArray(res.data) && !res.data.length))) {
      res.error = { message: "el servidor no aceptó el cambio; revisa que tu cuenta sea administrador" };
    }

    if (res.error) {
      console.error(res.error);
      state.errorAjustes = "No se pudieron guardar los cambios: " + (res.error.message || "error desconocido") +
        ". Ejecuta UNA vez en Supabase (SQL Editor) el archivo sql/migracion_tablas_cortas.sql y vuelve a intentar.";
      avisar(
        "No se pudieron guardar los cambios (" + (res.error.message || "error desconocido") + "). " +
        "Ejecuta UNA sola vez en Supabase (SQL Editor) el archivo sql/migracion_tablas_cortas.sql y vuelve a intentar.",
        9000
      );
      pintar();
      return;
    }

    state.ajustes = {
      negocio_nombre: datos.negocio_nombre,
      telefono: datos.telefono,
      texto_delivery: datos.texto_delivery,
      direccion: datos.direccion,
      mapa_url: datos.mapa_url,
      eslogan: datos.eslogan,
      color_primario: datos.color_primario,
      color_secundario: datos.color_secundario,
      color_oscuro: datos.color_oscuro,
      color_fondo: datos.color_fondo
    };
    state.borrador = {};
    state.errorAjustes = "";
    avisar("Cambios guardados correctamente.");
    window.PS_APP.recargarConfiguracion();
    pintar();
  }

  /* ---------------------------------------------------------
     Tienda: pausar y horarios
     --------------------------------------------------------- */
  var DIAS = [
    ["lun", "Lunes"], ["mar", "Martes"], ["mie", "Miércoles"], ["jue", "Jueves"],
    ["vie", "Viernes"], ["sab", "Sábado"], ["dom", "Domingo"]
  ];

  function normalizarHorarios(h) {
    var out = {};
    DIAS.forEach(function (d) {
      var x = h && h[d[0]];
      out[d[0]] = {
        abierto: x ? x.abierto !== false : true,
        desde: (x && x.desde) || "11:00",
        hasta: (x && x.hasta) || "22:00"
      };
    });
    return out;
  }

  async function refrescarEstadoTienda() {
    var r = await sb.rpc("tienda_estado");
    if (!r.error && r.data) state.estadoTienda = r.data;
    if (window.PS_APP && window.PS_APP.recargarEstadoTienda) window.PS_APP.recargarEstadoTienda();
  }

  /** Lee del formulario los valores escritos (mensaje y horarios) sin guardarlos. */
  function leerFormularioTienda(shell) {
    var msg = $("[name='mensaje_cierre']", shell);
    if (!msg) return;
    state.tienda.mensaje = msg.value;
    var tiempo = $("[name='tiempo_estimado']", shell);
    if (tiempo) state.tienda.tiempo = tiempo.value;
    var minEdit = $("[name='minutos_edicion']", shell);
    if (minEdit) state.tienda.minutosEdicion = minEdit.value;
    var usar = $("[name='usar_horarios']", shell);
    state.tienda.usarHorarios = !!(usar && usar.checked);
    DIAS.forEach(function (d) {
      var ab = $("[name='h_" + d[0] + "_abierto']", shell);
      if (!ab) return;
      state.tienda.horarios[d[0]] = {
        abierto: ab.checked,
        desde: $("[name='h_" + d[0] + "_desde']", shell).value || "11:00",
        hasta: $("[name='h_" + d[0] + "_hasta']", shell).value || "22:00"
      };
    });
  }

  async function guardarTienda(parcial, textoOk) {
    state.ocupado = "tienda";
    pintar();
    var res = await window.guardarConfiguracion(parcial);
    state.ocupado = "";
    if (res.error) {
      console.error(res.error);
      avisar("No se pudo guardar (" + (res.error.message || "error") + "). Ejecuta sql/migracion_tablas_cortas.sql en Supabase.", 8000);
      pintar();
      return false;
    }
    await refrescarEstadoTienda();
    avisar(textoOk || "Cambios guardados.");
    pintar();
    return true;
  }

  /** Agrega el tiempo estimado al guardado solo si la columna existe (migracion_fase3.sql). */
  function conTiempo(parcial) {
    if (state.tienda.soportaTiempo) parcial.tiempo_estimado = String(state.tienda.tiempo || "").trim().slice(0, 40);
    if (state.tienda.soportaEdicion) {
      var mins = Math.round(Number(state.tienda.minutosEdicion));
      parcial.minutos_edicion = isNaN(mins) ? 10 : Math.min(120, Math.max(0, mins));
      state.tienda.minutosEdicion = parcial.minutos_edicion;
    }
    return parcial;
  }

  async function alternarPausa(shell) {
    leerFormularioTienda(shell);
    var pausar = !state.tienda.pausada;
    var ok = await guardarTienda(
      conTiempo({ tienda_pausada: pausar, mensaje_cierre: state.tienda.mensaje.trim() }),
      pausar ? "Tienda pausada: no se aceptan pedidos nuevos." : "Tienda reanudada: ya se aceptan pedidos."
    );
    if (ok) state.tienda.pausada = pausar;
    pintar();
  }

  async function guardarHorarios(shell) {
    leerFormularioTienda(shell);
    var t = state.tienda;
    var horarios = null;
    if (t.usarHorarios) {
      horarios = {};
      DIAS.forEach(function (d) { horarios[d[0]] = t.horarios[d[0]]; });
    }
    await guardarTienda(
      conTiempo({ mensaje_cierre: t.mensaje.trim(), horarios: horarios }),
      t.usarHorarios ? "Horarios guardados." : "Horarios desactivados: la tienda estará siempre abierta."
    );
  }

  function pastillaTienda() {
    if (!state.tienda.listo) return "";
    var e = state.estadoTienda;
    var abierta = e.abierta !== false;
    return (
      '<button class="store-toggle ' + (abierta ? "is-open" : "is-closed") + '" data-toggle-pausa' +
      (state.ocupado === "tienda" ? " disabled" : "") + ' title="' + (state.tienda.pausada ? "Reanudar pedidos" : "Pausar pedidos") + '">' +
      '<span class="store-toggle-dot"></span>' +
      (abierta ? "Tienda abierta" : state.tienda.pausada ? "Pausada" : "Cerrada") +
      icon(state.tienda.pausada ? "play" : "pause", 13) + "</button>"
    );
  }

  function vistaTienda() {
    var t = state.tienda;
    if (!t.listo) {
      return (
        '<section class="admin-section-card store-card"><div class="section-toolbar"><div><span>Pedidos</span><h2>Estado de la tienda</h2></div></div>' +
        '<div class="settings-note">' + icon("check", 16) +
        " Para poder pausar la tienda y definir horarios, ejecuta <b>sql/migracion_tablas_cortas.sql</b> en Supabase (SQL Editor) y vuelve a abrir el panel.</div></section>"
      );
    }
    var e = state.estadoTienda;
    var abierta = e.abierta !== false;
    var filas = DIAS.map(function (d) {
      var h = t.horarios[d[0]];
      return (
        '<div class="schedule-row' + (h.abierto ? "" : " is-off") + '">' +
        '<label class="schedule-day"><input type="checkbox" name="h_' + d[0] + '_abierto"' + (h.abierto ? " checked" : "") + " /> " + d[1] + "</label>" +
        '<input type="time" name="h_' + d[0] + '_desde" value="' + esc(h.desde) + '" />' +
        "<span>a</span>" +
        '<input type="time" name="h_' + d[0] + '_hasta" value="' + esc(h.hasta) + '" />' +
        "</div>"
      );
    }).join("");

    return (
      '<section class="admin-section-card store-card">' +
      '<div class="section-toolbar"><div><span>Pedidos</span><h2>Estado de la tienda</h2></div>' +
      '<span class="store-status ' + (abierta ? "is-open" : "is-closed") + '"><i></i>' +
      (abierta ? "Recibiendo pedidos" + (e.hasta ? " · hasta las " + esc(e.hasta) : "") : esc(e.mensaje || "Cerrada")) + "</span></div>" +
      '<div class="store-grid">' +
      '<div class="store-pause">' +
      "<h3>" + (t.pausada ? "La tienda está pausada" : "Pausar la tienda") + "</h3>" +
      "<p>" + (t.pausada
        ? "Los clientes ven el aviso y no pueden confirmar pedidos hasta que la reanudes."
        : "Úsalo cuando se acabe el producto o haya demasiada demanda. Se aplica al instante.") + "</p>" +
      '<label class="settings-wide">Mensaje para los clientes' +
      '<input name="mensaje_cierre" maxlength="140" value="' + esc(t.mensaje) + '" placeholder="Ej: Se acabó el pollo, volvemos pronto" /></label>' +
      '<button type="button" class="primary-button" data-toggle-pausa' + (state.ocupado === "tienda" ? " disabled" : "") + ">" +
      icon(t.pausada ? "play" : "pause", 15) + " " + (t.pausada ? "Reanudar pedidos" : "Pausar pedidos") + "</button>" +
      "</div>" +
      '<div class="store-hours">' +
      (t.soportaTiempo
        ? '<label class="settings-wide">Tiempo estimado de entrega <span>(opcional, lo ven los clientes al pedir)</span>' +
          '<input name="tiempo_estimado" maxlength="40" value="' + esc(t.tiempo) + '" placeholder="Ej: 30 a 40 min" /></label>'
        : "") +
      (t.soportaEdicion
        ? '<label class="settings-wide">Minutos para que el cliente edite o elimine su pedido <span>(0 = no se puede)</span>' +
          '<input type="number" name="minutos_edicion" min="0" max="120" step="1" value="' + esc(t.minutosEdicion) + '" placeholder="10" /></label>' +
          "<small>Solo mientras el pedido siga en \"Pendiente de pago\". Cuando lo pases a otro estado ya no se puede cambiar.</small>"
        : "") +
      "<h3>Horarios de atención</h3>" +
      '<label class="schedule-switch"><input type="checkbox" name="usar_horarios"' + (t.usarHorarios ? " checked" : "") + " /> " +
      "Cerrar automáticamente fuera de horario</label>" +
      (t.usarHorarios
        ? '<div class="schedule-list">' + filas + "</div>" +
          '<small>Si la hora de cierre es menor que la de apertura (por ejemplo 18:00 a 02:00) se entiende que cierra pasada la medianoche. Hora de la tienda: Bolivia.</small>' +
          '<button type="button" class="outline-button" id="btnGuardarHorarios"' + (state.ocupado === "tienda" ? " disabled" : "") + ">Guardar horarios</button>"
        : "<small>Sin horarios: la tienda recibe pedidos a toda hora, salvo cuando la pauses.</small>" +
          '<button type="button" class="outline-button" id="btnGuardarHorarios"' + (state.ocupado === "tienda" ? " disabled" : "") + ">Guardar</button>") +
      "</div></div></section>"
    );
  }

  /* ---------------------------------------------------------
     Avisos de pedidos nuevos (sonido + banner + título)
     --------------------------------------------------------- */
  var audioCtx = null;
  var canalPedidos = null;
  var sondeo = null;
  var tituloOriginal = "";

  function prepararAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* sin audio */ }
  }

  /** "Ding-dong" doble, generado con Web Audio (no necesita archivos). */
  function sonar() {
    if (!state.sonido) return;
    prepararAudio();
    if (!audioCtx) return;
    var t0 = audioCtx.currentTime + 0.02;
    [[880, 0], [660, 0.22], [880, 0.7], [660, 0.92]].forEach(function (n) {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = n[0];
      gain.gain.setValueAtTime(0.0001, t0 + n[1]);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + n[1] + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.34);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0 + n[1]);
      osc.stop(t0 + n[1] + 0.4);
    });
  }

  function htmlAlerta() {
    var a = state.alerta;
    if (!a) return "";
    return (
      '<div class="new-order-alert" role="alert">' +
      '<span class="new-order-icon">' + icon("bell", 18) + "</span>" +
      "<div><strong>" + (a.tipo === "editado" ? "Pedido editado por el cliente"
        : a.tipo === "eliminado" ? "Pedido eliminado por el cliente"
        : state.nuevos > 1 ? state.nuevos + " pedidos nuevos" : "Nuevo pedido") + "</strong>" +
      "<span>#" + esc(a.codigo) + " · " + esc(a.nombre) + " · " + D.formatPrice(Number(a.total)) + "</span></div>" +
      '<button type="button" class="primary-button" data-ver-nuevos>Ver pedidos</button>' +
      '<button type="button" class="new-order-close" data-cerrar-alerta aria-label="Cerrar aviso">' + icon("x", 16) + "</button>" +
      "</div>"
    );
  }

  function actualizarTituloPestana() {
    document.title = state.nuevos > 0 ? "(" + state.nuevos + ") Pedido nuevo · " + tituloOriginal : tituloOriginal;
  }

  /** Actualiza solo los avisos del DOM (no repinta el panel: no borra lo que se esté escribiendo). */
  function actualizarAvisosDom() {
    var caja = $("#adminAlertas");
    if (caja) {
      caja.innerHTML = htmlAlerta();
      var ver = $("[data-ver-nuevos]", caja);
      if (ver) ver.addEventListener("click", irANuevos);
      var cerrarA = $("[data-cerrar-alerta]", caja);
      if (cerrarA) cerrarA.addEventListener("click", function () {
        state.alerta = null;
        actualizarAvisosDom();
      });
    }
    var badge = $("[data-badge-pedidos]");
    if (badge) {
      badge.textContent = state.pedidos.length;
      badge.classList.toggle("has-new", state.nuevos > 0);
    }
    actualizarTituloPestana();
  }

  function irANuevos() {
    state.tab = "pedidos";
    limpiarNuevos();
    pintar();
  }

  function limpiarNuevos() {
    state.nuevos = 0;
    state.alerta = null;
    actualizarTituloPestana();
  }

  function avisarNuevoPedido(row, yaEnLista) {
    if (!yaEnLista) {
      if (state.ids[row.id]) return;
      state.ids[row.id] = true;
      state.pedidos.unshift(row);
      if (state.pedidos.length > 60) state.pedidos.length = 60;
    } else {
      state.ids[row.id] = true;
    }

    if (!yaEnLista && row.estado !== "cancelado") state.semana.unshift(row);

    state.nuevos += 1;
    state.alerta = { id: row.id, codigo: row.codigo_pedido, nombre: row.nombre_cliente, total: row.total };
    sonar();

    try {
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        new Notification("Nuevo pedido " + row.codigo_pedido, {
          body: row.nombre_cliente + " · " + D.formatPrice(Number(row.total))
        });
      }
    } catch (e) { /* notificaciones no disponibles */ }

    // Solo se repinta todo en pestañas sin formularios (así no se borra lo que se escribe)
    if (state.tab === "pedidos" || state.tab === "resumen") pintar();
    else actualizarAvisosDom();
  }

  /** El cliente editó o eliminó un pedido: se actualiza la lista y se avisa a cocina. */
  function aplicarCambioPedido(row) {
    var idx = -1;
    state.pedidos.forEach(function (p, i) { if (p.id === row.id) idx = i; });
    var prev = idx >= 0 ? state.pedidos[idx] : null;
    var editado = !!(prev && (row.editado_en || null) !== (prev.editado_en || null));
    var eliminado = !!(prev && row.estado === "cancelado" && row.cancelado_por_cliente && !(prev.estado === "cancelado" && prev.cancelado_por_cliente));

    if (prev) state.pedidos[idx] = Object.assign({}, prev, row);

    // El resumen (últimos 14 días) no cuenta cancelados y usa el total vigente
    if (row.estado === "cancelado") {
      state.semana = state.semana.filter(function (x) { return x.id !== row.id; });
    } else {
      state.semana = state.semana.map(function (x) {
        return x.id === row.id ? Object.assign({}, x, { total: row.total, items: row.items }) : x;
      });
    }

    if (!editado && !eliminado) {
      if (state.tab === "pedidos" || state.tab === "resumen") pintar();
      return;
    }

    state.alerta = {
      id: row.id, codigo: row.codigo_pedido, nombre: row.nombre_cliente, total: row.total,
      tipo: eliminado ? "eliminado" : "editado"
    };
    sonar();
    try {
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        new Notification((eliminado ? "Pedido eliminado " : "Pedido editado ") + row.codigo_pedido, {
          body: row.nombre_cliente + " · " + D.formatPrice(Number(row.total))
        });
      }
    } catch (e) { /* notificaciones no disponibles */ }

    if (state.tab === "pedidos" || state.tab === "resumen") pintar();
    else actualizarAvisosDom();
  }

  async function sondearPedidos() {
    if ($("#adminShell").hidden || !state.avisosListos) return;
    var r = await pedidosRecientes(15);
    if (r.error || !r.data) return;
    r.data.filter(function (x) { return !state.ids[x.id]; }).reverse().forEach(function (x) {
      avisarNuevoPedido(x, false);
    });
    // Respaldo de Realtime: pedidos que el cliente editó o eliminó
    r.data.forEach(function (x) {
      var prev = state.pedidos.filter(function (p) { return p.id === x.id; })[0];
      if (!prev) return;
      var editado = (x.editado_en || null) !== (prev.editado_en || null);
      var eliminado = x.estado === "cancelado" && !!x.cancelado_por_cliente && prev.estado !== "cancelado";
      if (editado || eliminado) aplicarCambioPedido(x);
    });
  }

  function iniciarAvisos() {
    detenerAvisos();
    tituloOriginal = document.title.replace(/^\(\d+\)\s*Pedido nuevo · /, "") || state.ajustes.negocio_nombre || "Pollos Sabroson";
    try { state.sonido = localStorage.getItem("ps_sonido") !== "0"; } catch (e) { /* por defecto: activado */ }

    try {
      canalPedidos = sb
        .channel("pedidos-admin")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos" }, async function (payload) {
          // El aviso trae solo los datos cortos del pedido: se lee el pedido completo
          var fila = payload && payload.new ? await pedidoCompleto(payload.new.id) : null;
          if (fila) avisarNuevoPedido(fila, false);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos" }, async function (payload) {
          var fila = payload && payload.new ? await pedidoCompleto(payload.new.id) : null;
          if (fila) aplicarCambioPedido(fila);
        })
        .subscribe();
    } catch (e) {
      console.warn("Realtime no disponible; se usa revisión periódica.", e);
    }
    // Respaldo: aunque Realtime falle, se revisa cada 20 segundos
    sondeo = setInterval(sondearPedidos, 20000);
  }

  function detenerAvisos() {
    if (canalPedidos) {
      try { sb.removeChannel(canalPedidos); } catch (e) { /* ya cerrado */ }
      canalPedidos = null;
    }
    if (sondeo) {
      clearInterval(sondeo);
      sondeo = null;
    }
    if (tituloOriginal) document.title = tituloOriginal;
  }

  function alternarSonido() {
    state.sonido = !state.sonido;
    try { localStorage.setItem("ps_sonido", state.sonido ? "1" : "0"); } catch (e) { /* sin almacenamiento */ }
    if (state.sonido) {
      prepararAudio();
      sonar(); // prueba para que el administrador sepa cómo suena
      try {
        if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      } catch (e) { /* sin notificaciones */ }
    }
    pintar();
  }

  /* ---------------------------------------------------------
     Ticket imprimible para cocina
     --------------------------------------------------------- */
  function imprimirTicket(pedido) {
    if (!pedido) return;
    var items = Array.isArray(pedido.items) ? pedido.items : [];
    var estado = (ESTADOS.filter(function (e) { return e[0] === pedido.estado; })[0] || [0, pedido.estado])[1];
    var fecha = new Date(pedido.creado_en);
    var fechaTxt = isNaN(fecha) ? "" :
      fecha.toLocaleDateString("es-BO") + " " + fecha.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });

    var lineas = items.map(function (i) {
      var detalle = [i.tamano_etiqueta, i.presa ? "Presa: " + (i.presa_etiqueta || i.presa) : "", i.acompanante]
        .filter(Boolean).join(" · ");
      return (
        '<div class="t-item"><b>' + esc(i.cantidad) + " x " + esc(i.nombre_producto) + "</b>" +
        "<span>" + D.formatPrice(Number(i.precio_unitario) * Number(i.cantidad)) + "</span></div>" +
        (detalle ? '<div class="t-detalle">' + esc(detalle) + "</div>" : "")
      );
    }).join("");

    var html =
      '<div class="t-center t-big">' + esc(state.ajustes.negocio_nombre) + "</div>" +
      '<div class="t-center">Pedido <b>#' + esc(pedido.codigo_pedido) + "</b></div>" +
      '<div class="t-center t-small">' + esc(fechaTxt) + "</div>" +
      (pedido.editado_en && !(pedido.estado === "cancelado" && pedido.cancelado_por_cliente)
        ? '<div class="t-center t-small"><b>** PEDIDO EDITADO ** ' + esc(fechaHoraPedido(pedido.editado_en)) + "</b></div>" : "") +
      '<div class="t-line"></div>' +
      '<div class="t-modo">' + (pedido.tipo_entrega === "delivery" ? "DELIVERY" : "RECOJO EN TIENDA") + "</div>" +
      "<div><b>" + esc(pedido.nombre_cliente) + "</b></div>" +
      "<div>Tel: " + esc(pedido.telefono) + "</div>" +
      (pedido.tipo_entrega === "delivery" && pedido.direccion ? "<div>Dir: " + esc(pedido.direccion) + "</div>" : "") +
      '<div class="t-line"></div>' + lineas + '<div class="t-line"></div>' +
      (pedido.notas ? '<div class="t-notas">NOTA: ' + esc(pedido.notas) + "</div>" : "") +
      (Number(pedido.costo_envio) > 0
        ? '<div class="t-item"><span>Envío</span><span>' + D.formatPrice(Number(pedido.costo_envio)) + "</span></div>" : "") +
      '<div class="t-item t-total"><b>TOTAL</b><b>' + D.formatPrice(Number(pedido.total)) + "</b></div>" +
      "<div>Pago: " + (pedido.metodo_pago === "qr" ? "QR" : "Efectivo") + " · " + esc(estado) + "</div>" +
      '<div class="t-line"></div><div class="t-center t-small">¡Gracias por tu pedido!</div>';

    var viejo = document.getElementById("ticketPrint");
    if (viejo) viejo.remove();
    var caja = document.createElement("div");
    caja.id = "ticketPrint";
    caja.innerHTML = html;
    document.body.appendChild(caja);
    document.body.classList.add("imprimiendo-ticket");

    function limpiar() {
      document.body.classList.remove("imprimiendo-ticket");
      if (caja.parentNode) caja.parentNode.removeChild(caja);
      window.removeEventListener("afterprint", limpiar);
    }
    window.addEventListener("afterprint", limpiar);
    setTimeout(function () { window.print(); }, 60);
  }

  /* ---------------------------------------------------------
     Acciones
     --------------------------------------------------------- */
  async function cambiarEstadoPedido(id, estado) {
    state.ocupado = id;
    pintar();

    var res = await sb.from("pedidos").update({ estado: estado }).eq("id", id);
    state.ocupado = "";

    if (res.error) {
      avisar("No se pudo actualizar el pedido. Revisa las políticas RLS.");
      pintar();
      return;
    }

    state.pedidos = state.pedidos.map(function (p) {
      return p.id === id ? Object.assign({}, p, { estado: estado }) : p;
    });
    pintar();
    avisar("Estado del pedido actualizado.");
  }

  async function alternarDisponible(producto) {
    state.ocupado = producto.id;
    pintar();

    var res = await sb
      .from("productos")
      .update({ disponible: !producto.disponible })
      .eq("id", producto.id);
    state.ocupado = "";

    if (res.error) {
      avisar("No se pudo actualizar el producto. Revisa las políticas RLS.");
      return;
    }

    state.productos = state.productos.map(function (p) {
      return p.id === producto.id ? Object.assign({}, p, { disponible: !p.disponible }) : p;
    });
    avisar("Disponibilidad actualizada.");
    window.PS_APP.recargarProductos();
  }

  async function eliminarProducto(producto) {
    if (!confirm('¿Eliminar "' + producto.nombre + '" del catálogo?')) return;

    var res = await sb.from("productos").delete().eq("id", producto.id);
    if (res.error) {
      avisar("No se pudo eliminar el producto.");
      return;
    }

    state.productos = state.productos.filter(function (p) {
      return p.id !== producto.id;
    });
    avisar("Producto eliminado.");
    window.PS_APP.recargarProductos();
  }

  async function subirArchivo(bucket, file, prefijo) {
    var extension = (file.name.split(".").pop() || "png").toLowerCase();
    var nombre = (prefijo || bucket) + "-" + Date.now() + "." + extension;

    var subida = await sb.storage.from(bucket).upload(nombre, file, {
      upsert: true,
      contentType: file.type || "image/png"
    });
    if (subida.error) throw subida.error;

    return sb.storage.from(bucket).getPublicUrl(nombre).data.publicUrl;
  }

  /* ---------------------------------------------------------
     Logo de la portada: cambiar, quitar o restaurar el original
     --------------------------------------------------------- */
  var LOGO_ORIGINAL = "./assets/logo-sabroson.jpg";
  var vistaLogo = { archivo: null, url: "" };

  /** Imagen que se muestra en la vista previa (el archivo elegido, el logo actual o el original). */
  function urlVistaLogo() {
    if (state.archivoLogo) {
      if (vistaLogo.archivo !== state.archivoLogo) {
        if (vistaLogo.url) URL.revokeObjectURL(vistaLogo.url);
        vistaLogo = { archivo: state.archivoLogo, url: URL.createObjectURL(state.archivoLogo) };
      }
      return vistaLogo.url;
    }
    return state.logoUrl || LOGO_ORIGINAL;
  }

  /** Borra del almacenamiento un logo que ya no se usa (solo archivos "logo-..."; nunca fotos de productos). */
  async function borrarArchivoLogo(url) {
    try {
      var m = String(url || "").match(/\/object\/public\/productos\/(logo-[^/?#]+)$/);
      if (m) await sb.storage.from("productos").remove([m[1]]);
    } catch (e) { /* si no se puede borrar, queda huérfano pero no afecta al sitio */ }
  }

  async function guardarConfigLogo(parcial, mensajeOk, mensajeError) {
    state.ocupado = "logo";
    pintar();
    var res = await window.guardarConfiguracion(parcial);
    state.ocupado = "";
    if (res.error) {
      console.error(res.error);
      avisar(mensajeError + " Ejecuta sql/migracion_tablas_cortas.sql y verifica el rol administrador.", 8000);
      pintar();
      return false;
    }
    avisar(mensajeOk);
    window.PS_APP.recargarConfiguracion();
    return true;
  }

  async function guardarLogo() {
    var f = state.archivoLogo;
    if (!f) { avisar("Selecciona una imagen primero."); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { avisar("Usa una imagen PNG, JPG o WEBP."); return; }
    if (f.size > 5 * 1024 * 1024) { avisar("La imagen pesa más de 5 MB. Usa una más liviana."); return; }

    state.ocupado = "logo";
    pintar();
    var url;
    try {
      url = await subirArchivo("productos", f, "logo");
    } catch (err) {
      console.error(err);
      state.ocupado = "";
      avisar("No se pudo subir la imagen. Ejecuta sql/migracion_storage.sql y verifica el rol administrador.", 8000);
      pintar();
      return;
    }
    var anterior = state.logoUrl;
    var ok = await guardarConfigLogo({ logo_url: url, logo_oculto: false }, "Logo actualizado.", "No se pudo guardar el logo.");
    if (ok) {
      state.logoUrl = url;
      state.logoOculto = false;
      state.archivoLogo = null;
      if (anterior) borrarArchivoLogo(anterior);
      pintar();
    } else {
      borrarArchivoLogo(url);
    }
  }

  async function quitarLogo() {
    if (!confirm("¿Quitar el logo de la portada? La portada se verá solo con el texto. Podrás volver a ponerlo cuando quieras.")) return;
    var ok = await guardarConfigLogo({ logo_oculto: true }, "Logo quitado de la portada.", "No se pudo quitar el logo.");
    if (ok) { state.logoOculto = true; pintar(); }
  }

  async function restaurarLogo() {
    if (!confirm("¿Volver al logo original de Sabroson?")) return;
    var anterior = state.logoUrl;
    var ok = await guardarConfigLogo({ logo_url: null, logo_oculto: false }, "Se restauró el logo original.", "No se pudo restaurar el logo.");
    if (ok) {
      state.logoUrl = "";
      state.logoOculto = false;
      state.archivoLogo = null;
      if (anterior) borrarArchivoLogo(anterior);
      pintar();
    }
  }

  async function guardarQr() {
    if (!state.archivoQr) {
      avisar("Selecciona una imagen QR primero.");
      return;
    }

    state.ocupado = "qr";
    pintar();

    try {
      var url = await subirArchivo("pagos", state.archivoQr);
      var res = await window.guardarConfiguracion({ qr_url: url });
      if (res.error) throw res.error;

      state.qrUrl = url;
      state.archivoQr = null;
      state.ocupado = "";
      avisar("Imagen QR actualizada correctamente.");
      window.PS_APP.recargarConfiguracion();
    } catch (err) {
      console.error(err);
      state.ocupado = "";
      avisar("No se pudo subir el QR. Ejecuta sql/migracion_storage.sql y verifica el rol administrador.");
    }
  }

  /* ---------------------------------------------------------
     Formulario de producto (crear / editar)
     --------------------------------------------------------- */
  function abrirFormularioProducto(producto) {
    var editando = !!producto;
    var p = Object.assign({}, producto || {});
    var idOriginal = producto ? producto.id : null;
    var error = "";
    var guardando = false;

    function html() {
      return (
        '<div class="modal-backdrop"><div class="auth-modal">' +
        '<button class="modal-close" data-cerrar aria-label="Cerrar">' + icon("x", 20) + "</button>" +
        '<p class="eyebrow"><span></span>Catálogo</p>' +
        "<h2>" + (editando ? "Editar producto" : "Nuevo producto") + "</h2>" +
        "<p>Los cambios se guardan directamente en la tabla <b>productos</b> de Supabase.</p>" +
        '<form id="formProducto">' +
        '<label>Nombre<input name="nombre" required value="' + esc(p.nombre || "") + '" /></label>' +
        "<label>Categoría<select name=\"categoria\">" +
        [["brasa", "Pollo a la brasa"], ["broaster", "Pollo broaster"], ["lomito", "Lomito"], ["hamburguesa", "Hamburguesa"], ["bebida", "Bebida"]]
          .map(function (c) {
            return '<option value="' + c[0] + '"' + (p.categoria === c[0] ? " selected" : "") + ">" + c[1] + "</option>";
          })
          .join("") +
        "</select></label>" +
        '<label>Tamaño visible<input name="tamano_etiqueta" placeholder="Cuarto de pollo" value="' + esc(p.tamano_etiqueta || "") + '" /></label>' +
        '<label>Descripción<input name="descripcion" value="' + esc(p.descripcion || "") + '" /></label>' +
        '<label>Precio (Bs)<input name="precio" type="number" step="0.01" required value="' + esc(p.precio != null ? p.precio : "") + '" /></label>' +
        '<label>Stock<input name="stock" type="number" value="' + esc(p.stock != null ? p.stock : 99) + '" /></label>' +
        '<label>Etiqueta destacada<input name="etiqueta" placeholder="Favorito, Más pedido..." value="' + esc(p.etiqueta || "") + '" /></label>' +
        '<label>URL de imagen<input name="imagen_url" value="' + esc(p.imagen_url || "") + '" /></label>' +
        '<label class="file-picker">Subir imagen desde tu equipo<input type="file" name="archivo" accept="image/png,image/jpeg,image/webp" /></label>' +
        (error ? '<p class="form-error" role="alert">' + esc(error) + "</p>" : "") +
        '<button class="primary-button" type="submit"' + (guardando ? " disabled" : "") + ">" +
        (guardando ? "Guardando..." : "Guardar producto") + " " + icon("check", 17) +
        "</button></form></div></div>"
      );
    }

    function pintarModal() {
      var root = $("#layerRoot");
      root.innerHTML = html();
      window.hydrateIcons(root);
      document.body.style.overflow = "hidden";

      var backdrop = root.firstElementChild;
      backdrop.addEventListener("mousedown", function (e) {
        if (e.target === backdrop) cerrarModal();
      });
      $$("[data-cerrar]", root).forEach(function (b) {
        b.addEventListener("click", cerrarModal);
      });

      $("#formProducto", root).addEventListener("submit", async function (e) {
        e.preventDefault();
        var f = e.target;

        if (f.nombre.value.trim().length < 3) {
          error = "Escribe un nombre de producto.";
          return pintarModal();
        }
        if (!(Number(f.precio.value) >= 0)) {
          error = "Escribe un precio válido.";
          return pintarModal();
        }

        // IMPORTANTE: leer todo el formulario ANTES de repintar el modal,
        // porque pintarModal() recrea los campos y borra el archivo elegido.
        var valores = {
          nombre: f.nombre.value.trim(),
          categoria: f.categoria.value,
          tamano_etiqueta: f.tamano_etiqueta.value.trim() || null,
          descripcion: f.descripcion.value.trim(),
          precio: Number(f.precio.value),
          stock: Number(f.stock.value || 0),
          etiqueta: f.etiqueta.value.trim() || null
        };
        var imagen = f.imagen_url.value.trim();
        var archivo = f.archivo.files[0] || null;

        guardando = true;
        error = "";
        pintarModal();

        try {
          if (archivo) {
            avisar("Subiendo imagen...");
            imagen = await subirArchivo("productos", archivo);
          }

          var datos = Object.assign({}, valores, { imagen_url: imagen || null });

          var res = editando
            ? await sb.from("productos").update(datos).eq("id", idOriginal)
            : await sb.from("productos").insert(Object.assign({ disponible: true }, datos));

          if (res.error) throw res.error;

          cerrarModal();
          avisar(editando ? "Producto actualizado." : "Producto creado.");
          cargar();
          window.PS_APP.recargarProductos();
        } catch (err) {
          console.error(err);
          guardando = false;
          Object.assign(p, valores, { imagen_url: imagen || null }); // conserva lo que escribiste
          var causa = (err && err.message) || "";
          var esStorage = /bucket|storage|object|row-level security|policy|not found/i.test(causa);
          error = "No se pudo guardar" + (causa ? " (" + causa + ")" : "") + ". " +
            (esStorage
              ? "Ejecuta sql/migracion_storage.sql en Supabase para habilitar la subida de imágenes."
              : "Revisa las políticas RLS y que tu cuenta sea administrador.");
          pintarModal();
        }
      });
    }

    function cerrarModal() {
      $("#layerRoot").innerHTML = "";
      document.body.style.overflow = "";
    }

    pintarModal();
  }

  /* ---------------------------------------------------------
     Vistas
     --------------------------------------------------------- */
  function tablaPedidos(lista) {
    var filas;

    if (!lista.length && !state.cargando) {
      filas = '<div class="admin-empty">Todavía no hay pedidos guardados en Supabase.</div>';
    } else {
      filas = lista
        .map(function (o) {
          return (
            '<div class="orders-row">' +
            '<span class="order-code"><strong>#' + esc(o.codigo_pedido) + "</strong>" +
            "<small>" + esc(fechaHoraPedido(o.creado_en)) + "</small>" +
            (o.estado === "cancelado" && o.cancelado_por_cliente
              ? '<span class="order-flag eliminado">Eliminado por el cliente</span>'
              : o.editado_en
                ? '<span class="order-flag editado" title="' + esc("Editado el " + fechaHoraPedido(o.editado_en)) + '">Editado ' + esc(fechaHoraPedido(o.editado_en).split(" · ")[1] || "") + "</span>"
                : "") +
            "</span>" +
            "<span>" + esc(o.nombre_cliente) + "<small>" + esc(o.telefono) + "</small></span>" +
            "<span>" + (o.tipo_entrega === "delivery" ? "Delivery" : "Recojo") +
            "<small>" + esc(o.direccion || "En tienda") + "</small></span>" +
            "<strong>" + D.formatPrice(Number(o.total)) + "</strong>" +
            '<select class="status-select ' + tonoEstado(o.estado) + '" data-pedido="' + esc(o.id) + '"' +
            (state.ocupado === o.id ? " disabled" : "") + ">" +
            ESTADOS.map(function (e) {
              return '<option value="' + e[0] + '"' + (o.estado === e[0] ? " selected" : "") + ">" + e[1] + "</option>";
            }).join("") +
            "</select>" +
            '<button type="button" class="print-btn" data-imprimir="' + esc(o.id) + '" title="Imprimir ticket" aria-label="Imprimir ticket del pedido ' + esc(o.codigo_pedido) + '">' +
            icon("printer", 15) + "</button></div>"
          );
        })
        .join("");
    }

    return (
      '<div class="orders-table">' +
      '<div class="orders-row table-head">' +
      "<span>Pedido</span><span>Cliente</span><span>Entrega</span><span>Total</span><span>Estado</span><span></span>" +
      "</div>" + filas + "</div>"
    );
  }

  /* ---------------------------------------------------------
     Resumen con datos reales (últimos 7 días vs. los 7 anteriores)
     --------------------------------------------------------- */
  var LETRAS_DIA = ["D", "L", "M", "X", "J", "V", "S"];
  var CATEGORIAS_RESUMEN = [
    ["brasa", "Brasa", "tomato", "var(--tomato)"],
    ["broaster", "Broaster", "gold", "var(--gold)"],
    ["lomito", "Lomito", "olive", "var(--olive)"],
    ["hamburguesa", "Hamburguesa", "cream", "#e7dfd3"]
  ];

  /** Medianoche (hora local) de hace n días. */
  function inicioDia(n) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
  }

  function claveDia(d) {
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function abreviar(n) {
    n = Math.round(n);
    return n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace(".0", "") + "k" : String(n);
  }

  /** "+12.8%" / "−3.0%" / "sin datos previos" */
  function deltaTexto(actual, previo) {
    if (!previo) return actual ? "Nuevo" : "—";
    var p = ((actual - previo) / previo) * 100;
    return (p >= 0 ? "+" : "−") + Math.abs(p).toFixed(1) + "%";
  }

  function categoriaDeItem(i) {
    var n = String((i && i.nombre_producto) || "").toLowerCase();
    for (var k = 0; k < CATEGORIAS_RESUMEN.length; k++) {
      if (n.indexOf(CATEGORIAS_RESUMEN[k][0]) !== -1) return CATEGORIAS_RESUMEN[k][0];
    }
    return "";
  }

  function datosResumen() {
    var limite = inicioDia(6).getTime();
    var actuales = [];
    var previos = [];
    state.semana.forEach(function (p) {
      if (new Date(p.creado_en).getTime() >= limite) actuales.push(p);
      else previos.push(p);
    });
    function suma(l) {
      return l.reduce(function (s, p) { return s + Number(p.total || 0); }, 0);
    }
    function clientes(l) {
      var o = {};
      l.forEach(function (p) { o[p.telefono] = true; });
      return Object.keys(o).length;
    }

    // Ventas por día (7 barras, de hace 6 días hasta hoy)
    var dias = [];
    var porClave = {};
    for (var i = 6; i >= 0; i--) {
      var d = inicioDia(i);
      var e = { fecha: d, letra: LETRAS_DIA[d.getDay()], total: 0 };
      dias.push(e);
      porClave[claveDia(d)] = e;
    }
    actuales.forEach(function (p) {
      var e = porClave[claveDia(new Date(p.creado_en))];
      if (e) e.total += Number(p.total || 0);
    });

    // Unidades por categoría
    var cat = {};
    var totalU = 0;
    actuales.forEach(function (p) {
      (Array.isArray(p.items) ? p.items : []).forEach(function (it) {
        var c = categoriaDeItem(it);
        var q = Number(it.cantidad) || 0;
        if (!c) return;
        cat[c] = (cat[c] || 0) + q;
        totalU += q;
      });
    });

    return {
      ventas: suma(actuales), ventasPrev: suma(previos),
      pedidos: actuales.length, pedidosPrev: previos.length,
      clientes: clientes(actuales), clientesPrev: clientes(previos),
      promedio: actuales.length ? suma(actuales) / actuales.length : 0,
      promedioPrev: previos.length ? suma(previos) / previos.length : 0,
      dias: dias, cat: cat, totalU: totalU
    };
  }

  function vistaResumen() {
    var r = datosResumen();
    var maxDia = Math.max.apply(null, r.dias.map(function (d) { return d.total; }).concat([0]));
    var tope = maxDia > 0 ? maxDia : 1;
    var nota = " vs. 7 días previos";

    // Gráfica de barras: alto proporcional a la venta real de cada día
    var barras = r.dias.map(function (d, i) {
      var pct = d.total > 0 ? Math.max(4, Math.round((d.total / tope) * 100)) : 0;
      return (
        '<div class="bar-col"><div class="bar ' + (i === r.dias.length - 1 ? "active" : "") + '" style="height:' + pct + '%">' +
        "<span>" + D.formatPrice(d.total) + "</span></div><small>" + d.letra + "</small></div>"
      );
    }).join("");
    var ejeY = [tope, (tope * 2) / 3, tope / 3, 0].map(function (v) {
      return "<span>" + (maxDia > 0 ? abreviar(v) : "0") + "</span>";
    }).join("");

    // Dona por categoría: porcentaje real de unidades vendidas
    var acum = 0;
    var tramos = [];
    var leyenda = CATEGORIAS_RESUMEN.map(function (c) {
      var pct = r.totalU ? ((r.cat[c[0]] || 0) / r.totalU) * 100 : 0;
      if (pct > 0) {
        tramos.push(c[3] + " " + acum.toFixed(2) + "% " + (acum + pct).toFixed(2) + "%");
        acum += pct;
      }
      return '<p><i class="dot ' + c[2] + '"></i>' + c[1] + " <b>" + Math.round(pct) + "%</b></p>";
    }).join("");
    var fondoDona = tramos.length ? "background:conic-gradient(" + tramos.join(",") + ")" : "background:#e7dfd3";

    return (
      '<div class="metric-grid">' +
      tarjetaMetrica("zap", "Ventas (7 días)", D.formatPrice(r.ventas), deltaTexto(r.ventas, r.ventasPrev), nota, true) +
      tarjetaMetrica("shopping-bag", "Pedidos (7 días)", String(r.pedidos), deltaTexto(r.pedidos, r.pedidosPrev), nota) +
      tarjetaMetrica("users-round", "Clientes (7 días)", String(r.clientes), deltaTexto(r.clientes, r.clientesPrev), nota) +
      tarjetaMetrica("clock3", "Consumo promedio", D.formatPrice(r.promedio), deltaTexto(r.promedio, r.promedioPrev), nota) +
      "</div>" +
      '<div class="admin-grid">' +
      '<section class="analytics-card">' +
      '<div class="card-heading"><div><span>Rendimiento</span><h2>Ventas de la semana</h2></div>' +
      '<span class="select-button">Últimos 7 días</span></div>' +
      '<div class="chart-area">' +
      '<div class="chart-y">' + ejeY + "</div>" +
      '<div class="chart-bars">' + barras + "</div></div></section>" +
      '<section class="analytics-card category-analytics">' +
      '<div class="card-heading"><div><span>Lo más pedido</span><h2>Por categoría</h2></div></div>' +
      '<div class="donut-wrap">' +
      '<div class="donut" style="' + fondoDona + '"><div><strong>' + r.pedidos + "</strong><small>pedidos</small></div></div>" +
      '<div class="legend">' + leyenda + "</div></div></section></div>" +
      '<section class="orders-card">' +
      '<div class="card-heading"><div><span>Actividad reciente</span><h2>Últimos pedidos</h2></div>' +
      '<button class="text-button" data-ir="pedidos">Ver todos ' + icon("arrow-right", 15) + "</button></div>" +
      tablaPedidos(state.pedidos.slice(0, 4)) +
      "</section>"
    );
  }

  function tarjetaMetrica(nombreIcono, titulo, valor, delta, nota, destacada) {
    return (
      '<div class="metric-card' + (destacada ? " highlight" : "") + '">' +
      '<div class="metric-icon' + (destacada ? "" : " soft") + '">' + icon(nombreIcono, 19) + "</div>" +
      "<span>" + titulo + "</span><strong>" + valor + "</strong>" +
      "<small><b>" + delta + "</b>" + nota + "</small></div>"
    );
  }

  function vistaProductos() {
    var lista;

    if (!state.productos.length && !state.cargando) {
      lista = '<div class="admin-empty">No hay productos cargados. Ejecuta sql/schema.sql del proyecto.</div>';
    } else {
      lista = state.productos
        .map(function (p) {
          return (
            '<div class="admin-product-row">' +
            '<img src="' + esc(D.imagenDe(p)) + '" alt="" />' +
            "<div><strong>" + esc(p.nombre) + "</strong><span>" +
            esc(D.normalizeCategory(p.categoria)) +
            (p.tamano_etiqueta ? " · " + esc(p.tamano_etiqueta) : "") + "</span></div>" +
            "<b>" + D.formatPrice(Number(p.precio)) + "</b>" +
            '<span class="availability ' + (p.disponible ? "online" : "offline") + '">' +
            (p.disponible ? "Disponible" : "Oculto") + "</span>" +
            '<div class="product-row-actions">' +
            '<button class="outline-button" data-editar="' + esc(p.id) + '">Editar</button>' +
            '<button class="outline-button" data-alternar="' + esc(p.id) + '"' +
            (state.ocupado === p.id ? " disabled" : "") + ">" +
            (p.disponible ? "Ocultar" : "Activar") + "</button>" +
            '<button class="outline-button" data-eliminar="' + esc(p.id) + '">Eliminar</button>' +
            "</div></div>"
          );
        })
        .join("");
    }

    return (
      '<section class="admin-section-card">' +
      '<div class="section-toolbar"><div><span>Catálogo conectado a Supabase</span><h2>Productos</h2></div>' +
      '<button class="primary-button" data-nuevo>' + icon("plus", 16) + " Nuevo producto</button></div>" +
      '<div class="admin-product-list">' + lista + "</div></section>"
    );
  }

  function vistaPedidos() {
    return (
      '<section class="admin-section-card">' +
      '<div class="section-toolbar"><div><span>Gestión de pedidos</span><h2>Todos los pedidos</h2></div>' +
      '<button class="outline-button" data-refrescar>' + icon("search", 15) + " Actualizar</button></div>" +
      tablaPedidos(state.pedidos) +
      "</section>"
    );
  }

  /* ---------------------------------------------------------
     Contabilidad: ingresos y egresos
     Ingresos automáticos = pedidos (no pendientes ni cancelados).
     Movimientos manuales = tabla movimientos_contables.
     --------------------------------------------------------- */
  var CAT_EGRESO = [
    ["insumos", "Insumos (pollo, papas, etc.)"],
    ["sueldos", "Sueldos"],
    ["servicios", "Servicios (luz, agua, gas)"],
    ["alquiler", "Alquiler"],
    ["delivery", "Delivery / transporte"],
    ["mantenimiento", "Mantenimiento"],
    ["otros", "Otros"]
  ];
  var CAT_INGRESO = [
    ["ventas-local", "Venta en local"],
    ["otros-ingresos", "Otros ingresos"]
  ];
  var METODOS_CONTA = [["efectivo", "Efectivo"], ["qr", "QR"], ["transferencia", "Transferencia"], ["otro", "Otro"]];
  var PERIODOS = [
    ["hoy", "Hoy"], ["7d", "Últimos 7 días"], ["mes", "Este mes"], ["mes-ant", "Mes anterior"], ["todo", "Todo"]
  ];
  var ESTADOS_NO_COBRADOS = { pendiente_pago: 1, cancelado: 1 };

  function fechaLocal(d) {
    var m = String(d.getMonth() + 1), dd = String(d.getDate());
    return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (dd.length < 2 ? "0" + dd : dd);
  }

  /** Rango [desde, hasta) del período elegido, como Date locales (o null = sin límite). */
  function rangoConta() {
    var hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    var p = state.conta.periodo, desde = null, hasta = null;
    if (p === "hoy") { desde = hoy; hasta = new Date(hoy.getTime() + 864e5); }
    else if (p === "7d") { desde = new Date(hoy.getTime() - 6 * 864e5); hasta = new Date(hoy.getTime() + 864e5); }
    else if (p === "mes") { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1); }
    else if (p === "mes-ant") { desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 1); }
    return { desde: desde, hasta: hasta };
  }

  async function cargarContabilidad() {
    var c = state.conta;
    c.cargando = true;
    c.error = "";
    if (state.tab === "contabilidad") pintar();

    var r = rangoConta();
    var qPed = sb.from("pedidos_completos")
      .select("id,codigo_pedido,nombre_cliente,creado_en,total,estado,metodo_pago")
      .not("estado", "in", "(pendiente_pago,cancelado)")
      .order("creado_en", { ascending: false })
      .limit(5000);
    var qMov = sb.from("movimientos_contables")
      .select("id,tipo,concepto,categoria,monto,metodo_pago,fecha,notas,creado_en")
      .order("fecha", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(5000);
    if (r.desde) {
      qPed = qPed.gte("creado_en", r.desde.toISOString()).lt("creado_en", r.hasta.toISOString());
      qMov = qMov.gte("fecha", fechaLocal(r.desde)).lt("fecha", fechaLocal(r.hasta));
    }

    var res = await Promise.all([qPed, qMov]);
    if (res[1].error) {
      c.error = /relation|does not exist|schema cache/i.test(res[1].error.message || "")
        ? "Falta la tabla de contabilidad. Ejecuta sql/migracion_contabilidad.sql en Supabase > SQL Editor."
        : "No se pudo cargar la contabilidad (" + res[1].error.message + ").";
      c.movimientos = [];
    } else {
      c.movimientos = res[1].data || [];
    }
    c.pedidos = (res[0].data || []);
    c.cargando = false;
    if (state.tab === "contabilidad") pintar();
  }

  /** Lista unificada: pedidos (automáticos) + movimientos manuales, de más nuevo a más viejo. */
  function libroContable() {
    var c = state.conta;
    var filas = c.pedidos.map(function (p) {
      return {
        auto: true, id: p.id, tipo: "ingreso",
        concepto: "Pedido #" + p.codigo_pedido + " · " + (p.nombre_cliente || ""),
        categoria: "ventas-tienda", monto: Number(p.total || 0),
        metodo_pago: p.metodo_pago || "efectivo",
        fecha: fechaLocal(new Date(p.creado_en)), orden: p.creado_en
      };
    }).concat(c.movimientos.map(function (m) {
      return {
        auto: false, id: m.id, tipo: m.tipo, concepto: m.concepto, categoria: m.categoria,
        monto: Number(m.monto), metodo_pago: m.metodo_pago, fecha: m.fecha,
        notas: m.notas, orden: m.fecha + "T" + (m.creado_en || "")
      };
    }));
    var f = c.filtro;
    if (f === "ingreso" || f === "egreso") filas = filas.filter(function (x) { return x.tipo === f; });
    filas.sort(function (a, b) { return a.orden < b.orden ? 1 : -1; });
    return filas;
  }

  function nombreCategoria(cat) {
    var todas = CAT_EGRESO.concat(CAT_INGRESO, [["ventas-tienda", "Ventas de la tienda"]]);
    var h = todas.filter(function (x) { return x[0] === cat; })[0];
    return h ? h[1].replace(/ \(.*\)$/, "") : cat;
  }

  function fechaCorta(iso) {
    var p = String(iso).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso;
  }

  function vistaContabilidad() {
    var c = state.conta;
    var todas = libroContable();
    var ing = 0, egr = 0;
    // Los totales siempre cuentan ingresos y egresos, sin importar el filtro de la lista
    var sinFiltro = c.filtro;
    c.filtro = "todos";
    libroContable().forEach(function (x) { if (x.tipo === "ingreso") ing += x.monto; else egr += x.monto; });
    c.filtro = sinFiltro;
    var balance = ing - egr;

    // Egresos por categoría (barras simples)
    var porCat = {};
    c.movimientos.forEach(function (m) {
      if (m.tipo === "egreso") porCat[m.categoria] = (porCat[m.categoria] || 0) + Number(m.monto);
    });
    var cats = Object.keys(porCat).sort(function (a, b) { return porCat[b] - porCat[a]; });
    var desglose = cats.length
      ? cats.map(function (k) {
          var pct = egr ? Math.round((porCat[k] / egr) * 100) : 0;
          return '<div class="conta-bar"><span>' + esc(nombreCategoria(k)) + "</span>" +
            '<div><i style="width:' + Math.max(pct, 3) + '%"></i></div><b>' + D.formatPrice(porCat[k]) + " · " + pct + "%</b></div>";
        }).join("")
      : '<p class="conta-nota">Aún no hay egresos en este período.</p>';

    var filas;
    if (c.error) {
      filas = '<div class="admin-empty">' + esc(c.error) + "</div>";
    } else if (!todas.length && !c.cargando) {
      filas = '<div class="admin-empty">No hay movimientos en este período.</div>';
    } else {
      filas = todas.map(function (x) {
        return (
          '<div class="conta-row">' +
          "<span>" + fechaCorta(x.fecha) + "</span>" +
          '<span class="conta-tipo ' + x.tipo + '">' + (x.tipo === "ingreso" ? "Ingreso" : "Egreso") + "</span>" +
          "<span><strong>" + esc(x.concepto) + "</strong><small>" + esc(nombreCategoria(x.categoria)) +
          " · " + esc(x.metodo_pago) + (x.auto ? " · automático" : "") + (x.notas ? " · " + esc(x.notas) : "") + "</small></span>" +
          '<strong class="conta-monto ' + x.tipo + '">' + (x.tipo === "ingreso" ? "+" : "−") + D.formatPrice(x.monto) + "</strong>" +
          '<span class="conta-acciones">' +
          (x.auto ? "" :
            '<button type="button" class="print-btn" data-conta-editar="' + esc(x.id) + '" title="Editar">' + icon("check", 14) + "</button>" +
            '<button type="button" class="print-btn" data-conta-borrar="' + esc(x.id) + '" title="Eliminar">' + icon("trash", 14) + "</button>") +
          "</span></div>"
        );
      }).join("");
    }

    return (
      '<div class="metric-grid conta-metricas">' +
      tarjetaMetrica("zap", "Ingresos", D.formatPrice(ing), "", " ventas + otros ingresos", true) +
      tarjetaMetrica("package-check", "Egresos", D.formatPrice(egr), "", " gastos registrados") +
      tarjetaMetrica("wallet", "Balance", (balance < 0 ? "−" : "") + D.formatPrice(Math.abs(balance)), "", balance >= 0 ? " ganancia del período" : " pérdida del período") +
      tarjetaMetrica("shopping-bag", "Movimientos", String(todas.length), "", " en el período") +
      "</div>" +
      '<section class="admin-section-card">' +
      '<div class="section-toolbar"><div><span>Ingresos y egresos</span><h2>Contabilidad</h2></div>' +
      '<div class="conta-controles">' +
      '<select class="conta-select" data-conta-periodo>' +
      PERIODOS.map(function (p) { return '<option value="' + p[0] + '"' + (c.periodo === p[0] ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") +
      "</select>" +
      '<select class="conta-select" data-conta-filtro>' +
      [["todos", "Todos"], ["ingreso", "Solo ingresos"], ["egreso", "Solo egresos"]]
        .map(function (p) { return '<option value="' + p[0] + '"' + (c.filtro === p[0] ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") +
      "</select>" +
      '<button class="outline-button" data-conta-xlsx>Exportar Excel</button>' +
      '<button class="primary-button conta-btn-ingreso" data-conta-nuevo="ingreso">' + icon("plus", 16) + " Ingreso</button>" +
      '<button class="primary-button conta-btn-egreso" data-conta-nuevo="egreso">' + icon("minus", 16) + " Egreso</button>" +
      "</div></div>" +
      '<p class="conta-nota">Las ventas de la tienda (pedidos pagados, en preparación, en camino o entregados) se suman solas como ingresos. Aquí registras tus gastos y otros ingresos.</p>' +
      '<div class="conta-lista">' + filas + "</div></section>" +
      '<section class="admin-section-card"><div class="section-toolbar"><div><span>En qué se va el dinero</span><h2>Egresos por categoría</h2></div></div>' +
      desglose + "</section>"
    );
  }

  function abrirFormularioMovimiento(tipoInicial, movimiento) {
    var editando = !!movimiento;
    var m = Object.assign({ tipo: tipoInicial, metodo_pago: "efectivo", fecha: fechaLocal(new Date()) }, movimiento || {});
    var error = "";
    var guardando = false;

    function html() {
      var cats = m.tipo === "egreso" ? CAT_EGRESO : CAT_INGRESO;
      if (!cats.some(function (x) { return x[0] === m.categoria; })) m.categoria = cats[cats.length - 1][0];
      return (
        '<div class="modal-backdrop"><div class="auth-modal">' +
        '<button class="modal-close" data-cerrar aria-label="Cerrar">' + icon("x", 20) + "</button>" +
        '<p class="eyebrow"><span></span>Contabilidad</p>' +
        "<h2>" + (editando ? "Editar " : "Nuevo ") + (m.tipo === "egreso" ? "egreso" : "ingreso") + "</h2>" +
        '<form id="formMovimiento">' +
        '<label>Tipo<select name="tipo">' +
        '<option value="ingreso"' + (m.tipo === "ingreso" ? " selected" : "") + ">Ingreso</option>" +
        '<option value="egreso"' + (m.tipo === "egreso" ? " selected" : "") + ">Egreso</option></select></label>" +
        '<label>Concepto<input name="concepto" required placeholder="Compra de pollos, pago de luz..." value="' + esc(m.concepto || "") + '" /></label>' +
        '<label>Categoría<select name="categoria">' +
        cats.map(function (x) { return '<option value="' + x[0] + '"' + (m.categoria === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") +
        "</select></label>" +
        '<label>Monto (Bs)<input name="monto" type="number" step="0.01" min="0.01" required value="' + esc(m.monto != null ? m.monto : "") + '" /></label>' +
        '<label>Fecha<input name="fecha" type="date" required value="' + esc(m.fecha) + '" /></label>' +
        '<label>Método de pago<select name="metodo_pago">' +
        METODOS_CONTA.map(function (x) { return '<option value="' + x[0] + '"' + (m.metodo_pago === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") +
        "</select></label>" +
        '<label>Notas (opcional)<input name="notas" value="' + esc(m.notas || "") + '" /></label>' +
        (error ? '<p class="form-error" role="alert">' + esc(error) + "</p>" : "") +
        '<button class="primary-button" type="submit"' + (guardando ? " disabled" : "") + ">" +
        (guardando ? "Guardando..." : "Guardar") + " " + icon("check", 17) + "</button></form></div></div>"
      );
    }

    function leer(f) {
      return {
        tipo: f.tipo.value, concepto: f.concepto.value.trim(), categoria: f.categoria.value,
        monto: Number(f.monto.value), fecha: f.fecha.value, metodo_pago: f.metodo_pago.value,
        notas: f.notas.value.trim() || null
      };
    }

    function pintarModal() {
      var root = $("#layerRoot");
      root.innerHTML = html();
      window.hydrateIcons(root);
      document.body.style.overflow = "hidden";
      var backdrop = root.firstElementChild;
      backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) cerrarModal(); });
      $$("[data-cerrar]", root).forEach(function (b) { b.addEventListener("click", cerrarModal); });

      var form = $("#formMovimiento", root);
      // Al cambiar el tipo se actualizan las categorías sin perder lo escrito
      form.tipo.addEventListener("change", function () {
        Object.assign(m, leer(form));
        pintarModal();
      });
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var v = leer(form);
        Object.assign(m, v);
        if (v.concepto.length < 2) { error = "Escribe un concepto."; return pintarModal(); }
        if (!(v.monto > 0)) { error = "El monto debe ser mayor a 0."; return pintarModal(); }
        if (!v.fecha) { error = "Elige una fecha."; return pintarModal(); }
        guardando = true; error = ""; pintarModal();
        try {
          var res = editando
            ? await sb.from("movimientos_contables").update(v).eq("id", movimiento.id)
            : await sb.from("movimientos_contables").insert(v);
          if (res.error) throw res.error;
          cerrarModal();
          avisar(editando ? "Movimiento actualizado." : "Movimiento guardado.");
          cargarContabilidad();
        } catch (err) {
          console.error(err);
          guardando = false;
          var causa = (err && err.message) || "";
          error = "No se pudo guardar" + (causa ? " (" + causa + ")" : "") + ". " +
            (/relation|does not exist|schema cache/i.test(causa)
              ? "Ejecuta sql/migracion_contabilidad.sql en Supabase."
              : "Revisa que tu cuenta sea administrador.");
          pintarModal();
        }
      });
    }

    function cerrarModal() {
      $("#layerRoot").innerHTML = "";
      document.body.style.overflow = "";
    }
    pintarModal();
  }

  async function borrarMovimiento(id) {
    if (!window.confirm("¿Eliminar este movimiento? No se puede deshacer.")) return;
    var res = await sb.from("movimientos_contables").delete().eq("id", id);
    if (res.error) { avisar("No se pudo eliminar: " + res.error.message); return; }
    avisar("Movimiento eliminado.");
    cargarContabilidad();
  }

  /* ---------- Exportación de contabilidad (Excel .xlsx real + CSV compatible) ---------- */

  function filasExportacion() {
    var cap = function (s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
    return libroContable().map(function (x) {
      return {
        fecha: x.fecha,
        tipo: x.tipo === "ingreso" ? "Ingreso" : "Egreso",
        concepto: x.concepto || "",
        categoria: nombreCategoria(x.categoria),
        metodo: String(x.metodo_pago || "").toLowerCase() === "qr" ? "QR" : cap(x.metodo_pago),
        monto: Number(x.monto || 0),
        origen: x.auto ? "Pedido web" : "Manual",
        notas: x.notas || ""
      };
    });
  }

  function descargarBlob(blob, nombre) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /** Genera un .xlsx (ZIP sin compresión + XML) sin librerías externas. */
  function crearZip(archivos) {
    var enc = new TextEncoder();
    var tabla = crearZip.tabla;
    if (!tabla) {
      tabla = crearZip.tabla = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        tabla[n] = c >>> 0;
      }
    }
    var crc32 = function (b) {
      var c = 0xFFFFFFFF;
      for (var i = 0; i < b.length; i++) c = tabla[(c ^ b[i]) & 255] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    };
    var partes = [], central = [], offset = 0;
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; };
    var u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    archivos.forEach(function (f) {
      var nombre = enc.encode(f.nombre), datos = enc.encode(f.contenido), crc = crc32(datos);
      var local = [0x50, 0x4B, 3, 4].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc), u32(datos.length), u32(datos.length), u16(nombre.length), u16(0));
      partes.push(new Uint8Array(local), nombre, datos);
      central.push(new Uint8Array([0x50, 0x4B, 1, 2].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc), u32(datos.length), u32(datos.length), u16(nombre.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset))), nombre);
      offset += local.length + nombre.length + datos.length;
    });
    var tamCentral = central.reduce(function (s, p) { return s + p.length; }, 0);
    var fin = new Uint8Array([0x50, 0x4B, 5, 6].concat(u16(0), u16(0), u16(archivos.length), u16(archivos.length),
      u32(tamCentral), u32(offset), u16(0)));
    return new Blob(partes.concat(central, [fin]),
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function exportarContabilidadXlsx() {
    var filas = filasExportacion();
    var xml = function (s) {
      return String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    };
    var texto = function (ref, s, est) {
      return '<c r="' + ref + '" s="' + est + '" t="inlineStr"><is><t xml:space="preserve">' + xml(s) + "</t></is></c>";
    };
    var numero = function (ref, n, est) { return '<c r="' + ref + '" s="' + est + '"><v>' + n + "</v></c>"; };
    var serial = function (iso) {
      var p = String(iso).split("-");
      return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000) + 25569;
    };

    var COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
    var cab = ["Fecha", "Tipo", "Concepto", "Categoría", "Método", "Monto (Bs)", "Origen", "Notas"];
    var rows = ['<row r="1" ht="24" customHeight="1">' + cab.map(function (t, i) { return texto(COLS[i] + "1", t, 1); }).join("") + "</row>"];
    var ti = 0, te = 0;
    filas.forEach(function (x, i) {
      var r = i + 2, base = i % 2 ? 0 : 0;
      var ing = x.tipo === "Ingreso";
      if (ing) ti += x.monto; else te += x.monto;
      rows.push('<row r="' + r + '">' +
        numero("A" + r, serial(x.fecha), 3) +
        texto("B" + r, x.tipo, ing ? 5 : 6) +
        texto("C" + r, x.concepto, 2) +
        texto("D" + r, x.categoria, 2) +
        texto("E" + r, x.metodo, 2) +
        numero("F" + r, x.monto.toFixed(2), ing ? 8 : 9) +
        texto("G" + r, x.origen, 2) +
        texto("H" + r, x.notas, 2) + "</row>");
    });
    var ultima = filas.length + 1, rng = function (c) { return c + "$2:" + c + "$" + Math.max(ultima, 2); };
    var r1 = ultima + 2;
    var resumen = [
      ["Total ingresos", "SUMIF(" + rng("$B") + ',"Ingreso",' + rng("$F") + ")", ti, 10],
      ["Total egresos", "SUMIF(" + rng("$B") + ',"Egreso",' + rng("$F") + ")", te, 11],
      ["Balance", "F" + r1 + "-F" + (r1 + 1), ti - te, 12]
    ];
    resumen.forEach(function (x, i) {
      var r = r1 + i;
      rows.push('<row r="' + r + '">' + texto("E" + r, x[0], 7) +
        '<c r="F' + r + '" s="' + x[3] + '"><f>' + xml(x[1]) + "</f><v>" + x[2].toFixed(2) + "</v></c></row>");
    });

    var hoja = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="2" width="11" customWidth="1"/>' +
      '<col min="3" max="3" width="42" customWidth="1"/><col min="4" max="4" width="22" customWidth="1"/>' +
      '<col min="5" max="5" width="14" customWidth="1"/><col min="6" max="6" width="15" customWidth="1"/>' +
      '<col min="7" max="7" width="13" customWidth="1"/><col min="8" max="8" width="36" customWidth="1"/></cols>' +
      "<sheetData>" + rows.join("") + "</sheetData>" +
      '<autoFilter ref="A1:H' + Math.max(ultima, 1) + '"/>' +
      '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" fitToHeight="0"/></worksheet>';

    var borde = '<border><left style="thin"><color rgb="FFE3DDD3"/></left><right style="thin"><color rgb="FFE3DDD3"/></right><top style="thin"><color rgb="FFE3DDD3"/></top><bottom style="thin"><color rgb="FFE3DDD3"/></bottom><diagonal/></border>';
    var estilos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF2E7D32"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFC62828"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="12"/><name val="Calibri"/></font></fonts>' +
      '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFB4410B"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4E5"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF3EFE8"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' + borde + "</borders>" +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="13">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>' +
      '<xf numFmtId="165" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
      '<xf numFmtId="165" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
      '<xf numFmtId="165" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
      '<xf numFmtId="165" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
      '<xf numFmtId="165" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
      "</cellXfs></styleSheet>";

    var NS = "http://schemas.openxmlformats.org/";
    var blob = crearZip([
      { nombre: "[Content_Types].xml", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { nombre: "_rels/.rels", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { nombre: "xl/workbook.xml", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheets><sheet name="Contabilidad" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { nombre: "xl/_rels/workbook.xml.rels", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + NS + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { nombre: "xl/styles.xml", contenido: estilos },
      { nombre: "xl/worksheets/sheet1.xml", contenido: hoja }
    ]);
    descargarBlob(blob, "contabilidad-" + fechaLocal(new Date()) + ".xlsx");
  }

  function vistaClientes() {
    var mapa = {};
    state.pedidos.forEach(function (p) {
      if (!mapa[p.telefono]) mapa[p.telefono] = p;
    });
    var clientes = Object.keys(mapa).map(function (k) {
      return mapa[k];
    });

    var filas = clientes
      .map(function (c) {
        return (
          '<div class="customer-row">' +
          '<span class="customer-avatar">' + esc(c.nombre_cliente.slice(0, 2).toUpperCase()) + "</span>" +
          "<div><strong>" + esc(c.nombre_cliente) + "</strong><span>" + esc(c.telefono) + "</span></div>" +
          "<small>Último pedido " + new Date(c.creado_en).toLocaleDateString("es-BO") + "</small>" +
          "<b>" + D.formatPrice(Number(c.total)) + "</b></div>"
        );
      })
      .join("");

    if (!clientes.length) {
      filas = '<div class="admin-empty">Los clientes aparecerán aquí cuando se registren pedidos.</div>';
    }

    return (
      '<section class="admin-section-card">' +
      '<div class="section-toolbar"><div><span>Personas que ya probaron la casa</span><h2>Clientes</h2></div>' +
      '<span class="soft-count">' + clientes.length + " clientes identificados</span></div>" +
      '<div class="customer-list">' + filas + "</div></section>"
    );
  }

  /** Selector de color + campo de texto sincronizados, con la explicación de qué cambia. */
  function campoColor(nombre, etiqueta, valor, ayuda) {
    var v = esc(valor || "#000000");
    return (
      '<div class="color-field">' +
      "<span>" + esc(etiqueta) + "</span>" +
      '<div class="color-field-row">' +
      '<input type="color" data-color-pick="' + nombre + '" value="' + v + '" aria-label="' + esc(etiqueta) + '" />' +
      '<input type="text" name="' + nombre + '" value="' + v + '" spellcheck="false" />' +
      "</div>" +
      (ayuda ? '<p class="color-help">' + ayuda + "</p>" : "") +
      "</div>"
    );
  }

  /** Valor a mostrar en Ajustes: lo que el admin está escribiendo (sin guardar) o lo guardado. */
  function valAjuste(nombre) {
    var b = state.borrador || {};
    return Object.prototype.hasOwnProperty.call(b, nombre) ? b[nombre] : state.ajustes[nombre];
  }

  function hayCambiosSinGuardar() {
    var b = state.borrador || {};
    return Object.keys(b).some(function (k) { return String(b[k]) !== String(state.ajustes[k]); });
  }

  function vistaAjustes() {
    return (
      vistaTienda() +
      '<section class="admin-section-card settings-card">' +
      '<div class="section-toolbar"><div><span>Preferencias del negocio</span><h2>Ajustes</h2></div></div>' +
      '<p class="settings-note" style="margin:0 0 14px;font-size:13px;opacity:.75"><span>Todo lo que cambies aquí se guarda en Supabase y se ve en el sitio al instante. Los colores se previsualizan mientras los eliges y se aplican a todos al presionar «Guardar cambios».</span></p>' +
      ((state.ajustesFaltan && state.ajustesFaltan.length)
        ? '<div class="settings-error"><b>Falta configurar Supabase.</b> Tu base de datos no tiene estos campos: ' +
          esc(state.ajustesFaltan.join(", ")) + ". Pega y ejecuta <b>sql/migracion_tablas_cortas.sql</b> en el SQL Editor de Supabase; sin eso, Guardar cambios no puede funcionar.</div>"
        : "") +
      '<div class="settings-draft" id="ajustesBorrador"' + (hayCambiosSinGuardar() ? "" : " hidden") + ">" +
      "<span><b>Tienes cambios sin guardar.</b> Se ven en pantalla, pero los clientes los verán solo cuando presiones Guardar cambios.</span>" +
      '<button type="button" class="outline-button" id="btnDescartarAjustes">Descartar cambios</button></div>' +
      '<div class="settings-grid">' +
      '<label>Nombre del negocio<input name="negocio_nombre" value="' + esc(valAjuste("negocio_nombre")) + '" /></label>' +
      '<label>Teléfono de contacto<input name="telefono" value="' + esc(valAjuste("telefono")) + '" /></label>' +
      '<label>Texto de delivery<input name="texto_delivery" value="' + esc(valAjuste("texto_delivery")) + '" /></label>' +
      '<label>Dirección<input name="direccion" value="' + esc(valAjuste("direccion")) + '" /></label>' +
      '<label class="settings-wide">Título de la portada' +
      '<input name="eslogan" value="' + esc(valAjuste("eslogan")) + '" />' +
      "<small>Usa el símbolo | para separar las dos líneas del título.</small></label>" +
      '<label class="settings-wide">Ubicación en el mapa (link de Google Maps)' +
      '<input name="mapa_url" value="' + esc(valAjuste("mapa_url")) + '" placeholder="https://www.google.com/maps/embed?..." />' +
      "<small>Para que se vea el mapa (no solo un botón), en Google Maps abre tu ubicación → Compartir → pestaña " +
      "\"Insertar un mapa\" → copia solo el link que está dentro de src=\"...\" del código y pégalo aquí. " +
      "Si pegas un link normal de \"Compartir\" (por ejemplo uno que empieza con https://maps.app.goo.gl), " +
      "en la página aparecerá un botón que abre esa ubicación en Google Maps.</small></label>" +
      "</div>" +
      '<div class="settings-kicker settings-colors-title">Colores del sitio</div>' +
      '<div class="settings-colors">' +
      campoColor("color_primario", "Color principal", valAjuste("color_primario"),
        "<b>Dónde se ve:</b> botones (Agregar, Confirmar pedido), etiquetas pequeñas sobre los títulos, contador de la bolsa, logo, iconos, pestaña de categoría activa, insignias de productos y los acentos del panel admin.") +
      campoColor("color_secundario", "Color secundario", valAjuste("color_secundario"),
        "<b>Dónde se ve:</b> insignias doradas de productos, gráficas del panel (dona), código de seguimiento del pedido y el avatar del administrador.") +
      campoColor("color_oscuro", "Color oscuro", valAjuste("color_oscuro"),
        "<b>Dónde se ve:</b> textos principales, la portada, el pie de página, el menú lateral de este panel, botones de contorno y los avisos emergentes. Los textos grises se calculan solos a partir de este color.") +
      campoColor("color_fondo", "Color de fondo", valAjuste("color_fondo"),
        "<b>Dónde se ve:</b> fondo de toda la página, tarjetas de productos, carrito, ventanas emergentes, encabezado y tarjetas de este panel. La sección \"Nuestra historia\" usa un tono un poco más oscuro.") +
      "</div>" +
      (state.errorAjustes ? '<div class="settings-error">' + esc(state.errorAjustes) + "</div>" : "") +
      '<button class="primary-button" id="btnGuardarAjustes" type="button"' + (state.ocupado === "ajustes" ? " disabled" : "") + ">" +
      (state.ocupado === "ajustes" ? "Guardando..." : "Guardar cambios") + " " + icon("check", 16) + "</button>" +
      '<div class="qr-admin-box logo-admin-box"><div>' +
      '<span class="settings-kicker">Portada</span>' +
      "<h3>Logo de la portada</h3>" +
      "<p>Es la imagen grande que se ve en el inicio de la tienda. Puedes cambiarla, quitarla o volver al logo original.</p>" +
      (state.soportaLogo ? "" : '<div class="settings-error">Falta ejecutar sql/migracion_tablas_cortas.sql en Supabase para poder editar el logo.</div>') +
      '<label class="file-picker">Seleccionar imagen<input type="file" accept="image/png,image/jpeg,image/webp" data-logo-file' + (state.soportaLogo ? "" : " disabled") + " /></label>" +
      (state.archivoLogo ? '<small class="selected-file">' + esc(state.archivoLogo.name) + "</small>" : "") +
      '<div class="logo-admin-btns">' +
      '<button class="primary-button" type="button" data-guardar-logo' + (state.ocupado === "logo" || !state.archivoLogo || !state.soportaLogo ? " disabled" : "") + ">" +
      (state.ocupado === "logo" ? "Guardando..." : "Guardar logo") + " " + icon("check", 16) + "</button>" +
      (state.soportaLogo && !state.logoOculto
        ? '<button class="outline-button danger" type="button" data-quitar-logo' + (state.ocupado === "logo" ? " disabled" : "") + ">" + icon("trash", 14) + " Quitar logo</button>"
        : "") +
      (state.soportaLogo && (state.logoOculto || state.logoUrl)
        ? '<button class="outline-button" type="button" data-restaurar-logo' + (state.ocupado === "logo" ? " disabled" : "") + ">Restaurar original</button>"
        : "") +
      "</div></div>" +
      '<div class="qr-preview logo-preview">' +
      (state.logoOculto && !state.archivoLogo
        ? "<div>" + icon("x", 22) + "<span>Sin logo en la portada</span></div>"
        : '<img src="' + esc(urlVistaLogo()) + '" alt="Vista previa del logo" />') +
      "</div></div>" +
      '<div class="qr-admin-box"><div>' +
      '<span class="settings-kicker">Pagos digitales</span>' +
      "<h3>Imagen de código QR</h3>" +
      "<p>Actualiza el QR que verá el cliente cuando elija pagar por QR.</p>" +
      '<label class="file-picker">Seleccionar imagen<input type="file" accept="image/png,image/jpeg,image/webp" data-qr-file /></label>' +
      (state.archivoQr ? '<small class="selected-file">' + esc(state.archivoQr.name) + "</small>" : "") +
      '<button class="primary-button" data-guardar-qr' + (state.ocupado === "qr" ? " disabled" : "") + ">" +
      (state.ocupado === "qr" ? "Subiendo..." : "Guardar imagen QR") + " " + icon("check", 16) + "</button>" +
      "</div>" +
      '<div class="qr-preview">' +
      (state.qrUrl
        ? '<img src="' + esc(state.qrUrl) + '" alt="QR de pago actual" />'
        : "<div>" + icon("plus", 22) + "<span>Sin QR cargado</span></div>") +
      "</div></div>" +
      '<div class="settings-note">' + icon("check", 16) +
      " Los pedidos se guardan en Supabase con el método de pago elegido. Ejecuta sql/migracion_storage.sql para habilitar la carga del QR.</div>" +
      "</section>"
    );
  }

  /* ---------------------------------------------------------
     Render general
     --------------------------------------------------------- */
  function pintar() {
    var shell = $("#adminShell");
    if (shell.hidden) return;

    escribirGuardado(CLAVE_TAB, state.tab);
    var scrollY = window.pageYOffset;

    var actual = TABS.filter(function (t) {
      return t[0] === state.tab;
    })[0];
    var titulo = actual ? actual[1] : "Resumen";

    var cuerpo =
      state.tab === "resumen" ? vistaResumen() :
      state.tab === "productos" ? vistaProductos() :
      state.tab === "pedidos" ? vistaPedidos() :
      state.tab === "clientes" ? vistaClientes() :
      state.tab === "contabilidad" ? vistaContabilidad() :
      vistaAjustes();

    shell.innerHTML =
      '<aside class="admin-sidebar">' +
      '<div class="brand-mark brand-mark-light" aria-label="Pollos Sabroson">' +
      '<span class="brand-mark-icon">' + icon("flame", 18, { stroke: 2.6 }) + "</span>" +
      '<span class="brand-copy">' + marcaHtml() + "</span></div>" +
      '<div class="admin-label">Panel de control</div>' +
      '<nav class="admin-nav">' +
      TABS.map(function (t) {
        var extra = "";
        if (t[0] === "productos") extra = "<span>" + state.productos.length + "</span>";
        if (t[0] === "pedidos") extra = '<span class="notification-dot' + (state.nuevos > 0 ? " has-new" : "") + '" data-badge-pedidos>' + state.pedidos.length + "</span>";
        return (
          '<button class="' + (state.tab === t[0] ? "active" : "") + '" data-tab="' + t[0] + '">' +
          icon(t[2], 18) + '<span class="nav-text">' + t[1] + "</span>" + extra + "</button>"
        );
      }).join("") +
      "</nav>" +
      '<div class="admin-sidebar-bottom">' +
      '<div class="admin-user"><span>' + esc(nombreAdmin().charAt(0).toUpperCase()) + "</span><div><strong>" +
      esc(nombreAdmin()) + "</strong><small>Administrador · " + esc(state.ajustes.negocio_nombre) + "</small></div></div>" +
      '<button class="back-store" data-salir>' + icon("arrow-right", 16) + " Ver tienda</button>" +
      '<button class="back-store back-store-logout" data-cerrar-sesion>' + icon("log-out", 16) + " Cerrar sesión</button>" +
      "</div></aside>" +
      '<main class="admin-main">' +
      '<div id="adminAlertas">' + htmlAlerta() + "</div>" +
      '<div class="admin-topbar"><div>' +
      '<p class="eyebrow"><span></span>Administración / ' + titulo + "</p>" +
      "<h1>" + (state.tab === "resumen" ? "Hola, equipo <span>✦</span>" : titulo) + "</h1></div>" +
      '<div class="admin-top-actions">' +
      pastillaTienda() +
      '<button class="icon-button sound-toggle' + (state.sonido ? " is-on" : "") + '" data-toggle-sonido title="' +
      (state.sonido ? "Sonido de pedidos: activado (clic para silenciar)" : "Sonido de pedidos: silenciado (clic para activar)") + '">' +
      icon(state.sonido ? "bell" : "bell-off", 18) + "</button>" +
      '<button class="icon-button" data-refrescar>' + icon("search", 18) + "</button>" +
      '<button class="avatar-button" title="' + esc(nombreAdmin()) + '">' + esc(nombreAdmin().charAt(0).toUpperCase()) + "</button></div></div>" +
      cuerpo +
      "</main>";

    conectarEventos(shell);
    // Repintar reemplaza todo el HTML: se vuelve al mismo punto de la página
    if (scrollY) window.scrollTo(0, scrollY);
  }

  window.addEventListener("pagehide", function () {
    var sh = $("#adminShell");
    if (sh && !sh.hidden) escribirGuardado(CLAVE_SCROLL, String(window.pageYOffset));
  });

  function conectarEventos(shell) {
    $$("[data-tab]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        state.tab = b.dataset.tab;
        if (state.tab === "pedidos") limpiarNuevos();
        pintar();
        if (state.tab === "contabilidad") cargarContabilidad();
      });
    });

    $$("[data-ir]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        state.tab = b.dataset.ir;
        if (state.tab === "pedidos") limpiarNuevos();
        pintar();
      });
    });

    /* --- Contabilidad --- */
    var selPeriodo = $("[data-conta-periodo]", shell);
    if (selPeriodo) selPeriodo.addEventListener("change", function () {
      state.conta.periodo = selPeriodo.value;
      cargarContabilidad();
    });
    var selFiltro = $("[data-conta-filtro]", shell);
    if (selFiltro) selFiltro.addEventListener("change", function () {
      state.conta.filtro = selFiltro.value;
      pintar();
    });
    $$("[data-conta-nuevo]", shell).forEach(function (b) {
      b.addEventListener("click", function () { abrirFormularioMovimiento(b.dataset.contaNuevo); });
    });
    $$("[data-conta-editar]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        var m = state.conta.movimientos.filter(function (x) { return String(x.id) === b.dataset.contaEditar; })[0];
        if (m) abrirFormularioMovimiento(m.tipo, m);
      });
    });
    $$("[data-conta-borrar]", shell).forEach(function (b) {
      b.addEventListener("click", function () { borrarMovimiento(b.dataset.contaBorrar); });
    });
    var btnXlsx = $("[data-conta-xlsx]", shell);
    if (btnXlsx) btnXlsx.addEventListener("click", exportarContabilidadXlsx);

    /* --- Fase 2: tienda, sonido, ticket --- */
    $$("[data-toggle-pausa]", shell).forEach(function (b) {
      b.addEventListener("click", function () { alternarPausa(shell); });
    });
    var btnHorarios = $("#btnGuardarHorarios", shell);
    if (btnHorarios) btnHorarios.addEventListener("click", function () { guardarHorarios(shell); });
    var usarH = $("[name='usar_horarios']", shell);
    if (usarH) {
      usarH.addEventListener("change", function () {
        leerFormularioTienda(shell);
        pintar();
      });
    }
    $$("[data-toggle-sonido]", shell).forEach(function (b) {
      b.addEventListener("click", alternarSonido);
    });
    $$("[data-imprimir]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        imprimirTicket(state.pedidos.filter(function (p) { return String(p.id) === b.dataset.imprimir; })[0]);
      });
    });
    actualizarAvisosDom();

    $$("[data-refrescar]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        cargar();
        if (state.tab === "contabilidad") cargarContabilidad();
      });
    });

    $$("[data-salir]", shell).forEach(function (b) {
      b.addEventListener("click", cerrar);
    });

    $$("[data-cerrar-sesion]", shell).forEach(function (b) {
      b.addEventListener("click", async function () {
        var confirmar = confirm("¿Deseas cerrar la sesión de administrador?");
        if (!confirmar) return;
        await sb.auth.signOut();
        cerrar();
        window.PS_APP.toast("Sesión cerrada");
      });
    });

    $$("[data-pedido]", shell).forEach(function (s) {
      s.addEventListener("change", function () {
        cambiarEstadoPedido(s.dataset.pedido, s.value);
      });
    });

    $$("[data-alternar]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        alternarDisponible(buscarProducto(b.dataset.alternar));
      });
    });

    $$("[data-editar]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        abrirFormularioProducto(buscarProducto(b.dataset.editar));
      });
    });

    $$("[data-eliminar]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        eliminarProducto(buscarProducto(b.dataset.eliminar));
      });
    });

    $$("[data-nuevo]", shell).forEach(function (b) {
      b.addEventListener("click", function () {
        abrirFormularioProducto(null);
      });
    });

    var input = $("[data-qr-file]", shell);
    if (input) {
      input.addEventListener("change", function () {
        state.archivoQr = input.files[0] || null;
        pintar();
      });
    }

    var btnQr = $("[data-guardar-qr]", shell);
    if (btnQr) btnQr.addEventListener("click", guardarQr);

    var inputLogo = $("[data-logo-file]", shell);
    if (inputLogo) {
      inputLogo.addEventListener("change", function () {
        state.archivoLogo = inputLogo.files[0] || null;
        pintar();
      });
    }
    var bLogo = $("[data-guardar-logo]", shell);
    if (bLogo) bLogo.addEventListener("click", guardarLogo);
    var bQuitar = $("[data-quitar-logo]", shell);
    if (bQuitar) bQuitar.addEventListener("click", quitarLogo);
    var bRestaurar = $("[data-restaurar-logo]", shell);
    if (bRestaurar) bRestaurar.addEventListener("click", restaurarLogo);

    /* Los colores se previsualizan al instante, antes de guardar. */
    function previsualizarColores() {
      var root = $(".settings-grid", shell);
      if (!root || !window.PS_APP || !window.PS_APP.aplicarColores) return;
      window.PS_APP.aplicarColores({
        color_primario: $("[name='color_primario']", shell).value,
        color_secundario: $("[name='color_secundario']", shell).value,
        color_oscuro: $("[name='color_oscuro']", shell).value,
        color_fondo: $("[name='color_fondo']", shell).value
      });
    }

    $$("[data-color-pick]", shell).forEach(function (pick) {
      var texto = $("[name='" + pick.dataset.colorPick + "']", shell);
      if (!texto) return;

      pick.addEventListener("input", function () {
        texto.value = pick.value;
        previsualizarColores();
      });

      texto.addEventListener("input", function () {
        if (/^#[0-9a-fA-F]{6}$/.test(texto.value.trim())) {
          pick.value = texto.value.trim();
          previsualizarColores();
        }
      });
    });

    var campoNombre = $("[name='negocio_nombre']", shell);
    if (campoNombre && window.PS_APP && window.PS_APP.aplicarNombreNegocio) {
      campoNombre.addEventListener("input", function () {
        window.PS_APP.aplicarNombreNegocio(campoNombre.value);
      });
    }

    var campoEslogan = $("[name='eslogan']", shell);
    if (campoEslogan && window.PS_APP && window.PS_APP.aplicarEslogan) {
      campoEslogan.addEventListener("input", function () {
        window.PS_APP.aplicarEslogan(campoEslogan.value);
      });
    }

    var campoMapa = $("[name='mapa_url']", shell);
    if (campoMapa && window.PS_APP && window.PS_APP.aplicarMapa) {
      campoMapa.addEventListener("input", function () {
        window.PS_APP.aplicarMapa(campoMapa.value);
      });
    }

    /* Guarda lo escrito como borrador: sobrevive a cambios de pestaña y re-pintados. */
    var CAMPOS_AJUSTES = ["negocio_nombre", "telefono", "texto_delivery", "direccion", "eslogan", "mapa_url",
      "color_primario", "color_secundario", "color_oscuro", "color_fondo"];
    function marcarBorrador(nombre, valor) {
      state.borrador[nombre] = valor;
      var aviso = $("#ajustesBorrador", shell);
      if (aviso) aviso.hidden = !hayCambiosSinGuardar();
    }
    CAMPOS_AJUSTES.forEach(function (nombre) {
      var campo = $("[name='" + nombre + "']", shell);
      if (!campo) return;
      campo.addEventListener("input", function () { marcarBorrador(nombre, campo.value); });
    });
    $$("[data-color-pick]", shell).forEach(function (pick) {
      pick.addEventListener("input", function () { marcarBorrador(pick.dataset.colorPick, pick.value); });
    });
    var btnDescartar = $("#btnDescartarAjustes", shell);
    if (btnDescartar) {
      btnDescartar.addEventListener("click", function () {
        state.borrador = {};
        if (window.PS_APP && window.PS_APP.recargarConfiguracion) window.PS_APP.recargarConfiguracion();
        pintar();
        avisar("Cambios descartados.");
      });
    }

    var btnAjustes = $("#btnGuardarAjustes", shell);
    if (btnAjustes) {
      btnAjustes.addEventListener("click", function () {
        guardarAjustes(shell);
      });
    }
  }

  function buscarProducto(id) {
    return state.productos.filter(function (p) {
      return String(p.id) === String(id);
    })[0];
  }

  /* ---------------------------------------------------------
     Abrir / cerrar el panel
     --------------------------------------------------------- */
  function abrir() {
    $("#siteShell").hidden = true;
    $("#adminShell").hidden = false;
    document.body.classList.add("admin-mode");
    window.scrollTo(0, 0);
    pintar();
    if (state.tab === "contabilidad") cargarContabilidad();
    cargar();
    cargarQr();
    iniciarAvisos();
    // Los navegadores solo permiten sonido después de un clic: se "desbloquea" con el primero
    document.addEventListener("click", prepararAudio, { once: true });
  }

  function cerrar() {
    detenerAvisos();
    escribirGuardado(CLAVE_SCROLL, "0");
    $("#adminShell").hidden = true;
    $("#adminShell").innerHTML = "";
    $("#siteShell").hidden = false;
    document.body.classList.remove("admin-mode");
    window.scrollTo(0, 0);
  }

  window.PS_ADMIN = { abrir: abrir, cerrar: cerrar };
})();

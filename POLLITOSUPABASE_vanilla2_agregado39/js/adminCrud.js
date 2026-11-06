/* =========================================================
   Pollos Sabroson — adminCrud.js

   Gestor de catálogo de la página admin.html:
   portada, QR de pago y CRUD completo de productos.
   ========================================================= */
(function () {
  "use strict";

  var sb = window.sb;
  var D = window.PS_DATA;
  var icon = window.icon;

  var $ = function (sel, ctx) {
    return (ctx || document).querySelector(sel);
  };
  var $$ = function (sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  };

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var toastTimer = null;
  function toast(mensaje) {
    var root = $("#toastRoot");
    root.innerHTML = '<div class="toast">' + icon("check", 16) + "<span>" + esc(mensaje) + "</span></div>";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      root.innerHTML = "";
    }, 2600);
  }

  function mensaje(texto, tipo) {
    $("#productoMsg").innerHTML = texto
      ? '<div class="form-msg ' + tipo + '">' + esc(texto) + "</div>"
      : "";
  }

  /* ---------------------------------------------------------
     Control de acceso
     --------------------------------------------------------- */
  async function verificarAcceso() {
    var sesion = await sb.auth.getSession();
    var user = sesion.data.session ? sesion.data.session.user : null;

    if (!user) {
      $("#gate").innerHTML =
        'Debes iniciar sesión como administrador. <a href="index.html" style="color:var(--tomato)">Volver a la tienda</a>';
      return false;
    }

    var perfil = await sb.from("perfiles").select("rol").eq("id", user.id).maybeSingle();
    if (!perfil.data || perfil.data.rol !== "administrador") {
      $("#gate").innerHTML =
        'Esta cuenta no tiene permisos de administrador. <a href="index.html" style="color:var(--tomato)">Volver a la tienda</a>';
      return false;
    }

    $("#gate").hidden = true;
    $("#adminContent").hidden = false;
    return true;
  }

  $("#btnLogout").addEventListener("click", async function () {
    await sb.auth.signOut();
    window.location.href = "index.html";
  });

  /* ---------------------------------------------------------
     Configuración: portada y QR
     --------------------------------------------------------- */
  /* ---------------------------------------------------------
     Marca y colores
     --------------------------------------------------------- */
  var COLORES = [
    ["color_primario", "#colorPrimarioInput", "#colorPrimarioPick", "--tomato", "#e65636"],
    ["color_secundario", "#colorSecundarioInput", "#colorSecundarioPick", "--gold", "#e9ab35"],
    ["color_oscuro", "#colorOscuroInput", "#colorOscuroPick", "--ink", "#28241f"],
    ["color_fondo", "#colorFondoInput", "#colorFondoPick", "--paper", "#fffdfa"]
  ];

  function normalizarHex(valor) {
    var v = String(valor || "").trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(v)) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    return /^[0-9a-fA-F]{6}$/.test(v) ? "#" + v.toLowerCase() : null;
  }

  function mezclar(hex, factor) {
    var base = normalizarHex(hex);
    if (!base) return hex;
    return (
      "#" +
      [1, 3, 5]
        .map(function (i) {
          var n = parseInt(base.substr(i, 2), 16);
          var destino = factor < 0 ? 0 : 255;
          var nuevo = Math.round(n + (destino - n) * Math.abs(factor));
          return Math.max(0, Math.min(255, nuevo)).toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  /** Pinta la propia página de administración con los colores elegidos. */
  function previsualizarColores() {
    var raiz = document.documentElement.style;

    COLORES.forEach(function (c) {
      var hex = normalizarHex($(c[1]).value);
      if (hex) raiz.setProperty(c[3], hex);
    });

    var primario = normalizarHex($("#colorPrimarioInput").value);
    if (primario) raiz.setProperty("--tomato-deep", mezclar(primario, -0.22));

    var oscuro = normalizarHex($("#colorOscuroInput").value);
    if (oscuro) {
      raiz.setProperty("--forest", mezclar(oscuro, -0.12));
      raiz.setProperty("--muted-ink", mezclar(oscuro, 0.38));
    }

    var fondo = normalizarHex($("#colorFondoInput").value);
    if (fondo) {
      raiz.setProperty("--white", fondo);
      raiz.setProperty("--cream", mezclar(fondo, -0.035));
    }
  }

  COLORES.forEach(function (c) {
    var texto = $(c[1]);
    var pick = $(c[2]);
    if (!texto || !pick) return;

    pick.addEventListener("input", function () {
      texto.value = pick.value;
      previsualizarColores();
    });

    texto.addEventListener("input", function () {
      var hex = normalizarHex(texto.value);
      if (hex) {
        pick.value = hex;
        previsualizarColores();
      }
    });
  });

  $("#nombreNegocioInput").addEventListener("input", function () {
    aplicarNombreNegocio(this.value);
  });

  $("#btnGuardarMarca").addEventListener("click", async function () {
    var datos = {
      negocio_nombre: $("#nombreNegocioInput").value.trim() || "Pollos Sabroson",
      eslogan: $("#esloganInput").value.trim() || "El sabor que|une a la familia."
    };

    COLORES.forEach(function (c) {
      datos[c[0]] = normalizarHex($(c[1]).value) || c[4];
      $(c[1]).value = datos[c[0]];
      $(c[2]).value = datos[c[0]];
    });

    var res = await window.guardarConfiguracion(datos);
    if (res.error) {
      console.error(res.error);
      toast("No se pudo guardar. Ejecuta sql/migracion_tablas_cortas.sql en Supabase y verifica el rol administrador.");
      return;
    }

    previsualizarColores();
    toast("Marca y colores actualizados");
  });

  async function cargarConfiguracion() {
    var res = await sb.from("configuracion_completa").select("*").eq("id", 1).maybeSingle();
    if (!res.data) return;
    $("#heroUrlInput").value = res.data.hero_url || "";
    $("#qrUrlInput").value = res.data.qr_url || "";
    $("#nombreNegocioInput").value = res.data.negocio_nombre || "Pollos Sabroson";
    $("#esloganInput").value = res.data.eslogan || "El sabor que|une a la familia.";

    COLORES.forEach(function (c) {
      var hex = normalizarHex(res.data[c[0]]) || c[4];
      $(c[1]).value = hex;
      $(c[2]).value = hex;
    });

    aplicarNombreNegocio(res.data.negocio_nombre);
    previsualizarColores();
  }

  /** Escribe el nombre del negocio en el logo y en el título de la pestaña. */
  function aplicarNombreNegocio(nombre) {
    nombre = String(nombre || "").trim();
    if (!nombre) return;

    var partes = nombre.split(/\s+/);
    var primera = partes.shift();
    var resto = partes.join(" ");

    $$(".brand-copy").forEach(function (el) {
      el.innerHTML = "<strong>" + esc(primera) + "</strong>" + (resto ? "<em>" + esc(resto) + "</em>" : "");
    });

    document.title = "Gestor de catálogo — " + nombre;
  }

  async function subirArchivo(bucket, file) {
    var extension = (file.name.split(".").pop() || "png").toLowerCase();
    var nombre = bucket + "-" + Date.now() + "." + extension;

    var subida = await sb.storage.from(bucket).upload(nombre, file, {
      upsert: true,
      contentType: file.type || "image/png"
    });
    if (subida.error) throw subida.error;

    return sb.storage.from(bucket).getPublicUrl(nombre).data.publicUrl;
  }

  async function guardarConfig(campo, inputUrl, inputFile, bucket, etiqueta) {
    try {
      var url = $(inputUrl).value.trim();
      var file = $(inputFile).files[0];
      if (file) url = await subirArchivo(bucket, file);

      var datos = {};
      datos[campo] = url || null;

      var res = await window.guardarConfiguracion(datos);
      if (res.error) throw res.error;

      $(inputUrl).value = url;
      $(inputFile).value = "";
      toast(etiqueta + " actualizado correctamente");
    } catch (err) {
      console.error(err);
      toast("No se pudo guardar. Revisa sql/migracion_storage.sql y tus permisos.");
    }
  }

  $("#btnGuardarHero").addEventListener("click", function () {
    guardarConfig("hero_url", "#heroUrlInput", "#heroFileInput", "productos", "Portada");
  });

  $("#btnGuardarQr").addEventListener("click", function () {
    guardarConfig("qr_url", "#qrUrlInput", "#qrFileInput", "pagos", "QR de pago");
  });

  /* ---------------------------------------------------------
     Productos
     --------------------------------------------------------- */
  var productos = [];

  async function cargarProductos() {
    var res = await sb.from("productos").select("*").order("categoria").order("nombre");
    if (res.error) {
      console.error(res.error);
      toast("No se pudo cargar el catálogo.");
      return;
    }
    productos = res.data || [];
    renderTabla();
  }

  function renderTabla() {
    var tbody = $("#tablaProductos");

    if (!productos.length) {
      tbody.innerHTML = '<tr><td colspan="7">Aún no hay productos. Ejecuta sql/schema.sql.</td></tr>';
      return;
    }

    tbody.innerHTML = productos
      .map(function (p) {
        return (
          '<tr data-id="' + esc(p.id) + '">' +
          '<td><img src="' + esc(D.imagenDe(p)) + '" alt="' + esc(p.nombre) + '" /></td>' +
          "<td>" + esc(p.nombre) + (p.tamano_etiqueta ? " · " + esc(p.tamano_etiqueta) : "") + "</td>" +
          "<td>" + esc(D.normalizeCategory(p.categoria)) + "</td>" +
          "<td>" + D.formatPrice(Number(p.precio)) + "</td>" +
          "<td>" + esc(p.stock) + "</td>" +
          '<td><span class="pill ' + (p.disponible ? "ok" : "no") + '">' +
          (p.disponible ? "Disponible" : "Oculto") + "</span></td>" +
          '<td class="row-actions">' +
          '<button class="outline-button" data-accion="editar">Editar</button>' +
          '<button class="outline-button" data-accion="eliminar">Eliminar</button>' +
          "</td></tr>"
        );
      })
      .join("");
  }

  $("#tablaProductos").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-accion]");
    if (!btn) return;

    var id = btn.closest("tr").dataset.id;
    var producto = productos.filter(function (p) {
      return String(p.id) === String(id);
    })[0];
    if (!producto) return;

    if (btn.dataset.accion === "editar") cargarEnFormulario(producto);
    else eliminarProducto(producto);
  });

  function cargarEnFormulario(p) {
    var form = $("#formProducto");
    form.id.value = p.id;
    form.nombre.value = p.nombre || "";
    form.categoria.value = p.categoria || "brasa";
    form.tamano_clave.value = p.tamano_clave || "";
    form.tamano_etiqueta.value = p.tamano_etiqueta || "";
    form.descripcion.value = p.descripcion || "";
    form.precio.value = p.precio;
    form.stock.value = p.stock;
    form.etiqueta.value = p.etiqueta || "";
    form.imagen_url.value = p.imagen_url || "";
    form.disponible.checked = !!p.disponible;

    $("#formTitle").textContent = "Editando: " + p.nombre;
    $("#btnCancelarEdicion").hidden = false;
    mensaje("", "");
    window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" });
  }

  function limpiarFormulario() {
    var form = $("#formProducto");
    form.reset();
    form.id.value = "";
    form.stock.value = 99;
    $("#formTitle").textContent = "Nuevo producto";
    $("#btnCancelarEdicion").hidden = true;
    mensaje("", "");
  }

  $("#btnCancelarEdicion").addEventListener("click", limpiarFormulario);
  $("#btnRecargar").addEventListener("click", cargarProductos);

  async function eliminarProducto(p) {
    if (!confirm('¿Eliminar "' + p.nombre + '" del catálogo?')) return;

    var res = await sb.from("productos").delete().eq("id", p.id);
    if (res.error) {
      console.error(res.error);
      toast("No se pudo eliminar el producto.");
      return;
    }

    toast("Producto eliminado");
    cargarProductos();
  }

  $("#formProducto").addEventListener("submit", async function (e) {
    e.preventDefault();
    var form = e.target;
    var submitBtn = form.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    mensaje("", "");

    try {
      var imagenUrl = form.imagen_url.value.trim();
      var file = form.imagen_file.files[0];
      if (file) imagenUrl = await subirArchivo("productos", file);

      var datos = {
        nombre: form.nombre.value.trim(),
        categoria: form.categoria.value,
        tamano_clave: form.tamano_clave.value.trim() || null,
        tamano_etiqueta: form.tamano_etiqueta.value.trim() || null,
        descripcion: form.descripcion.value.trim(),
        precio: parseFloat(form.precio.value),
        stock: parseInt(form.stock.value, 10),
        etiqueta: form.etiqueta.value.trim() || null,
        imagen_url: imagenUrl || null,
        disponible: form.disponible.checked
      };

      var res = form.id.value
        ? await sb.from("productos").update(datos).eq("id", form.id.value)
        : await sb.from("productos").insert(datos);

      if (res.error) throw res.error;

      limpiarFormulario();
      toast("Producto guardado");
      cargarProductos();
    } catch (err) {
      console.error(err);
      var causa = (err && err.message) || "";
      var esStorage = /bucket|storage|object|row-level security|policy|not found/i.test(causa);
      mensaje(
        "No se pudo guardar el producto" + (causa ? " (" + causa + ")" : "") + ". " +
          (esStorage
            ? "Ejecuta sql/migracion_storage.sql en Supabase para habilitar la subida de imágenes."
            : "Revisa las políticas RLS y que tu cuenta sea administrador."),
        "error"
      );
    } finally {
      submitBtn.disabled = false;
    }
  });

  /* ---------------------------------------------------------
     Arranque
     --------------------------------------------------------- */
  (async function init() {
    window.hydrateIcons(document);
    var ok = await verificarAcceso();
    if (!ok) return;
    cargarConfiguracion();
    cargarProductos();
  })();
})();

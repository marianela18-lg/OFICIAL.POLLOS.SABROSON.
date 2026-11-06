/* =========================================================
   Pollos Sabroson — supabaseClient.js

   Configuración pública de Supabase.
   La publishable key / anon key se puede usar en el navegador.
   NUNCA coloques aquí una service_role key ni ninguna clave secreta.
   ========================================================= */
(function () {
  "use strict";

  var SUPABASE_URL = "https://dmuevqcufexwflndyxxf.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TEwKox62C4kultI0iWQnag_eQqVof1C";

  if (!window.supabase) {
    console.error(
      "No se cargó el SDK de Supabase. Revisa que exista el archivo js/supabase.js y que la etiqueta <script> en index.html lo referencie correctamente."
    );
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    console.error(
      "Supabase no está configurado. Edita js/supabaseClient.js con la URL y la publishable key de tu proyecto."
    );
    return;
  }

  // Cliente único, reutilizado por app.js, adminPanel.js y adminCrud.js
  // La sesión se guarda en el navegador y se renueva sola: el cliente sigue con su
  // cuenta al cerrar y volver a abrir el navegador, hasta que él mismo cierre sesión.
  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  /* ---------------------------------------------------------
     Guardar la configuración del negocio.
     La configuración está repartida en varias tablas cortas
     (config_negocio, config_marca, config_imagenes, config_tienda y
     config_horarios). Esta función envía los campos que cambian y la base
     de datos los reparte (solo el administrador puede). Devuelve la misma
     forma que antes: { data: [filaCompleta], error }.
     --------------------------------------------------------- */
  window.guardarConfiguracion = async function (parcial) {
    var datos = Object.assign({}, parcial);
    delete datos.id;
    delete datos.actualizado_en;
    var r = await window.sb.rpc("guardar_configuracion", { p_datos: datos });
    if (r.error) return { data: null, error: r.error };
    return { data: r.data ? [r.data] : [], error: null };
  };
})();

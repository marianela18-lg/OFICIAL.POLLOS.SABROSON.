/* =========================================================
   Pollos Sabroson — data.js

   Catálogo de respaldo, opciones fijas y utilidades de formato.
   Si Supabase responde, el menú se arma con los datos reales;
   si no, el sitio sigue funcionando con este catálogo local.
   ========================================================= */
(function () {
  "use strict";

  /* ---------- Imágenes de referencia ---------- */
  var IMG = {
    hero: "./assets/hero-pollos-sabroson.jpg",
    brasa: "./assets/products/brasa-entero.jpg",
    crispy: "./assets/products/broaster-entero.jpg",
    combos: "./assets/food/lomito.jpg",
    sides: "./assets/food/hamburguesa.jpg"
  };

  /* ---------- Presa preferida ---------- */
  var PRESAS = [
    { value: "", label: "Sin preferencia" },
    { value: "pecho", label: "Pecho" },
    { value: "contra", label: "Contra" },
    { value: "ala", label: "Ala" },
    { value: "pierna", label: "Pierna" }
  ];

  function presaLabel(value) {
    var found = PRESAS.filter(function (p) {
      return p.value === value;
    })[0];
    return found ? found.label : "Sin preferencia";
  }

  /* ---------- Acompañantes ---------- */
  var ADDONS = ["Soda", "Ensalada", "Sin acompañante"];

  /* ---------- Categorías visibles ---------- */
  var CATEGORIAS = [
    { name: "Pollo a la brasa", filtro: "Brasa", count: "03 opciones", image: IMG.brasa, tone: "tomato" },
    { name: "Pollo broaster", filtro: "Broaster", count: "04 opciones", image: IMG.crispy, tone: "gold" },
    { name: "Lomito", filtro: "Lomito", count: "02 opciones", image: IMG.combos, tone: "olive" },
    { name: "Hamburguesa", filtro: "Hamburguesa", count: "02 opciones", image: IMG.sides, tone: "cream" }
  ];

  var FILTROS = ["Todos", "Brasa", "Broaster", "Lomito", "Hamburguesa", "Bebidas"];

  /* ---------- Enlaces de navegación ---------- */
  var NAV_LINKS = [
    ["Inicio", "#inicio"],
    ["Menú", "#menu"],
    ["Favoritos", "#favoritos"],
    ["Ubicación", "#ubicacion"]
  ];

  /* ---------- Catálogo de respaldo (11 productos) ---------- */
  var FALLBACK = [
    {
      id: "brasa-economico",
      name: "Pollo a la brasa económico",
      description: "La opción sabrosa y rendidora de la casa.",
      price: 28,
      category: "Brasa",
      image: "./assets/products/brasa-economico.jpg",
      portions: ["Económico"],
      addons: ADDONS,
      accent: "tomato"
    },
    {
      id: "brasa-cuarto",
      name: "Pollo a la brasa cuarto",
      description: "Cuarto de pollo jugoso, recién salido de la brasa.",
      price: 35,
      category: "Brasa",
      image: "./assets/products/brasa-cuarto.jpg",
      portions: ["Cuarto"],
      addons: ADDONS,
      accent: "tomato"
    },
    {
      id: "brasa-entero",
      name: "Pollo a la brasa entero",
      description: "Nuestro pollo entero, marinado con hierbas de la casa.",
      price: 78,
      category: "Brasa",
      image: "./assets/products/brasa-entero.jpg",
      badge: "Favorito",
      portions: ["Entero"],
      addons: ADDONS,
      accent: "tomato"
    },
    {
      id: "broaster-economico",
      name: "Pollo broaster económico",
      description: "Crujiente, dorado y perfecto para un antojo rápido.",
      price: 25,
      category: "Broaster",
      image: "./assets/products/broaster-economico.jpg",
      portions: ["Económico"],
      addons: ADDONS,
      accent: "gold"
    },
    {
      id: "broaster-cuarto",
      name: "Pollo broaster cuarto",
      description: "Cuarto de pollo broaster con nuestro toque especial.",
      price: 32,
      category: "Broaster",
      image: "./assets/products/broaster-cuarto.jpg",
      portions: ["Cuarto"],
      addons: ADDONS,
      accent: "gold"
    },
    {
      id: "broaster-medio",
      name: "Pollo broaster medio",
      description: "Media porción crujiente para compartir o disfrutar solo.",
      price: 48,
      category: "Broaster",
      image: "./assets/products/broaster-medio.jpg",
      portions: ["Medio"],
      addons: ADDONS,
      accent: "gold"
    },
    {
      id: "broaster-entero",
      name: "Pollo broaster entero",
      description: "Pollo broaster entero, dorado al momento.",
      price: 82,
      category: "Broaster",
      image: "./assets/products/broaster-entero.jpg",
      badge: "Más pedido",
      portions: ["Entero"],
      addons: ADDONS,
      accent: "gold"
    },
    {
      id: "lomito-papas",
      name: "Lomito con papas",
      description: "Lomito sazonado, jugoso y servido con papas doradas.",
      price: 45,
      category: "Lomito",
      image: "./assets/products/lomito-con-papas.jpg",
      portions: ["Con papas"],
      addons: ADDONS,
      accent: "olive"
    },
    {
      id: "lomito-sin-papas",
      name: "Lomito sin papas",
      description: "Lomito de la casa para disfrutar sin papas.",
      price: 38,
      category: "Lomito",
      image: "./assets/products/lomito-sin-papas.jpg",
      portions: ["Sin papas"],
      addons: ADDONS,
      accent: "olive"
    },
    {
      id: "hamburguesa-papas",
      name: "Hamburguesa con papas",
      description: "Hamburguesa sabrosa con papas doradas de la casa.",
      price: 32,
      category: "Hamburguesa",
      image: "./assets/products/hamburguesa-con-papas.jpg",
      portions: ["Con papas"],
      addons: ADDONS,
      accent: "cream"
    },
    {
      id: "hamburguesa-sin-papas",
      name: "Hamburguesa sin papas",
      description: "Hamburguesa casera, preparada sin papas.",
      price: 26,
      category: "Hamburguesa",
      image: "./assets/products/hamburguesa-sin-papas.jpg",
      portions: ["Sin papas"],
      addons: ADDONS,
      accent: "cream"
    }
  ];

  /* ---------- Utilidades ---------- */

  /** Precio en bolivianos, sin decimales: "Bs. 28" */
  function formatPrice(n) {
    return "Bs. " + Number(n || 0).toFixed(0);
  }

  /** Convierte la categoría de la base de datos al nombre visible. */
  function normalizeCategory(raw) {
    var c = String(raw || "brasa").toLowerCase();
    if (c === "broaster") return "Broaster";
    if (c === "lomito") return "Lomito";
    if (c === "hamburguesa" || c === "hamburguesas") return "Hamburguesa";
    if (c === "bebida" || c === "bebidas") return "Bebidas";
    return "Brasa";
  }

  /** Categoría visible -> clave que guarda la base de datos. */
  function categoryKey(visible) {
    var c = String(visible || "").toLowerCase();
    if (c === "broaster") return "broaster";
    if (c === "lomito") return "lomito";
    if (c === "hamburguesa") return "hamburguesa";
    if (c === "bebida" || c === "bebidas") return "bebida";
    return "brasa";
  }

  /** Color de acento según la categoría. */
  function accentFor(category) {
    if (category === "Broaster") return "gold";
    if (category === "Lomito") return "olive";
    if (category === "Hamburguesa") return "cream";
    if (category === "Bebidas") return "gold";
    return "tomato";
  }

  /* ---------- Fotos propias de cada producto ----------
     Nombre del producto (en minúsculas y sin tildes) -> archivo en
     assets/products/. Así, aunque la base de datos apunte a otra ruta
     vieja, se ve la foto correcta. Si subes una imagen desde el admin
     (queda como https://...), esa siempre tiene prioridad. */
  var FOTOS_LOCALES = {
    "pollo a la brasa economico": "brasa-economico",
    "pollo a la brasa cuarto": "brasa-cuarto",
    "pollo a la brasa entero": "brasa-entero",
    "pollo broaster economico": "broaster-economico",
    "pollo broaster cuarto": "broaster-cuarto",
    "pollo broaster medio": "broaster-medio",
    "pollo broaster entero": "broaster-entero",
    "lomito con papas": "lomito-con-papas",
    "lomito sin papas": "lomito-sin-papas",
    "hamburguesa con papas": "hamburguesa-con-papas",
    "hamburguesa sin papas": "hamburguesa-sin-papas"
  };

  function claveNombre(nombre) {
    return String(nombre || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Devuelve la imagen final de un producto (fila de Supabase o del respaldo). */
  function imagenDe(row) {
    var url = String((row && (row.imagen_url || row.image)) || "").trim();
    if (/^(https?:)?\/\//i.test(url) || url.indexOf("data:") === 0) return url; // subida desde el admin
    var slug = FOTOS_LOCALES[claveNombre(row && (row.nombre || row.name))];
    if (slug) return "./assets/products/" + slug + ".jpg";
    return url ? (url.indexOf("./") === 0 ? url : normalizeAssetPath(url)) : IMG.hero;
  }

  /** Foto local de un producto según su nombre (o null si no hay). */
  function fotoPorNombre(nombre) {
    var slug = FOTOS_LOCALES[claveNombre(nombre)];
    return slug ? "./assets/products/" + slug + ".jpg" : null;
  }

  /** Convierte una fila de la tabla `productos` al formato que usa la tienda. */
  function mapProduct(row) {
    var category = normalizeCategory(row.categoria || row.category);
    var porcion = row.tamano_etiqueta || "Porción de la casa";

    return {
      id: row.id,
      name: row.nombre || row.name || "Producto Sabroson",
      description: row.descripcion || row.description || "Preparado al momento con el sabor de la casa.",
      price: Number(row.precio != null ? row.precio : row.price || 0),
      category: category,
      image: imagenDe(row),
      badge: row.etiqueta || row.badge || undefined,
      stock: row.stock != null ? Number(row.stock) : null,
      portions: [porcion],
      // Las bebidas no llevan "para acompañar"
      addons: category === "Bebidas" ? [] : ADDONS,
      accent: accentFor(category)
    };
  }

  /**
   * El schema.sql guarda rutas como "/assets/products/x.jpg".
   * Las convertimos a rutas relativas para que el sitio funcione
   * también dentro de un subdirectorio (por ejemplo, GitHub Pages).
   */
  function normalizeAssetPath(path) {
    if (!path) return IMG.hero;
    // Imágenes subidas desde el admin (URL de Supabase Storage) o cualquier URL completa
    if (/^(https?:)?\/\//i.test(path) || path.indexOf("data:") === 0 || path.indexOf("blob:") === 0) return path;
    if (path.indexOf("/assets/") === 0) return "." + path;
    if (path.indexOf("./") === 0 || path.indexOf("assets/") === 0) return path;
    return IMG.hero;
  }

  window.PS_DATA = {
    IMG: IMG,
    PRESAS: PRESAS,
    ADDONS: ADDONS,
    CATEGORIAS: CATEGORIAS,
    FILTROS: FILTROS,
    NAV_LINKS: NAV_LINKS,
    FALLBACK: FALLBACK,
    presaLabel: presaLabel,
    formatPrice: formatPrice,
    normalizeCategory: normalizeCategory,
    categoryKey: categoryKey,
    accentFor: accentFor,
    mapProduct: mapProduct,
    normalizeAssetPath: normalizeAssetPath,
    imagenDe: imagenDe,
    fotoPorNombre: fotoPorNombre
  };
})();

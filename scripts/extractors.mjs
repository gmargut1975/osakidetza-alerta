// scripts/extractors.mjs
//
// Extractores de avisos con plazo de las fuentes oficiales de Osakidetza.
// Funciones puras (texto/HTML de entrada -> avisos normalizados de salida):
// no hacen peticiones de red, de modo que se pueden probar con fragmentos
// fijos y reutilizar tal cual en cualquier entorno JavaScript.
//
// Formato de aviso normalizado (lo que consume index.html):
//   id          identificador estable (no depende del orden en la página)
//   src         clave de la fuente (ver data/sources.json)
//   process     proceso (OPE, Traslados, Comisiones de servicios, ...)
//   kind        trámite (Solicitud, Recurso de alzada, Reclamación, ...)
//   title       título legible
//   org         organización (OSI, Dirección General, ...) si consta
//   categories  categorías / puestos funcionales afectados
//   published   fecha de publicación (AAAA-MM-DD)
//   start, end  inicio y fin del plazo (AAAA-MM-DD) o "" si no consta
//   estimated   true si el fin de plazo se ha calculado (no figura literal)
//   literal     frase oficial que fija el plazo
//   summary     extracto breve del aviso
//   url         enlace al documento o al punto exacto de la página oficial

export const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTH_NAMES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTH_RE = "(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";

// ---------------------------------------------------------------- utilidades

export function fold(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function stableHash(value) {
  // FNV-1a de 32 bits, en base 36: corto, estable y sin dependencias.
  let hash = 0x811c9dc5;
  const text = String(value ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function isoOf(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function humanDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTH_NAMES[m]} de ${y}`;
}

const NAMED_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", middot: "·", ordf: "ª", ordm: "º",
  laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", bull: "•", euro: "€", iexcl: "¡", iquest: "¿", deg: "°",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü", Ccedil: "Ç",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü", ccedil: "ç",
  Agrave: "À", Egrave: "È", agrave: "à", egrave: "è", ograve: "ò",
};

export function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const cp = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ""; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, code) ? NAMED_ENTITIES[code] : match;
  });
}

export function stripNoise(html) {
  return String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
}

export function inlineText(html) {
  return decodeEntities(String(html ?? "").replace(/<[^>]+>/g, " "))
    .replace(/[\s ]+/g, " ")
    .trim();
}

// HTML -> líneas de texto (una por bloque: párrafo, elemento de lista, título...)
export function htmlToLines(html) {
  const text = stripNoise(html)
    .replace(/<\s*(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\s*\/?\s*(p|div|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t    ]+/g, " ").trim())
    .filter(Boolean);
}

// Zona de contenido editorial de las páginas de osakidetza.euskadi.eus.
export function editorRegion(html) {
  const source = String(html ?? "");
  const start = source.search(/class="r01-editor"/i);
  if (start < 0) return source;
  const rest = source.slice(start);
  const end = rest.search(/<\/article>|<footer\b|id="r01Footer"|class="r01-footer"/i);
  return end > 0 ? rest.slice(0, end) : rest;
}

const LOWER_WORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "en", "a", "al", "con", "por", "para", "sin"]);
const KEEP_UPPER = new Set(["OSI", "OPE", "UGS", "EAP", "FEM", "F.E.M.", "F.E.", "F.E.T.", "F.T.", "CVTTH", "RSMB", "RSMA", "RSMG", "UAP", "PAC", "BOPV",
  "SAP", "RRHH", "TCAE", "UCI", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII", "CTAP", "BIOEF", "PIT", "ECOFIN", "UGC", "JUAP", "TIC"]);

// "TÉCNICO/A SUPERIOR JURÍDICO/A" -> "Técnico/a Superior Jurídico/a"
export function niceCase(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  const letters = value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
  if (!letters.length || upper / letters.length < 0.6) return value;
  return value.split(" ").map((word, index) => {
    const bare = word.replace(/[()\[\],;:]/g, "");
    if (KEEP_UPPER.has(bare) || /^[A-Z]\.([A-Z]\.)+$/.test(bare) || /^\d/.test(bare)) return word;
    const lower = word.toLocaleLowerCase("es");
    if (index > 0 && LOWER_WORDS.has(lower.replace(/[()]/g, ""))) return lower;
    return lower.replace(/(^|[(\-/"«“])([a-záéíóúüñ])/g, (m, pre, ch) => pre + ch.toLocaleUpperCase("es"))
      .replace(/\/(As|A|Os|O)\b/g, (m) => m.toLowerCase());
  }).join(" ");
}

export function isUpperLine(line) {
  const letters = String(line).replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
  return upper / letters.length >= 0.75;
}

export function cleanBullet(line) {
  return String(line).replace(/^[\s•·\-–—*•·●▪]+/, "").replace(/[\s.;:,*]+$/, "").trim();
}

// ------------------------------------------------------------------- fechas

export function numericDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text).trim());
  return m ? isoOf(Number(m[3]), Number(m[2]), Number(m[1])) : "";
}

// Año probable de una fecha sin año: el más reciente que no quede en el futuro
// respecto a la fecha de referencia (con un margen de una semana).
export function inferPastYear(day, month, todayIso) {
  const year = Number(todayIso.slice(0, 4));
  const candidate = isoOf(year, month, day);
  if (candidate && candidate <= addDays(todayIso, 7)) return candidate;
  return isoOf(year - 1, month, day);
}

// Fecha de fin sin año: la primera que no quede antes de la fecha de referencia.
export function inferFutureYear(day, month, refIso) {
  const year = Number(refIso.slice(0, 4));
  const candidate = isoOf(year, month, day);
  if (candidate && candidate >= refIso) return candidate;
  return isoOf(year + 1, month, day);
}

export function textDate(day, monthName, year, refIso, mode) {
  const month = MONTHS[fold(monthName)];
  if (!month) return "";
  if (year) return isoOf(Number(year), month, Number(day));
  if (!refIso) return "";
  return mode === "past" ? inferPastYear(Number(day), month, refIso) : inferFutureYear(Number(day), month, refIso);
}

const DIA = "(?:d[ií]a\\s+)?";
const DATE_TXT = `(\\d{1,2})\\s+de\\s+${MONTH_RE}(?:\\s+(?:de|del)\\s+(20\\d{2}))?`;
const DATE_NUM = "(\\d{1,2}\\/\\d{1,2}\\/20\\d{2})";

// Busca en un texto todos los plazos expresados con fechas.
// Devuelve [{start, end, sentence}] con fechas ISO.
export function findDeadlines(text, refIso) {
  const value = String(text ?? "").replace(/\s+/g, " ");
  const found = [];
  const used = [];
  const overlaps = (a, b) => used.some(([x, y]) => a < y && b > x);
  const sentenceAt = (index) => {
    const before = value.lastIndexOf(". ", index);
    const from = before < 0 ? 0 : before + 2;
    const after = value.indexOf(". ", index);
    const to = after < 0 ? value.length : after + 1;
    return value.slice(from, to).trim();
  };

  // 1) "desde el 13/10/2026 hasta el 26/10/2026"
  const rangeNum = new RegExp(`(?:desde|del)\\s+(?:el\\s+)?${DIA}${DATE_NUM}\\s+(?:al|hasta(?:\\s+el)?)\\s+${DIA}${DATE_NUM}`, "gi");
  for (const m of value.matchAll(rangeNum)) {
    const start = numericDate(m[1]);
    const end = numericDate(m[2]);
    if (start && end) { found.push({ start, end, sentence: sentenceAt(m.index), index: m.index }); used.push([m.index, m.index + m[0].length]); }
  }

  // 2) "desde el 15 de septiembre al 14 de octubre de 2026" / "del 9 al 29 de septiembre de 2026"
  const rangeTxt = new RegExp(`(?:desde|del)\\s+(?:el\\s+)?${DIA}(\\d{1,2})(?:\\s+de\\s+${MONTH_RE})?(?:\\s+(?:de|del)\\s+(20\\d{2}))?\\s*,?\\s+(?:al|hasta(?:\\s+el)?|y\\s+el)\\s+${DIA}${DATE_TXT}`, "gi");
  for (const m of value.matchAll(rangeTxt)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const [, d1, mon1, y1, d2, mon2, y2] = m;
    const end = textDate(d2, mon2, y2, refIso, "future");
    if (!end) continue;
    const endYear = end.slice(0, 4);
    let start = textDate(d1, mon1 || mon2, y1 || (mon1 ? "" : endYear), refIso, "past");
    if (!y1 && mon1) {
      const month = MONTHS[fold(mon1)];
      start = isoOf(Number(endYear), month, Number(d1));
      if (start > end) start = isoOf(Number(endYear) - 1, month, Number(d1));
    }
    if (start && start <= end) { found.push({ start, end, sentence: sentenceAt(m.index), index: m.index }); used.push([m.index, m.index + m[0].length]); }
  }

  // 3) "hasta el 9 de noviembre de 2026" / "hasta la finalización del día 10 de septiembre de 2026" / "hasta el 26/10/2026"
  const until = new RegExp(`hasta\\s+(?:la\\s+finalizaci[oó]n\\s+del\\s+|el\\s+|las\\s+\\d{1,2}[:.]\\d{2}\\s*h?\\.?\\s+(?:horas\\s+)?del\\s+)?${DIA}(?:${DATE_TXT}|${DATE_NUM})`, "gi");
  for (const m of value.matchAll(until)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const end = m[4] ? numericDate(m[4]) : textDate(m[1], m[2], m[3], refIso, "future");
    if (end) { found.push({ start: "", end, sentence: sentenceAt(m.index), index: m.index }); used.push([m.index, m.index + m[0].length]); }
  }

  // 4) "Último día de presentación de solicitudes: 13 de octubre de 2026" /
  //    "último día para realizar la elección ... es el 30 de septiembre de 2026"
  const lastDay = new RegExp(`[uú]ltimo\\s+d[ií]a[^:.]{0,90}?(?::|\\bes\\s+el|\\bser[aá]\\s+el)\\s*(?:el\\s+)?${DIA}(?:${DATE_TXT}|${DATE_NUM})`, "gi");
  for (const m of value.matchAll(lastDay)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const end = m[4] ? numericDate(m[4]) : textDate(m[1], m[2], m[3], refIso, "future");
    if (end) { found.push({ start: "", end, sentence: sentenceAt(m.index), index: m.index }); used.push([m.index, m.index + m[0].length]); }
  }
  //    "se realizará el día 22 de junio de 2026" (toma de posesión en un único día)
  const single = new RegExp(`(?:se\\s+realizar[aá]|tendr[aá]\\s+lugar|se\\s+celebrar[aá]|ser[aá])\\s+el\\s+${DIA}${DATE_TXT}`, "gi");
  for (const m of value.matchAll(single)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const day = textDate(m[1], m[2], m[3], refIso, "future");
    if (day) { found.push({ start: day, end: day, sentence: sentenceAt(m.index), index: m.index }); used.push([m.index, m.index + m[0].length]); }
  }
  return found.sort((a, b) => a.index - b.index);
}

// ----------------------------------------------------------- clasificación

export function classifyKind(text) {
  const t = fold(text);
  if (/recursos? de alzada/.test(t)) return "Recurso de alzada";
  if (/reclamaci/.test(t)) return "Reclamación";
  if (/alegaci|subsanaci/.test(t)) return "Alegaciones";
  if (/toma de posesion/.test(t)) return "Toma de posesión";
  if (/elecci[oó]n de (los )?destinos|eleccion de destino|elegir destino|oferta de destinos/.test(t)) return "Elección de destinos";
  if (/meritos|requisitos/.test(t)) return "Méritos y requisitos";
  if (/inscripci|solicitudes|solicitud de participaci|presentaci[oó]n de solicitud|izena emateko/.test(t)) return "Solicitud / inscripción";
  if (/fecha de corte/.test(t)) return "Fecha de corte";
  if (/examen|prueba|ejercicio|cuestionario/.test(t)) return "Prueba / examen";
  if (/oferta de interinidad|interinidades|oferta\b/.test(t)) return "Oferta de nombramientos";
  return "Plazo";
}

export const ORG_PATTERNS = [
  /^OSI\b.*/i, /^RED DE SALUD MENTAL\b.*/i, /^DIRECCI[OÓ]N GENERAL\b.*/i, /^EMERGENCIAS\b.*/i,
  /^HOSPITAL\b.*/i, /^CVTTH\b.*/i, /^CENTRO VASCO DE TRANSFUSI.*/i, /^ORGANIZACI[OÓ]N CENTRAL\b.*/i,
  /^BIOEF\b.*/i, /^BIOARABA\b.*/i, /^BIOCRUCES\b.*/i, /^BIODONOSTIA\b.*/i, /^BIOBIZKAIA\b.*/i,
  /^ESCUELA UNIVERSITARIA\b.*/i, /^OSATEK\b.*/i, /^ONKOLOGIKOA\b.*/i, /^GORLIZ\b.*/i,
  /^(?:HOSPITAL )?SANTA MARINA\b.*/i, /^H\. [A-ZÁÉÍÓÚÑ].*/i, /^ZALDIBAR\b.*/i, /^ZAMUDIO\b.*/i,
];
const PHASE_RE = /^(LISTA (?:PROVISIONAL|DEFINITIVA)|CESE|DESIERTA PROVISIONAL|DECLARAD[AO] DESIERT[AO]|DESIERT[AO]|NOMBRAMIENTO|CORRECCI[OÓ]N DE ERRORES|COMISI[OÓ]N DE VALORACI[OÓ]N|ACTUALIZACI[OÓ]N|RESOLUCI[OÓ]N|ADJUDICACI[OÓ]N|ANULACI[OÓ]N|MODIFICACI[OÓ]N|AMPLIACI[OÓ]N)/i;

// ---------------------------------------------- tipo A: listas de enlaces
// Comisiones de servicios, jefaturas y puestos directivos: cada <li> es un
// documento con el texto "PUESTO - ORGANIZACIÓN - [FASE] - Plazo ...:
// abierto desde el dd/mm/aaaa hasta el dd/mm/aaaa, ambos inclusive."

export function extractLinkList(html, source, todayIso) {
  const region = stripNoise(editorRegion(html));
  const items = [];
  const seen = new Set();
  for (const m of region.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const inner = m[1];
    const text = inlineText(inner);
    if (!/\d{1,2}\/\d{1,2}\/20\d{2}/.test(text)) continue;
    const deadlines = findDeadlines(text, todayIso);
    if (!deadlines.length) continue;
    const { start, end, sentence } = deadlines[deadlines.length - 1];
    const href = (/href="([^"]+)"/i.exec(inner) || [])[1] || "";
    const url = href ? absoluteUrl(decodeEntities(href), source.url) : source.url;

    const parts = splitOutsideParens(text);
    const plazoAt = parts.findIndex((part) => /^plazo\b/i.test(part));
    const head = plazoAt > 0 ? parts.slice(0, plazoAt) : parts.slice(0, 1);
    const plazo = plazoAt >= 0 ? parts.slice(plazoAt).join(" - ") : sentence;
    const { puesto, org, phases } = splitHead(head);
    const kind = classifyKind(plazo);
    const key = `${source.key}|${url}|${start}|${end}|${puesto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = niceCase(puesto) + (phases.length ? ` · ${phases.map(niceCase).join(" · ")}` : "");
    items.push({
      id: `${source.key}-${stableHash(key)}`,
      src: source.key,
      process: source.process,
      kind,
      title,
      org: niceCase(org),
      categories: categoriesFromPuesto(puesto),
      published: start || "",
      start: start || "",
      end,
      estimated: false,
      literal: plazo.replace(/\s+/g, " ").trim(),
      summary: text,
      url,
    });
  }
  return items;
}

// Divide por " - " / " – " sin romper lo que va entre paréntesis.
export function splitOutsideParens(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  const value = String(text ?? "");
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(ch) && /[-–]/.test(value[i + 1] || "") && /\s/.test(value[i + 2] || "")) {
      parts.push(current.trim());
      current = "";
      i += 2;
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

const PREFIX_PHASE_RE = /^(actualizaci[oó]n|correcci[oó]n de errores|modificaci[oó]n|ampliaci[oó]n|anulaci[oó]n)\s*:\s*/i;

// Separa "PUESTO - [PUESTO] - ORGANIZACIÓN - [FASE]" en sus partes.
export function splitHead(head) {
  const parts = head.map((part) => part.trim()).filter(Boolean);
  const phases = [];
  const orgAt = parts.findIndex((part, index) => index > 0 && ORG_PATTERNS.some((re) => re.test(part)));
  const before = orgAt > 0 ? parts.slice(0, orgAt) : parts;
  const after = orgAt > 0 ? parts.slice(orgAt + 1) : [];
  const puestoParts = [];
  before.forEach((part, index) => {
    let value = part;
    const prefix = PREFIX_PHASE_RE.exec(value);
    if (prefix) { phases.push(prefix[1]); value = value.slice(prefix[0].length); }
    if (index > 0 && PHASE_RE.test(value)) phases.push(value);
    else if (value) puestoParts.push(value);
  });
  return { puesto: puestoParts.join(" – "), org: orgAt > 0 ? parts[orgAt] : "", phases: [...phases, ...after] };
}

// "TÉCNICO/A RESPONSABLE DE ÁREA CORPORATIVA - ..." / "VARIAS CATEGORÍAS"
export function categoriesFromPuesto(puesto) {
  const value = String(puesto ?? "").replace(/\s+/g, " ").trim();
  if (!value) return [];
  if (/^varias categor/i.test(value)) return ["Varias categorías"];
  const specific = value.split(/\s+–\s+/).pop();
  const withoutDetail = specific.replace(/\s*\((?:[^()]*)\)\s*/g, " ").trim();
  const pieces = withoutDetail.split(/\s+y\s+(?=[A-ZÁÉÍÓÚÑ]{3,})|,\s*(?=[A-ZÁÉÍÓÚÑ]{3,})/);
  return [...new Set(pieces.map((p) => niceCase(p.trim())).filter((p) => p.length > 2))].slice(0, 6);
}

export function absoluteUrl(href, base) {
  try { return new URL(href, base).href; } catch { return base; }
}

// ------------------------------------------------- tipo B: avisos fechados
// Páginas de OPE, contratación temporal y desarrollo profesional: cada aviso
// empieza con "Hoy, día 9 de octubre de 2026 ...", "Con fecha ...",
// "El día ... se han publicado ..." o "En el BOPV del día ...", va precedido
// normalmente de un titular en mayúsculas y contiene sus plazos en el texto.

const ANCHOR_RE = new RegExp(`^(?:[-•·*\\s]*)(?:hoy|ayer|con fecha|el d[ií]a|en el bopv del d[ií]a|en el bolet[ií]n oficial del pa[ií]s vasco del d[ií]a)\\s*,?\\s*(?:d[ií]a\\s+)?(\\d{1,2})\\s+de\\s+${MONTH_RE}(?:\\s+(?:de|del)\\s+(20\\d{2}))?`, "i");
const MARK_RE = /^[¡!]*\s*(aviso|aviso importante|avisos|novedad|novedades|importante)\s*[!:.]*$/i;
const INTRO_RE = /^(la direcci[oó]n|en relaci[oó]n|se informa|osakidetza informa|se comunica|se pone en conocimiento|se recuerda|con el objeto de informar)/i;
const SECTION_END_RE = /^(documentos de inter[eé]s|documentos de ayuda|contacto|enlaces de inter[eé]s|normativa aplicable|legislaci[oó]n)\s*:?$/i;
const NOISE_HEADER_RE = /^[¡!]*\s*(aviso importante|avisos?|novedades?|importante)\s*[!:.]*$/i;

function lineType(line) {
  if (MARK_RE.test(line)) return "mark";
  if (ANCHOR_RE.test(line)) return "anchor";
  if (SECTION_END_RE.test(cleanBullet(line))) return "end";
  if (isUpperLine(line) && line.length <= 200 && !/^[•·\-–*\u2022\u00b7]/.test(line)) return "header";
  return "other";
}

// Divide el texto de una página en avisos. Un aviso empieza en una marca
// ("¡AVISO!"), en un titular seguido de su fecha o de una frase de
// introducción, o en una nueva frase fechada cuando el aviso actual ya tenía
// la suya. Las listas de categorías en mayúsculas que siguen a la fecha se
// quedan dentro del aviso.
export function segmentAnnouncements(lines, todayIso) {
  const types = lines.map((line) => lineType(line.trim()));
  const blocks = [];
  let current = null;
  const open = (index, headers = []) => {
    current = { headers, lines: [], anchorAt: -1, published: "" };
    blocks.push(current);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const type = types[i];
    if (type === "end") { current = null; continue; }
    if (type === "mark") {
      open(i);
      const next = (lines[i + 1] || "").trim();
      if (next && types[i + 1] !== "anchor" && types[i + 1] !== "mark" && next.length <= 220) {
        current.headers.push(next);
        i += 1;
      }
      continue;
    }
    if (type === "header" && (!current || current.anchorAt >= 0 || current.lines.length > 0)) {
      const prevType = i > 0 ? types[i - 1] : "other";
      let startsBlock = false;
      for (let k = i + 1; k <= i + 4 && k < lines.length; k += 1) {
        if (types[k] === "anchor") { startsBlock = true; break; }
        if (types[k] === "other" && INTRO_RE.test(lines[k].trim())) { startsBlock = true; break; }
        if (types[k] !== "header") break;
      }
      if (startsBlock && prevType !== "header") {
        open(i, [line]);
        continue;
      }
      if (startsBlock && prevType === "header" && current && current.lines.length === 0) {
        current.headers.push(line);
        continue;
      }
    }
    if (type === "anchor") {
      const followUp = current && current.anchorAt >= 0 && /^en el (bopv|bolet)/i.test(line)
        && current.lines.length - current.anchorAt <= 3;
      const tooFar = current && current.anchorAt < 0 && current.lines.length > 4;
      if (followUp) { current.lines.push(line); continue; }
      if (!current || current.anchorAt >= 0 || tooFar) open(i);
      const m = ANCHOR_RE.exec(line);
      current.anchorAt = current.lines.length;
      current.published = textDate(m[1], m[2], m[3], todayIso, "past");
    }
    if (current) current.lines.push(line);
  }
  return blocks.filter((block) => block.lines.length);
}

// Plazos de un aviso: se buscan línea a línea (cada línea es un párrafo, así
// la frase literal es la del propio párrafo) y se descartan fechas absurdas
// respecto a la publicación (de otros avisos o de normativa citada).
export function deadlinesOfLines(lines, published) {
  const max = addDays(published, 240);
  const min = addDays(published, -45);
  return lines.flatMap((line) => findDeadlines(line, published).map((d) => ({ ...d, sentence: truncate(line, 360) })))
    .filter((d) => d.end >= published && d.end <= max && (!d.start || d.start >= min));
}

export function extractAnnouncements(html, source, todayIso) {
  const lines = htmlToLines(editorRegion(html));
  const blocks = segmentAnnouncements(lines, todayIso);
  const items = [];
  const seen = new Set();
  blocks.forEach((block) => {
    // Sin frase fechada: la fecha de referencia es el inicio del primer plazo.
    let published = block.published;
    let relevant;
    if (published) {
      relevant = deadlinesOfLines(block.lines, published);
    } else {
      const raw = block.lines.flatMap((line) => findDeadlines(line, todayIso).map((d) => ({ ...d, sentence: truncate(line, 360) })));
      const firstStart = raw.map((d) => d.start).filter(Boolean).sort()[0];
      if (!firstStart) return;
      published = firstStart;
      relevant = deadlinesOfLines(block.lines, published);
    }
    const categories = [];
    block.lines.forEach((line, index) => {
      if (index <= Math.max(0, block.anchorAt)) return;
      const clean = cleanBullet(line);
      const bullet = /^[•·\-–*\u2022\u00b7]/.test(line.trim());
      if (clean.length < 3 || clean.length > 120) return;
      if (/^(plazo|hoy|con fecha|para |m[aá]s informaci|nota|recuerda|importante|aviso|acceso)/i.test(clean)) return;
      if ((bullet && clean.length <= 120) || (isUpperLine(clean) && !/\d{4}/.test(clean))) categories.push(niceCase(clean));
    });
    const headerTitle = block.headers
      .map((h) => niceCase(cleanBullet(h)).replace(/[:.]$/, ""))
      .filter((h) => h && !NOISE_HEADER_RE.test(h))
      .join(" · ");
    const lead = block.lines[Math.max(0, block.anchorAt)] || block.lines[0];
    const firstSentence = lead.split(/(?<=[.:])\s/)[0];
    const title = headerTitle || truncate(firstSentence, 150);
    // Un aviso puede fijar varios trámites distintos (p. ej. reclamación y
    // alegación de méritos): uno por trámite, con el fin de plazo más tardío.
    const byKind = new Map();
    relevant.forEach((d) => {
      const kind = classifyKind(d.sentence);
      const prev = byKind.get(kind);
      if (!prev || d.end > prev.end) byKind.set(kind, { ...d, kind, starts: [...(prev?.starts || []), d.start].filter(Boolean) });
      else prev.starts.push(d.start);
    });
    const guess = classifyKind(`${headerTitle} ${firstSentence}`);
    const variants = byKind.size ? [...byKind.values()] : [{ kind: guess === "Plazo" ? "Publicación" : guess, end: "", start: "", sentence: "", starts: [] }];
    variants.forEach((variant) => {
      const key = `${source.key}|${published}|${variant.end}|${variant.kind}|${title}|${categories.slice(0, 3).join(",")}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        id: `${source.key}-${stableHash(key)}`,
        src: source.key,
        process: source.process,
        kind: variant.kind,
        title,
        org: "",
        categories: [...new Set(categories)].slice(0, 30),
        published,
        start: variant.end ? ([...variant.starts].sort()[0] || published) : "",
        end: variant.end,
        estimated: false,
        literal: variant.sentence,
        summary: truncate(block.lines.join(" "), 420),
        url: textFragmentUrl(source.url, lead),
      });
    });
  });
  return items;
}

export function truncate(text, max) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trim()}…`;
}

// Enlace con fragmento de texto (#:~:text=) para saltar al aviso exacto.
export function textFragmentUrl(pageUrl, line) {
  const words = cleanBullet(line).replace(/[,;:]+/g, (m) => m).split(/\s+/).slice(0, 7).join(" ").replace(/[,.;:]+$/, "");
  if (!words) return pageUrl;
  return `${pageUrl.split("#")[0]}#:~:text=${encodeURIComponent(words).replace(/-/g, "%2D")}`;
}

// ---------------------------------------- lan poltsa (API JSON pública)

export function extractLanpoltsa(list, source, todayIso) {
  if (!Array.isArray(list)) return [];
  return list.map((aviso) => {
    const title = niceCase(String(aviso.tituloES || "").trim());
    const body = String(aviso.resumenES || "").replace(/\r/g, "");
    const published = /^\d{4}-\d{2}-\d{2}$/.test(aviso.fechaInicio || "") ? aviso.fechaInicio : "";
    if (!published || !title) return null;
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const deadlines = deadlinesOfLines(lines, published);
    const chosen = deadlines.length ? deadlines.reduce((a, b) => (b.end > a.end ? b : a)) : null;
    const categories = lines
      .slice(1)
      .map(cleanBullet)
      .filter((l) => l.length >= 3 && l.length <= 120 && isUpperLine(l) && !/\d{4}/.test(l))
      .map(niceCase);
    const isOffer = /interinidad|oferta|eskaintza/i.test(`${aviso.tituloES} ${body}`) && !/listas? (provisional|definitiva)/i.test(aviso.tituloES || "");
    const kind = chosen ? classifyKind(chosen.sentence) : isOffer ? "Oferta de nombramientos" : "Publicación";
    return {
      id: `lanpoltsa-${aviso.id}`,
      src: source.key,
      process: isOffer ? "Interinidades y ofertas de nombramiento" : "Listas de contratación temporal",
      kind,
      title,
      org: "",
      categories: [...new Set(categories)].slice(0, 30),
      published,
      start: chosen ? (chosen.start || published) : "",
      end: chosen ? chosen.end : "",
      estimated: false,
      literal: chosen ? chosen.sentence : isOffer ? "Plazos y condiciones en el área privada de Listas de contratación temporal." : "",
      summary: truncate(body.replace(/\n+/g, " "), 420),
      url: source.publicUrl || source.url,
    };
  }).filter(Boolean);
}

// ------------------------------------------------------------------ BOPV

const WEEKDAYS_RE = "(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)";

export function bopvBulletinDate(html) {
  const text = inlineText(stripNoise(html));
  const m = new RegExp(`${WEEKDAYS_RE}\\s*,?\\s*(\\d{1,2})\\s+de\\s+${MONTH_RE}\\s+de\\s+(20\\d{2})`, "i").exec(text);
  return m ? textDate(m[1], m[2], m[3], "", "past") : "";
}

// Entradas de Osakidetza del sumario de un boletín.
export function bopvSummaryEntries(html, pageUrl) {
  const source = stripNoise(html);
  const entries = [];
  let organism = "";
  const re = /<h5[^>]*class="BOPVSumarioOrganismo"[^>]*>([\s\S]*?)<\/h5>|<p[^>]*class="BOPVSumarioTitulo"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of source.matchAll(re)) {
    if (m[1] !== undefined) {
      const name = inlineText(m[1]);
      if (name) organism = name;
      continue;
    }
    const title = inlineText(m[3]);
    if (/osakidetza/i.test(organism) || /osakidetza/i.test(title)) {
      entries.push({ title, url: absoluteUrl(decodeEntities(m[2]), pageUrl) });
    }
  }
  return entries;
}

export function classifyBopv(title) {
  const t = fold(title);
  if (/concurso de traslados/.test(t)) return "Traslados";
  if (/desarrollo profesional/.test(t)) return "Desarrollo profesional";
  if (/listas? de contratacion|contratacion temporal/.test(t)) return "Listas de contratación temporal";
  if (/libre designacion|concurso de meritos|jefatura/.test(t)) return "Jefaturas (libre designación / concurso de méritos)";
  if (/comision de servicios/.test(t)) return "Comisiones de servicios";
  if (/movilidad interna/.test(t)) return "Movilidad interna";
  if (/dificil cobertura/.test(t)) return "OPE Difícil Cobertura Primaria";
  if (/oferta publica de empleo|proceso selectivo|bases (generales|especificas)|concurso-oposicion|ope\b|personal estatutario fijo|aspirantes|aprobad|tribunal calificador/.test(t)) {
    if (/2023[^0-9]+2024[^0-9]+2025|2023-2024-2025/.test(t)) return "OPE 2023-2024-2025";
    if (/2020[^0-9]+2021[^0-9]+2022|2020-2021-2022/.test(t)) return "OPE 2020-2021-2022";
    if (/estabilizacion/.test(t)) return "OPE Estabilización";
    return "OPE (BOPV)";
  }
  return "Otras resoluciones de Osakidetza (BOPV)";
}

export function addMonthsClamped(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return isoOf(ty, tm, Math.min(d, last));
}

// Fines de semana y festivos (estatales y de la Comunidad Autónoma de Euskadi)
// para estimar plazos en días hábiles. Si una fecha no figura aquí, el plazo se
// marca igualmente como "estimado" para que se compruebe en la resolución.
export const HOLIDAYS = new Set([
  "2025-12-08", "2025-12-25",
  "2026-01-01", "2026-01-06", "2026-03-19", "2026-04-02", "2026-04-03", "2026-04-06", "2026-05-01",
  "2026-07-25", "2026-08-15", "2026-10-12", "2026-12-08", "2026-12-25",
  "2027-01-01", "2027-01-06", "2027-03-19", "2027-03-25", "2027-03-26", "2027-03-29", "2027-05-01",
  "2027-07-25", "2027-08-15", "2027-10-12", "2027-11-01", "2027-12-06", "2027-12-08", "2027-12-25",
]);

export function isBusinessDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day !== 0 && day !== 6 && !HOLIDAYS.has(iso);
}

export function addBusinessDays(iso, count) {
  let current = iso;
  let left = count;
  while (left > 0) {
    current = addDays(current, 1);
    if (isBusinessDay(current)) left -= 1;
  }
  return current;
}

export function nextBusinessDay(iso) {
  let current = iso;
  while (!isBusinessDay(current)) current = addDays(current, 1);
  return current;
}

const NUMBER_WORDS = { diez: 10, quince: 15, veinte: 20, treinta: 30, cinco: 5, tres: 3, siete: 7 };

// Plazo de una resolución del BOPV a partir de su texto completo.
export function bopvDeadline(bodyText, published) {
  const text = String(bodyText ?? "").replace(/\s+/g, " ");
  const explicit = findDeadlines(text, published).filter((d) => d.end >= published);
  if (explicit.length) {
    const chosen = explicit.reduce((a, b) => (b.end > a.end ? b : a));
    return { start: chosen.start || published, end: chosen.end, estimated: false, literal: chosen.sentence, kind: classifyKind(chosen.sentence) };
  }
  const habiles = /plazo[^.]{0,80}?\bde (\d+|diez|quince|veinte|treinta|cinco|tres|siete) d[ií]as h[aá]biles[^.]{0,160}?(?:siguiente|a partir)[^.]{0,120}publicaci[oó]n/i.exec(text);
  if (habiles) {
    const n = Number(habiles[1]) || NUMBER_WORDS[fold(habiles[1])];
    if (n) {
      return { start: addDays(published, 1), end: addBusinessDays(published, n), estimated: true, literal: `${sentenceAround(text, habiles.index)} (fecha final calculada: ${n} días hábiles desde el día siguiente a la publicación; compruébala en la resolución).`, kind: classifyKind(sentenceAround(text, habiles.index)) };
    }
  }
  const month = /(recurso de alzada|reclamaci[oó]n)[^.]{0,200}?plazo de (un|1) mes[^.]{0,200}?(?:siguiente|a partir)[^.]{0,80}publicaci[oó]n|plazo de (un|1) mes[^.]{0,160}?(?:siguiente|a partir)[^.]{0,80}publicaci[oó]n[^.]{0,120}?(recurso de alzada|reclamaci[oó]n)/i.exec(text);
  if (month) {
    const sentence = sentenceAround(text, month.index);
    const end = nextBusinessDay(addMonthsClamped(published, 1));
    return { start: addDays(published, 1), end, estimated: true, literal: `${sentence} (fecha final calculada: un mes desde el día siguiente a la publicación; compruébala en la resolución).`, kind: classifyKind(sentence) };
  }
  return null;
}

function sentenceAround(text, index) {
  const before = text.lastIndexOf(". ", index);
  const after = text.indexOf(". ", index);
  return text.slice(before < 0 ? 0 : before + 2, after < 0 ? text.length : after + 1).trim();
}

// Qué hacer con cada resolución de Osakidetza publicada en el BOPV:
//  - keep: false para lo que ya cubren las páginas de Osakidetza con fechas
//    exactas (jefaturas, puestos directivos) o no fija plazos para el
//    personal (ceses, nombramientos individuales, mesas de contratación).
//  - estimateMonth: si se puede estimar el mes del recurso de alzada cuando
//    la resolución no fija una fecha (solo donde ese recurso es lo relevante).
export function bopvPolicy(title) {
  const t = fold(title);
  const drop = /\bcesa\b|\bcese\b|mesa de contratacion|libre designacion|provision(,)? mediante (el sistema de )?concurso|provision[^.]{0,60}?puestos?|convocatoria publica para la provision|nombra temporalmente|efectua el nombramiento de (la|el) jef|se nombra (al|a la) (director|directora|subdirector|subdirectora|jef)|declara desierta la convocatoria para la (seleccion|provision)/;
  if (drop.test(t) && !/concurso de traslados/.test(t)) return { keep: false, process: classifyBopv(title), estimateMonth: false, noDeadline: false };
  const process = /emplaza/.test(t) ? "Recursos judiciales (emplazamientos)" : classifyBopv(title);
  const informative = /tribunal calificador|se da publicidad al contenido/.test(t);
  const estimateMonth = /concurso de traslados/.test(t) ? /admitidas y excluidas|asignacion (provisional|definitiva)|adjudicacion/.test(t)
    : /relacion(es)? (definitiva|de aprobad)|adjudicaci|aprobad|admitid/.test(t);
  return { keep: true, process, estimateMonth, noDeadline: informative };
}

export function bopvItem(entry, published, bodyText, sourceKey) {
  const title = entry.title.replace(/\s+/g, " ").trim();
  const policy = bopvPolicy(title);
  if (!policy.keep) return null;
  let deadline = !policy.noDeadline && bodyText ? bopvDeadline(bodyText, published) : null;
  if (deadline && deadline.estimated && /un mes desde/.test(deadline.literal) && !policy.estimateMonth) deadline = null;
  if (!deadline && !policy.noDeadline && /emplaza/i.test(title) && bodyText) {
    const nine = /(nueve|9) d[ií]as/i.exec(bodyText);
    if (nine) deadline = { start: addDays(published, 1), end: addBusinessDays(published, 9), estimated: true, kind: "Emplazamiento", literal: `${sentenceAround(String(bodyText).replace(/\s+/g, " "), nine.index)} (fecha final calculada: nueve días hábiles desde el día siguiente a la publicación; compruébala en la resolución).` };
  }
  // Resoluciones generales sin plazo (nombramientos de personas concretas,
  // edictos, tarifas, delegaciones...): no son plazos para el personal.
  if (!deadline && policy.process.startsWith("Otras")) return null;
  const category = bopvCategory(title);
  return {
    id: `bopv-${stableHash(entry.url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/web01-bopv\/es/, ""))}`,
    src: sourceKey,
    process: policy.process,
    kind: deadline ? deadline.kind : "Publicación",
    title: bopvShortTitle(title),
    org: bopvOrg(title),
    categories: category ? [category] : [],
    published,
    start: deadline ? deadline.start : "",
    end: deadline ? deadline.end : "",
    estimated: deadline ? deadline.estimated : false,
    literal: deadline ? truncate(deadline.literal, 600) : "",
    summary: truncate(title, 420),
    url: entry.url,
  };
}

export function bopvOrg(title) {
  const m = /(Organizaci[oó]n Sanitaria Integrada [A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ-]*(?:[- ][A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ-]*)*|Red de Salud Mental de (?:Araba|Bizkaia|Gipuzkoa)|Hospital [A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ-]*)/.exec(title);
  return m ? m[1].replace(/^Organizaci[oó]n Sanitaria Integrada/, "OSI") : "";
}

export function bopvCategory(title) {
  const m = /categor[ií]a\/puesto funcional de ([^,.;]+?)(?:,| del grupo| de la categor| en las organizaciones| con destino|\.|$)/i.exec(title)
    || /puesto funcional de ([^,.;]+?)(?:,| del grupo| con destino|\.|$)/i.exec(title)
    || /categor[ií]a de ([^,.;]+?)(?:,| del grupo| con destino|\.|$)/i.exec(title);
  if (!m) return "";
  let value = m[1].trim();
  if ((value.match(/\)/g) || []).length > (value.match(/\(/g) || []).length) value = value.replace(/\)+$/, "").trim();
  return value.charAt(0).toLocaleUpperCase("es") + value.slice(1);
}

const BOPV_TOPICS = [
  [/oferta de destinos/, (t) => `Oferta de destinos${cycle(t)}`],
  [/admitidas y excluidas.*asignacion definitiva|asignacion definitiva/, (t) => `Admitidos/as y asignación definitiva de destinos${cycle(t)}`],
  [/admitidas y excluidas.*asignacion provisional|asignacion provisional/, (t) => `Admitidos/as y asignación provisional de destinos${cycle(t)}`],
  [/admitidas y excluidas|admitidos y excluidos/, () => "Relación de personas admitidas y excluidas"],
  [/tribunal calificador/, () => "Nombramiento del tribunal calificador"],
  [/nombramiento como personal estatutario fijo|nombramiento como personal estatutario/, () => "Nombramiento como personal estatutario fijo"],
  [/bases especificas/, () => "Bases específicas de la convocatoria"],
  [/bases generales/, () => "Bases generales de la convocatoria"],
  [/emplaza/, () => "Emplazamiento a interesados en un recurso contencioso-administrativo"],
  [/se corrige|correccion de errores|rectifica/, () => "Corrección de errores"],
  [/se modifica/, () => "Modificación de una resolución anterior"],
  [/declara desierta/, () => "Convocatoria declarada desierta"],
  [/nulidad/, () => "Declaración de nulidad"],
  [/convoca concurso de traslados/, () => "Convocatoria del concurso de traslados"],
  [/se da publicidad/, () => "Publicidad de una resolución"],
  [/relacion de aprobad|aprobados/, () => "Relación de personas aprobadas"],
  [/oferta publica de empleo/, () => "Oferta Pública de Empleo"],
];

function cycle(t) {
  const m = /ciclo,? de ([a-z]+ \d{4})/.exec(t);
  return m ? ` · ciclo ${m[1]}` : "";
}

export function bopvShortTitle(title) {
  const res = (/^(RESOLUCI[OÓ]N\s+\d+\/\d{4})/i.exec(title) || [])[1] || "";
  const t = fold(title);
  const topic = BOPV_TOPICS.find(([re]) => re.test(t));
  if (topic) return `${topic[1](t)}${res ? ` (${niceCase(res)})` : ""}`;
  const what = (/por (?:la|el) que (.+)$/i.exec(title) || [])[1] || title;
  const clean = what
    .replace(/\s+del grupo profesional[^.]*$/i, "")
    .replace(/\s+con destino en las organizaciones de servicios[^.]*$/i, "")
    .replace(/\.$/, "");
  const sentence = clean.charAt(0).toLocaleUpperCase("es") + clean.slice(1);
  return truncate(res ? `${sentence} (${niceCase(res)})` : sentence, 170);
}

// ------------------------------------------------- unión y deduplicación

// Clave de equivalencia entre avisos de distintas fuentes que cuentan lo mismo.
export function equivalenceKey(item) {
  const cat = fold((item.categories || [])[0] || item.title).replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3).join(" ");
  return `${item.published}|${item.end || "-"}|${cat}`;
}

export function mergeItems(lists) {
  const byId = new Map();
  const byKey = new Map();
  lists.flat().forEach((item) => {
    if (!item || !item.id || !item.published) return;
    const key = equivalenceKey(item);
    const twin = byKey.get(key);
    if (twin && twin.src !== item.src) {
      // Preferimos la página pública de Osakidetza como enlace principal y
      // conservamos la otra fuente como enlace alternativo.
      if (!twin.altUrl && item.url !== twin.url) twin.altUrl = item.url;
      twin.aliases = [...new Set([...(twin.aliases || []), item.id])];
      if ((item.categories || []).length > (twin.categories || []).length) twin.categories = item.categories;
      return;
    }
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
      byKey.set(key, item);
    }
  });
  return [...byId.values()];
}

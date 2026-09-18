// scripts/check-sources.mjs
//
// Comprueba las fuentes oficiales listadas en data/sources.json y escribe
// data/source-monitor.json con el mismo formato que espera index.html.
//
// NOVEDAD (extracción de avisos): además de comprobar si cada fuente ha
// cambiado (hash del contenido), para la página de CONTRATACIÓN TEMPORAL de
// Osakidetza este script ahora EXTRAE los avisos concretos (categoría/puesto
// + fecha de publicación + fecha de plazo) y los devuelve en `officialItems`,
// de modo que la app los marca automáticamente en el calendario.
//
// La extracción es conservadora: solo emite un aviso cuando puede identificar
// a la vez una fecha de publicación y una fecha de plazo. Para el resto de
// fuentes se mantiene el comportamiento anterior (solo detección de cambio).
// Si Osakidetza rediseña la web, la extracción puede dejar de encontrar
// avisos; en ese caso `officialItems` quedará vacío y no se inventará nada.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const SOURCES_PATH = new URL("../data/sources.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/source-monitor.json", import.meta.url);

const FETCH_TIMEOUT_MS = 20000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; OsakidetzaAlertasMonitor/1.0; +https://github.com/)";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "es-ES,es;q=0.9" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

// --- Descodificación de charset -------------------------------------------
// Las webs de euskadi.eus se sirven en ISO-8859-1. fetch().text() asume UTF-8
// y rompería los acentos, así que descodificamos según el charset real.
function decodeBody(arrayBuffer, contentType) {
  const bytes = new Uint8Array(arrayBuffer);
  let charset = "";
  const m = /charset=([^;]+)/i.exec(contentType || "");
  if (m) charset = m[1].trim().toLowerCase();
  if (!charset) {
    // Sniff de <meta charset=...> en los primeros bytes.
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048)).toLowerCase();
    const meta = /charset=["']?([\w-]+)/.exec(head);
    if (meta) charset = meta[1];
  }
  let label = "utf-8";
  if (/(iso-8859-1|latin1|windows-1252|iso8859-1)/.test(charset)) label = "windows-1252";
  else if (charset) label = charset;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// --- HTML -> texto ---------------------------------------------------------
function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&middot;/gi, "·")
    .replace(/&ordf;/gi, "ª")
    .replace(/&ordm;/gi, "º")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    // Mayúsculas primero (sin flag i) para no convertirlas en minúsculas.
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ")
    .replace(/&uuml;/g, "ü")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)));
}

function safeCodePoint(cp) {
  try { return String.fromCodePoint(cp); } catch { return ""; }
}

function htmlToText(html) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // Insertar saltos de línea en los cierres/aperturas de bloque para conservar
  // la separación entre líneas (categorías, encabezados, párrafos).
  t = t.replace(/<\s*(br|\/p|\/li|\/div|\/tr|\/h[1-6]|\/strong|\/b|\/span|p|li|h[1-6]|tr)\b[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  // Normalizar espacios por línea y comprimir líneas en blanco.
  t = t.split("\n").map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim()).join("\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t;
}

// --- Extractor de la página de Contratación temporal -----------------------
const MESES = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10",
  noviembre: "11", diciembre: "12",
};
function fold(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function toISO(dayStr, monthStr, yearStr, defaultYear) {
  const day = String(parseInt(dayStr, 10)).padStart(2, "0");
  const month = MESES[fold(monthStr)];
  if (!month || day === "NaN") return "";
  const year = yearStr ? yearStr : (defaultYear || "");
  if (!year) return "";
  return `${year}-${month}-${day}`;
}
function findDate(text, labels, defaultYear) {
  for (const label of labels) {
    const re = new RegExp(label + "\\s*(\\d{1,2})\\s+de\\s+([a-zA-Zñáéíóú]+)(?:\\s+de\\s+(20\\d{2}))?", "i");
    const m = text.match(re);
    if (m) {
      const iso = toISO(m[1], m[2], m[3], defaultYear);
      if (iso) return iso;
    }
  }
  return "";
}
function matchDateBefore(text, labelRe, defaultYear) {
  const m = text.match(labelRe);
  if (!m) return "";
  const before = text.slice(0, m.index);
  const dateRe = /(\d{1,2})\s+de\s+([a-zA-Zñáéíóú]+)(?:\s+de\s+(20\d{2}))?/gi;
  let last = null, d;
  while ((d = dateRe.exec(before)) !== null) last = d;
  if (!last) return "";
  return toISO(last[1], last[2], last[3], defaultYear);
}
const CATEGORY_STOPWORDS = [
  "actualizacion", "integracion", "republicacion", "listas", "lista", "contratacion",
  "temporal", "aviso", "importante", "apertura", "plazo", "inscripcion", "ope",
  "estabilizacion", "categoria", "categorias", "puesto", "puestos", "funcional",
  "funcionales", "recurso", "alzada", "hoy", "dia", "fecha", "corte", "resolucion",
  "preferencias", "organizaciones", "servicios", "centros", "web", "app", "email",
  "correo", "electronico", "error", "errores", "material", "aritmetico",
];
function extractCategories(block) {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const cats = [];
  for (const line of lines) {
    if (line.length < 3 || line.length > 90) continue;
    const letters = line.replace(/[^A-Za-zÑñÁÉÍÓÚáéíóúÜü]/g, "");
    if (letters.length < 3) continue;
    const upper = letters.replace(/[^A-ZÑÁÉÍÓÚÜ]/g, "").length;
    if (upper / letters.length < 0.7) continue;
    const words = fold(line).split(/[^a-zñ]+/).filter((w) => w.length >= 3);
    const meaningful = words.filter((w) => !CATEGORY_STOPWORDS.includes(w));
    if (!meaningful.length) continue;
    const clean = line.replace(/\s+/g, " ").trim();
    if (!cats.includes(clean)) cats.push(clean);
  }
  return cats.slice(0, 12);
}
function sliceNoticesRegion(text) {
  const start = text.search(/Listas de contrataci[oó]n temporal 2021/i);
  const rest = text.slice(start >= 0 ? start : 0);
  const endMarkers = [
    /Para m[aá]s informaci[oó]n,\s*acceda a la aplicaci[oó]n/i,
    /ACUERDO de 31 de octubre de 2023/i,
    /DOCUMENTOS DE INTER[EÉ]S/i,
    /CONTACTO:/i,
  ];
  let end = rest.length;
  for (const re of endMarkers) {
    const idx = rest.search(re);
    if (idx >= 0 && idx < end) end = idx;
  }
  return rest.slice(0, end);
}
const HEADER_RE = /(ACTUALIZACI[OÓ]N\s+E\s+INTEGRACI[OÓ]N\s+LISTAS(?:\s+DE\s+CONTRATACI[OÓ]N)?|REPUBLICACI[OÓ]N\s+LISTAS[^\n]*|APERTURA\s+PLAZO\s+INSCRIPCI[OÓ]N[^\n]*|ACTUALIZACI[OÓ]N\s+LISTAS[^\n]*|AVISO\s+IMPORTANTE|AVISO\s+EXCLUSIVO[^\n]*|AVISO\s+PARA[^\n]*|AVISO\s+RESTO[^\n]*)/gi;

function humanDate(iso) {
  const [y, m, d] = iso.split("-");
  const nombres = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${parseInt(d, 10)} de ${nombres[parseInt(m, 10)]} de ${y}`;
}

function extractContratacionTemporalItems(pageText, sourceUrl, today = new Date()) {
  const currentYear = String(today.getFullYear());
  const region = sliceNoticesRegion(pageText);
  const parts = region.split(HEADER_RE);
  const blocks = [];
  for (let i = 1; i < parts.length; i += 2) {
    const header = (parts[i] || "").trim();
    const body = parts[i + 1] || "";
    blocks.push({ header, body, block: header + "\n" + body });
  }
  const items = [];
  for (const { header, body, block } of blocks) {
    const foldedHeader = fold(header);
    if (/^aviso\b/.test(foldedHeader)) continue;
    const published =
      findDate(block, ["Hoy,?\\s*(?:d[ií]a\\s*)?", "d[ií]a\\s+", "Con fecha\\s+", "Hoy,?\\s+"], currentYear) || "";
    const year = published ? published.slice(0, 4) : currentYear;
    let deadline = "", deadlineLiteral = "";
    const recurso = findDate(block, ["recurso de alzada hasta el\\s+", "reclamaci[oó]n hasta el\\s+"], year);
    const inscripcion = findDate(block, ["plazo de inscripci[oó]n hasta el\\s+", "inscripci[oó]n hasta el\\s+"], year);
    const corte = findDate(block, ["fecha de corte[^0-9]{0,40}"], year) || matchDateBefore(block, /como\s+fecha de corte/i, year);
    if (recurso) { deadline = recurso; deadlineLiteral = `Plazo para interponer recurso de alzada hasta el ${humanDate(recurso)}, inclusive.`; }
    else if (inscripcion) { deadline = inscripcion; deadlineLiteral = `Plazo de inscripción hasta el ${humanDate(inscripcion)}.`; }
    else if (corte) { deadline = corte; deadlineLiteral = `Fecha de corte para la integración de inscripciones: ${humanDate(corte)}.`; }
    if (!published || !deadline) continue;
    const categories = extractCategories(body);
    const summary = block.replace(/\s+/g, " ").trim().slice(0, 400);
    let kind = "Actualización de listas";
    if (/apertura\s+plazo\s+inscripci/i.test(foldedHeader)) kind = "Apertura de plazo de inscripción";
    else if (/republicaci/i.test(foldedHeader)) kind = "Republicación de listas";
    items.push({
      published, deadline, deadlineLiteral,
      summary: `${kind}. ${summary}`,
      categories, url: sourceUrl, sourceUrl,
      linkConfidence: "extraído automáticamente de la web oficial",
    });
  }
  const seen = new Set();
  return items.filter((it) => {
    const key = `${it.published}|${it.deadline}|${it.categories.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Decide si una fuente admite extracción de avisos (por ahora, Contratación
// temporal). Devuelve la lista de officialItems (vacía si no aplica o falla).
function extractOfficialItems(source, decodedBody) {
  try {
    if (/contratacion-temporal/i.test(source.url) || /contratacion temporal/i.test(fold(source.label || ""))) {
      const text = htmlToText(decodedBody);
      return extractContratacionTemporalItems(text, source.url);
    }
  } catch (error) {
    console.log(`  ! No se pudieron extraer avisos de ${source.key}: ${error?.message || error}`);
  }
  return [];
}

async function checkOneSource(source) {
  const base = {
    key: source.key,
    url: source.url,
    label: source.label,
    process: source.process || "",
    officialItems: [],
  };
  try {
    const response = await fetchWithTimeout(source.url, FETCH_TIMEOUT_MS);
    const status = response.status;
    if (!response.ok) {
      return { ...base, ok: false, status, hash: "", error: `HTTP ${status}` };
    }
    const buffer = await response.arrayBuffer();
    const decoded = decodeBody(buffer, response.headers.get("content-type"));
    const officialItems = extractOfficialItems(source, decoded);
    return { ...base, officialItems, ok: true, status, hash: sha256(Buffer.from(buffer)), error: "" };
  } catch (error) {
    return { ...base, ok: false, status: 0, hash: "", error: error?.message || "Error de red al comprobar la fuente" };
  }
}

async function main() {
  const raw = await readFile(SOURCES_PATH, "utf8");
  const { sources } = JSON.parse(raw);

  const results = [];
  const BATCH_SIZE = 4;
  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(checkOneSource));
    results.push(...batchResults);
  }

  const checkedAt = new Date().toISOString();
  const payload = { checkedAt, sources: results };
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n");

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const detected = results.reduce((n, r) => n + (r.officialItems?.length || 0), 0);
  console.log(`Comprobadas ${results.length} fuentes: ${ok} ok, ${failed} con error. Avisos extraídos: ${detected}.`);
  if (failed) {
    for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ ${r.key}: ${r.error}`);
  }
}

main().catch((error) => {
  console.error("Fallo al comprobar fuentes:", error);
  process.exitCode = 1;
});

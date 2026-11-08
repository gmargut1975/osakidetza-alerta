// scripts/euskera.mjs
//
// Calendarios de acreditación de euskera:
//  - IVAP: exámenes de perfiles lingüísticos (PL1-PL4) para el personal del
//    sector público vasco, incluido el de Osakidetza. Dos convocatorias al año;
//    cada una tiene una página con un «Calendario» en listas:
//      https://www.ivap.euskadi.eus/convocatoria-2026-2/webivap00-a3hedei/es/
//  - HABE: certificados de los niveles B1, B2, C1 y C2 (convocatoria abierta y
//    HOBE por ordenador). Cada página tiene una tabla con dos periodos:
//      https://www.habe.euskadi.eus/convocatoria-abierta/webhabe00-edukiak/es/
//      https://www.habe.euskadi.eus/hobe-deialdia-2026/webhabe00-edukiak/es/ (solo en euskera)

import { MONTHS, fold, isoOf, stableHash, inlineText, decodeEntities, truncate, absoluteUrl } from "./extractors.mjs";

export const IVAP_PROCESS = "Euskera · Perfiles lingüísticos";
export const HABE_PROCESS = "Euskera · Niveles B1-C2 (HABE)";

const ES_MONTH = "(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";
const EU_MONTHS = { urtarril: 1, otsail: 2, martxo: 3, apiril: 4, maiatz: 5, ekain: 6, uztail: 7, abuztu: 8, irail: 9, urri: 10, azaro: 11, abendu: 12 };
const EU_MONTH = "(urtarril|otsail|martxo|apiril|maiatz|ekain|uztail|abuztu|irail|urri|azaro|abendu)aren";

// Fechas de un texto en castellano. Los días sin mes toman el del siguiente
// («del 9 al 14 de abril», «los días 9, 10 y 11 de diciembre»).
export function spanishDays(text) {
  const t = fold(decodeEntities(text)).replace(/ /g, " ");
  const tokens = [];
  const re = new RegExp(`\\b(\\d{1,2})(?!\\d)(?:\\s+de\\s+${ES_MONTH}(?:\\s+(?:de|del)\\s+(20\\d{2}))?)?`, "g");
  for (const m of t.matchAll(re)) {
    // Descarta horas («10:00») y números sueltos sin ningún mes después.
    if (/\d[:.]$/.test(t.slice(0, m.index)) || /^[:.]\d/.test(t.slice(m.index + m[1].length))) continue;
    tokens.push({ day: Number(m[1]), month: m[2] ? MONTHS[m[2]] : 0, year: m[3] ? Number(m[3]) : 0 });
  }
  for (let i = tokens.length - 2; i >= 0; i -= 1) {
    if (!tokens[i].month) { tokens[i].month = tokens[i + 1].month; if (!tokens[i].year) tokens[i].year = tokens[i + 1].year; }
  }
  return tokens.filter((x) => x.month && x.day >= 1 && x.day <= 31);
}

// Fechas en euskera: el mes va delante y vale para los días que le siguen
// («Apirilaren 27tik maiatzaren 4ra», «Ekainaren 25etik 27ra eta uztailaren 2tik 4ra»).
export function basqueDays(text) {
  const t = fold(decodeEntities(text)).replace(/ /g, " ");
  const tokens = [];
  let month = 0;
  const re = new RegExp(`${EU_MONTH}|\\b(\\d{1,2})(?:a|ra|era|tik|etik|ean|an)?\\b`, "g");
  for (const m of t.matchAll(re)) {
    if (m[1]) { month = EU_MONTHS[m[1]]; continue; }
    if (month) tokens.push({ day: Number(m[2]), month, year: 0 });
  }
  return tokens.filter((x) => x.day >= 1 && x.day <= 31);
}

// Convierte los días a AAAA-MM-DD: los meses anteriores al de referencia
// pertenecen al año siguiente (una convocatoria de septiembre acaba en enero).
function toIso(tokens, year, refMonth) {
  return tokens.map((x) => isoOf(x.year || (x.month < refMonth ? year + 1 : year), x.month, x.day));
}

function kindOf(label) {
  const t = fold(label);
  if (/plazo de solicitudes|matricul|inscripci/.test(t)) return "Inscripción";
  if (/reclamaci|revisi|erreklamazio|berrikuspen/.test(t)) return "Reclamaciones";
  if (/cambio de (lugar|dia)|aldatzeko/.test(t)) return "Solicitud de cambio";
  if (/admitid|onartu/.test(t)) return "Personas admitidas y excluidas";
  if (/resultado|emaitza|plantilla/.test(t)) return "Resultados";
  if (/horario|fechas, lugares/.test(t)) return "Publicación";
  if (/prueba|examen|proba|azterket/.test(t)) return "Examen";
  if (/convocatoria|publicad/.test(t)) return "Convocatoria";
  return "Publicación";
}

// ------------------------------------------------------------------ IVAP

// Enlaces a las páginas de cada convocatoria desde https://www.ivap.euskadi.eus/perfiles/
export function ivapConvocatoriaLinks(html, pageUrl) {
  const out = new Map();
  for (const m of String(html).matchAll(/href="([^"]*\/convocatoria-(20\d{2})-(\d)\/webivap00-a3hedei\/es\/?)"/gi)) {
    out.set(`${m[2]}-${m[3]}`, { code: `${m[2]}-${m[3]}`, url: absoluteUrl(decodeEntities(m[1]), pageUrl) });
  }
  return [...out.values()].sort((a, b) => b.code.localeCompare(a.code));
}

export function ivapUrl(code) {
  return `https://www.ivap.euskadi.eus/convocatoria-${code}/webivap00-a3hedei/es/`;
}

// Hitos del «Calendario» de una convocatoria del IVAP.
export function extractIvap(html, url, sourceKey, today) {
  const page = String(html);
  const h1 = inlineText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(page) || [])[1] || "");
  const code = (/convocatoria-(20\d{2})-(\d)/.exec(url) || /Convocatoria\s+(20\d{2})-(\d)/i.exec(h1) || []).slice(1, 3).join("-");
  if (!code) return [];
  const year = Number(code.slice(0, 4));
  const start = page.indexOf(">Calendario<");
  if (start < 0) return [];
  const stop = page.indexOf("panel panel-default", start);
  const block = page.slice(start, stop < 0 ? undefined : stop);
  const rows = [];
  let section = "";
  for (const m of block.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>|<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    if (m[1] !== undefined) { section = inlineText(m[1]).replace(/\s+/g, " ").trim(); continue; }
    const text = inlineText(m[2]).replace(/\s+/g, " ").trim();
    const tokens = spanishDays(text);
    if (!tokens.length) continue;
    rows.push({ section, text, tokens });
  }
  if (!rows.length) return [];
  const refMonth = rows[0].tokens[0].month;
  const first = toIso(rows[0].tokens, year, refMonth)[0];
  const published = first <= today ? first : today;
  const seen = new Map();
  return rows.map(({ section, text, tokens }) => {
    const dates = toIso(tokens, year, refMonth);
    let label = text.includes(":") ? text.slice(0, text.indexOf(":")).trim() : "";
    if (!label) label = /convocatoria/i.test(section) && /publicad/i.test(text) ? "Publicación de la convocatoria" : section || "Fecha";
    if (/^Se realizar/i.test(text) && !text.includes(":")) label = section;
    const n = (seen.get(label) || 0) + 1;
    seen.set(label, n);
    const kind = kindOf(label);
    return {
      id: `ivap-${code}-${stableHash(`${label}|${n}`)}`,
      src: sourceKey,
      process: IVAP_PROCESS,
      kind,
      title: `Perfiles lingüísticos ${code}: ${label}`,
      org: "IVAP",
      categories: ["Euskera", "Perfil lingüístico"],
      published,
      start: dates[0],
      end: dates[dates.length - 1],
      estimated: false,
      literal: truncate(`${section ? `${section} · ` : ""}${text}`, 400),
      summary: `Convocatoria ${code} de acreditación de perfiles lingüísticos del IVAP (personal del sector público vasco, incluido Osakidetza). Inscripción y resultados en Azternet.`,
      url,
    };
  });
}

// ------------------------------------------------------------------ HABE

const HOBE_LABELS = [
  [/^matrikulazio/, "Matriculación"],
  [/ezohiko data/, (t) => (/mintzamen/.test(t) ? "Fecha extraordinaria de la prueba de expresión oral" : "Fecha extraordinaria de las pruebas por ordenador")],
  [/proben emaitzak/, "Resultados de las pruebas por ordenador"],
  [/^entzumen/, "Pruebas por ordenador (comprensión oral y escrita, expresión escrita)"],
  [/erreklamazio|berrikuspen/, "Plazo para presentar solicitudes de revisión"],
  [/aldatzeko/, "Solicitud de cambio de día u hora de la prueba de expresión oral"],
  [/^mintzamen-probak/, "Prueba de expresión oral"],
  [/emaitza orokorrak/, "Resultados generales"],
];

function hobeLabel(text) {
  const t = fold(text);
  const hit = HOBE_LABELS.find(([re]) => re.test(t));
  if (!hit) return text;
  return typeof hit[1] === "function" ? hit[1](t) : hit[1];
}

// Páginas de la convocatoria abierta y de la HOBE enlazadas desde
// https://www.habe.euskadi.eus/convocatorias-examen/webhabe00-edukiak/es/
// (la de alumnado de euskaltegis tiene el mismo calendario que la abierta).
export function habeLinks(html, pageUrl) {
  const out = new Map();
  for (const m of String(html).matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1]);
    const text = inlineText(m[2]);
    if (/convocatoria-abierta/.test(href) || /^Convocatoria abierta/i.test(text)) out.set("abierta", { name: "Convocatoria abierta", url: absoluteUrl(href, pageUrl) });
    else if (/hobe-deialdia|hobe/i.test(href) || /^Convocatoria HOBE/i.test(text)) out.set("hobe", { name: "HOBE (por ordenador)", url: absoluteUrl(href, pageUrl) });
  }
  return [...out.values()];
}

// Tabla del calendario de una convocatoria de HABE (dos periodos por año).
export function extractHabe(html, url, sourceKey, today, { name = "", year: forcedYear } = {}) {
  const page = String(html);
  const tables = [...page.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]).filter((t) => /PERIODO|AZTERKETALDIA/i.test(t));
  if (!tables.length) return [];
  const table = tables[0].replace(/<!--[\s\S]*?-->/g, "");
  const basque = /AZTERKETALDIA/i.test(table);
  const caption = inlineText((/<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(table) || [])[1] || "");
  const h1 = inlineText((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(page) || [])[1] || "");
  const year = forcedYear || Number((/(20\d{2})/.exec(`${caption} ${h1} ${url}`) || [])[1]) || Number(today.slice(0, 4));
  const label = name || (basque ? "HOBE (por ordenador)" : "Convocatoria abierta");
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => inlineText(c[2].replace(/<sup[\s\S]*?<\/sup>/gi, "")).replace(/\s+/g, " ").trim()));
  const header = rows.find((r) => r.some((c) => /PERIODO|AZTERKETALDIA/i.test(c))) || [];
  const periods = header.filter((c) => /PERIODO|AZTERKETALDIA/i.test(c)).map((c) => (/^(PRIMER|LEHEN)/i.test(c) ? "1.er periodo" : "2.º periodo"));
  const parsed = [];
  let previous = "";
  rows.filter((r) => r !== header && r.length >= 2).forEach((r, rowIndex) => {
    let what = basque ? hobeLabel(r[0]) : r[0];
    // Hay dos plazos de revisión: se distinguen por la fila que revisan.
    if (/revisi/i.test(what) && previous) what = `${what} (${previous.charAt(0).toLowerCase()}${previous.slice(1)})`;
    previous = what;
    r.slice(1).forEach((cell, p) => {
      const tokens = basque ? basqueDays(cell) : spanishDays(cell);
      if (!tokens.length || !periods[p]) return;
      parsed.push({ what, cell, tokens, p, rowIndex });
    });
  });
  if (!parsed.length) return [];
  const firstOf = (p) => parsed.find((x) => x.p === p);
  const items = parsed.map(({ what, cell, tokens, p, rowIndex }) => {
    const ref = firstOf(p).tokens[0].month;
    const dates = toIso(tokens, year, ref);
    const first = toIso(firstOf(0).tokens, year, firstOf(0).tokens[0].month)[0];
    return {
      id: `habe-${stableHash(`${url.replace(/-20\d{2}(?=\/)/, "").replace(/\/(es|eu)\/?$/, "")}|${label}|${year}|${p}|${rowIndex}|${what}`)}`,
      src: sourceKey,
      process: HABE_PROCESS,
      kind: kindOf(what),
      title: `HABE ${label} ${year} · ${periods[p]}: ${what}`,
      org: "HABE",
      categories: ["Euskera", "B1", "B2", "C1", "C2"],
      published: first <= today ? first : today,
      start: dates[0],
      end: dates[dates.length - 1],
      estimated: false,
      literal: truncate(`${what}: ${cell}`, 300),
      summary: `Certificados de euskera B1, B2, C1 y C2 de HABE (${label}, ${year}). Matrícula en www.habe.euskadi.eus.`,
      url,
    };
  });
  return items;
}

// scripts/check-sources.mjs
//
// Lo ejecuta GitHub Actions cada 30 minutos. Descarga las fuentes oficiales
// de data/sources.json, extrae los avisos con plazo (scripts/extractors.mjs)
// y escribe data/source-monitor.json, que index.html lee al abrirse:
//
//   { version: 2, checkedAt, sources: [{key,label,process,type,url,ok,status,
//     error,count,hash,checkedAt}], bopv: {lastNumber, lastDate}, items: [...] }
//
// Reglas de robustez:
//  - Los avisos se ACUMULAN: si una página retira un aviso, se conserva su
//    histórico; si una fuente falla, se mantienen sus avisos anteriores.
//  - Se descartan los avisos cuyo plazo (o publicación) tiene más de 24 meses.
//  - El BOPV se recorre boletín a boletín desde el último procesado.
//
// Uso: node scripts/check-sources.mjs   (FETCH_IMPL permite inyectar un fetch
// simulado en las pruebas: ver tests/check-sources.test.mjs)

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  extractLinkList, extractAnnouncements, extractLanpoltsa, bopvBulletinDate, bopvSummaryEntries,
  bopvItem, mergeItems, inlineText, stripNoise, editorRegion, addDays, ctapAnnouncements, extractCtap,
} from "./extractors.mjs";
import { fetchCtapHtml } from "./fetch-ctap.mjs";

const TIMEOUT_MS = 45000;
const RETRIES = 2;
const KEEP_DAYS = 730;    // histórico conservado (la app muestra por defecto el último año)
const BOPV_MAX_PER_RUN = 80;
const UA = "Mozilla/5.0 (compatible; PlazosOsakidetzaMonitor/2.0; +https://github.com/gmargut1975/osakidetza-alerta)";

export function decodeBody(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  let charset = (/charset=([^;]+)/i.exec(contentType || "") || [])[1] || "";
  if (!charset) charset = (/charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(bytes.slice(0, 2048))) || [])[1] || "utf-8";
  const label = /(iso-?8859-1|latin1|windows-1252)/i.test(charset) ? "windows-1252" : charset.trim().toLowerCase();
  try { return new TextDecoder(label).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}

export function makeGetter(fetchImpl = globalThis.fetch) {
  return async function get(url, { json = false } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9", Accept: json ? "application/json" : "text/html,*/*" } });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        const body = decodeBody(await res.arrayBuffer(), res.headers.get("content-type"));
        return { status: res.status, body: json ? JSON.parse(body) : body };
      } catch (error) {
        lastError = error;
        if (error.status === 404) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  };
}

const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function madridToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function checkSource(source, get, today, ctapFetcher = fetchCtapHtml) {
  if (source.type === "ctap") {
    const rows = ctapAnnouncements(await ctapFetcher());
    if (!rows.length) throw new Error("La página de avisos de traslados no devolvió ningún aviso");
    return { status: 200, items: extractCtap(rows, source, today), hash: hash(JSON.stringify(rows)) };
  }
  if (source.type === "lanpoltsa") {
    const { status, body } = await get(source.url, { json: true });
    const list = Array.isArray(body) ? body : body.avisos || body.content || [];
    return { status, items: extractLanpoltsa(list, source, today), hash: hash(JSON.stringify(list)) };
  }
  const { status, body } = await get(source.url);
  const items = source.type === "links" ? extractLinkList(body, source, today)
    : source.type === "announcements" ? extractAnnouncements(body, source, today) : [];
  return { status, items, hash: hash(inlineText(stripNoise(editorRegion(body)))) };
}

// Recorre los boletines del BOPV posteriores al último procesado. En la
// primera ejecución empieza un año atrás (la numeración se reinicia cada año)
// y avanza como mucho BOPV_MAX_PER_RUN boletines por ejecución.
export async function checkBopv(source, get, previous, today) {
  const latest = await get(source.url);
  const m = /s(\d{2})_(\d{4})\.(?:pdf|shtml|epub)/.exec(latest.body);
  if (!m) throw new Error("No se encuentra el número del último boletín");
  const curYY = m[1];
  const latestNumber = Number(m[2]);
  let yy = previous.yy || (previous.lastDate ? String(previous.lastDate).slice(2, 4) : "");
  let n = previous.lastNumber || 0;
  let month = (previous.lastDate || "").slice(0, 7);
  if (!yy) {
    // Sin estado: mismo número de boletín, un año antes.
    yy = String(Number(curYY) - 1).padStart(2, "0");
    n = Math.max(0, latestNumber - 3);
    month = addDays(today, -370).slice(0, 7);
  }
  const items = [];
  let processed = { yy, lastNumber: n, lastDate: previous.lastDate || "" };
  let misses = 0;
  let count = 0;
  while (count < BOPV_MAX_PER_RUN) {
    if (yy === curYY && n >= latestNumber) break;
    n += 1;
    const name = `s${yy}_${String(n).padStart(4, "0")}.shtml`;
    let page = null;
    const base = month && month.slice(2, 4) === yy ? month : `20${yy}-01`;
    const candidates = [base, addDays(`${base}-15`, 31).slice(0, 7), addDays(`${base}-15`, 62).slice(0, 7)].filter((c) => c.slice(2, 4) === yy);
    for (const ym of candidates) {
      const url = `https://www.euskadi.eus/web01-bopv/es/bopv2/datos/${ym.slice(0, 4)}/${ym.slice(5, 7)}/${name}`;
      try {
        const res = await get(url);
        const date = bopvBulletinDate(res.body);
        if (date) { page = { url, body: res.body, date }; break; }
      } catch { /* probar la carpeta siguiente */ }
    }
    count += 1;
    if (!page) {
      misses += 1;
      // Fin del año anterior: pasamos al año en curso.
      if (yy !== curYY && misses >= 4) { yy = curYY; n = 0; month = `20${yy}-01`; misses = 0; processed = { yy, lastNumber: 0, lastDate: processed.lastDate }; }
      else if (yy === curYY && misses >= 4) break;
      continue;
    }
    misses = 0;
    month = page.date.slice(0, 7);
    for (const entry of bopvSummaryEntries(page.body, page.url)) {
      let text = "";
      try { text = inlineText(stripNoise((await get(entry.url)).body)); } catch { /* sin cuerpo: se registra sin plazo */ }
      const item = bopvItem(entry, page.date, text, source.key);
      if (item) items.push(item);
    }
    processed = { yy, lastNumber: n, lastDate: page.date };
  }
  return { status: latest.status, items, hash: hash(`${curYY}-${latestNumber}`), bopv: processed };
}

export async function run({ fetchImpl, sourcesPath, outputPath, today = madridToday(), ctapFetcher } = {}) {
  const sp = sourcesPath || new URL("../data/sources.json", import.meta.url);
  const op = outputPath || new URL("../data/source-monitor.json", import.meta.url);
  const { sources } = JSON.parse(await readFile(sp, "utf8"));
  let previous = {};
  try { previous = JSON.parse(await readFile(op, "utf8")); } catch { /* primera ejecución */ }
  const prevItems = Array.isArray(previous.items) ? previous.items : [];
  if (!prevItems.length) {
    // Primera ejecución: partimos de la instantánea incluida en la aplicación.
    try { prevItems.push(...JSON.parse(await readFile(new URL("../data/snapshot.json", import.meta.url), "utf8")).items); } catch { /* opcional */ }
  }
  const get = makeGetter(fetchImpl);
  const checkedAt = new Date().toISOString();
  const report = [];
  const fresh = [];
  let bopvState = previous.bopv || {};
  for (const source of sources) {
    const row = { key: source.key, label: source.label, process: source.process, type: source.type, url: source.publicUrl || source.url, ok: false, status: 0, error: "", count: 0, hash: "", checkedAt };
    try {
      const result = source.type === "bopv" ? await checkBopv(source, get, bopvState, today) : await checkSource(source, get, today, ctapFetcher);
      if (result.bopv) bopvState = result.bopv;
      Object.assign(row, { ok: true, status: result.status, count: result.items.length, hash: result.hash });
      const prevRow = (previous.sources || []).find((s) => s.key === source.key);
      row.changedAt = prevRow && prevRow.hash === row.hash ? prevRow.changedAt || checkedAt : checkedAt;
      fresh.push(...result.items);
    } catch (error) {
      row.error = String(error.name === "AbortError" ? "tiempo de espera agotado" : error.message || error).slice(0, 160);
      // Una caída puntual no cuenta como «cambio» cuando la fuente vuelva.
      const prevRow = (previous.sources || []).find((s) => s.key === source.key);
      if (prevRow) { row.hash = prevRow.hash || ""; row.changedAt = prevRow.changedAt; }
      row.status = error.status || 0;
    }
    report.push(row);
  }
  // Lo recién extraído manda; después, el histórico. Osakidetza antes que BOPV.
  const rank = (it) => (it.src === "bopv" ? 2 : it.src === "lanpoltsa" ? 1 : 0);
  const limit = addDays(today, -KEEP_DAYS);
  const items = mergeItems([[...fresh].sort((a, b) => rank(a) - rank(b)), prevItems])
    .filter((it) => (it.end || it.published) >= limit)
    .sort((a, b) => (b.published || "").localeCompare(a.published || "") || a.id.localeCompare(b.id));
  const output = { version: 2, checkedAt, sources: report, bopv: bopvState, items };
  // Solo reescribimos si cambia algo más que la hora (evita commits vacíos).
  const strip = (o) => JSON.stringify({ ...o, checkedAt: "", sources: (o.sources || []).map((s) => ({ ...s, checkedAt: "" })) });
  const changed = strip(output) !== strip(previous);
  const stale = !previous.checkedAt || Date.now() - Date.parse(previous.checkedAt) > 6 * 3600 * 1000;
  if (changed || stale) await writeFile(op, `${JSON.stringify(output, null, 1)}\n`);
  return { output, changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { output, changed } = await run();
  const ok = output.sources.filter((s) => s.ok).length;
  console.log(`${ok}/${output.sources.length} fuentes correctas · ${output.items.length} avisos · ${changed ? "con cambios" : "sin cambios"}`);
  output.sources.filter((s) => !s.ok).forEach((s) => console.log(`  ✗ ${s.key}: ${s.error}`));
}

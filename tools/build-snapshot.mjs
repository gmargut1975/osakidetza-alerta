// tools/build-snapshot.mjs
//
// Reconstruye los avisos normalizados a partir de la instantánea compacta
// capturada de las páginas oficiales (tools/snapshot/*.jsonl) y escribe
// data/snapshot.json. index.html la incrusta como datos de respaldo para que
// la aplicación funcione aunque no pueda leer data/source-monitor.json.
//
// Uso: node tools/build-snapshot.mjs

import { readFile, writeFile } from "node:fs/promises";
import { extractLanpoltsa, extractCtap, mergeItems, humanDate, absoluteUrl, stableHash } from "../scripts/extractors.mjs";

const here = (p) => new URL(p, import.meta.url);
const sources = JSON.parse(await readFile(here("../data/sources.json"), "utf8")).sources;
const byKey = Object.fromEntries(sources.map((s) => [s.key, s]));
const jsonl = async (name) => (await readFile(here(`snapshot/${name}`), "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const BOPV_BASE = "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/";
// Códigos de plazo estimado de la instantánea: m (un mes), h9 (emplazamiento,
// nueve días), hN (N días hábiles) y x (la frase original se conserva).
const estLiteral = (code, literal) => {
  if (code === "m") return "Plazo de un mes, contado desde el día siguiente a la publicación en el BOPV, para interponer recurso de alzada (fecha final calculada; compruébala en la resolución).";
  if (code === "h9") return "Las personas interesadas pueden comparecer y personarse en el recurso en el plazo de nueve días (fecha final calculada en días hábiles desde el día siguiente a la publicación; compruébala en la resolución).";
  const h = /^h(\d+)$/.exec(code);
  if (h) return `Plazo de ${h[1]} días hábiles desde el día siguiente a la publicación en el BOPV (fecha final calculada; compruébala en la resolución).`;
  return literal;
};

const bopv = (await jsonl("bopv.jsonl")).map(([id, process, kind, title, org, cats, published, start, end, est, literal, rel]) => ({
  id: `bopv-${id}`,
  src: "bopv",
  process,
  kind,
  title,
  org,
  categories: cats ? cats.split("|") : [],
  published,
  start,
  end,
  estimated: Boolean(est),
  literal: est ? estLiteral(est, literal) : literal === "T" ? `Plazo para solicitar destinos del ${humanDate(start)} al ${humanDate(end)}, ambos inclusive, según la resolución publicada en el BOPV.` : literal,
  summary: "",
  url: BOPV_BASE + rel,
}));

const OSK_BASE = "https://www.osakidetza.euskadi.eus/";
const osk = (await jsonl("osakidetza.jsonl")).map(([id, src, kind, title, org, cats, published, start, end, literal, rel, summary = ""]) => {
  const source = byKey[src];
  if (!source) throw new Error(`Fuente desconocida en la instantánea: ${src}`);
  return {
    id: `${src}-${id}`,
    src,
    process: source.process,
    kind,
    title,
    org,
    categories: cats ? cats.split("|") : [],
    published,
    start,
    end,
    estimated: false,
    literal: literal.startsWith("§") ? `${literal.slice(1)}: abierto desde el ${humanDate(start)} hasta el ${humanDate(end)}, ambos inclusive.` : literal,
    summary,
    url: absoluteUrl(rel, OSK_BASE),
  };
});

const today = process.env.SNAPSHOT_DATE || "2026-10-15";
const lan = extractLanpoltsa(JSON.parse(await readFile(here("snapshot/lanpoltsa.json"), "utf8")), byKey.lanpoltsa, today);

// Avisos públicos de la aplicación del concurso de traslados (CTAP), capturados
// de https://hh-sp.osakidetza.eus/B96/avisosProcesoPub.xhtml.
const ctap = extractCtap(JSON.parse(await readFile(here("snapshot/ctap.json"), "utf8")), byKey.ctap, today);

// Orden: Osakidetza primero para que su página pública quede como enlace principal.
const items = mergeItems([osk, lan, ctap, bopv]).map((item) => ({ ...item, summary: item.summary || "" }));
const ids = new Set();
items.forEach((item) => {
  if (ids.has(item.id)) throw new Error(`Id duplicado: ${item.id}`);
  ids.add(item.id);
  ["published", "start", "end"].forEach((f) => {
    if (item[f] && !/^\d{4}-\d{2}-\d{2}$/.test(item[f])) throw new Error(`Fecha no válida en ${item.id}.${f}: ${item[f]}`);
  });
  if (item.start && item.end && item.start > item.end) throw new Error(`Inicio posterior al fin en ${item.id}`);
});

const out = { capturedAt: process.env.SNAPSHOT_TIME || `${today}T08:30:00+02:00`, items };
await writeFile(here("../data/snapshot.json"), `${JSON.stringify(out)}\n`);
console.log(`snapshot: ${items.length} avisos (${osk.length} Osakidetza, ${lan.length} lan poltsa, ${ctap.length} CTAP, ${bopv.length} BOPV) · hash ${stableHash(JSON.stringify(items))}`);

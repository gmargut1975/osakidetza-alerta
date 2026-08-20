// scripts/check-sources.mjs
//
// Comprueba las fuentes oficiales listadas en data/sources.json y escribe
// data/source-monitor.json con el mismo formato que antes servía el backend
// de pago (gmargut.chatgpt.site/api/source-snapshot), para que index.html
// pueda seguir leyendo exactamente la misma forma de datos sin tocar la
// lógica de la app.
//
// IMPORTANTE — alcance deliberado: este script SOLO detecta si el
// contenido de cada fuente ha cambiado (comparando un hash del HTML
// descargado con el hash guardado la vez anterior). NO interpreta ni
// extrae avisos nuevos automáticamente ("officialItems" se deja vacío).
// Añadir un aviso nuevo real a la app sigue siendo una revisión humana:
// alguien (o Claude, dándole el enlace) confirma el contenido literal del
// BOPV/la web de Osakidetza y lo añade al array `notices` de index.html.
// Esto es intencional: la app solo debe mostrar lo que está confirmado,
// nunca "posibles" cambios sin verificar.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const SOURCES_PATH = new URL("../data/sources.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/source-monitor.json", import.meta.url);

const FETCH_TIMEOUT_MS = 20000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; OsakidetzaAlertasMonitor/1.0; +https://github.com/)";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
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
    const body = await response.text();
    return { ...base, ok: true, status, hash: sha256(body), error: "" };
  } catch (error) {
    return {
      ...base,
      ok: false,
      status: 0,
      hash: "",
      error: error?.message || "Error de red al comprobar la fuente",
    };
  }
}

async function main() {
  const raw = await readFile(SOURCES_PATH, "utf8");
  const { sources } = JSON.parse(raw);

  // Fetch con algo de concurrencia limitada para no saturar el sitio ni la
  // Action: en lotes de 4.
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
  console.log(`Comprobadas ${results.length} fuentes: ${ok} ok, ${failed} con error.`);
  if (failed) {
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  ✗ ${r.key}: ${r.error}`);
    }
  }
}

main().catch((error) => {
  console.error("Fallo al comprobar fuentes:", error);
  process.exitCode = 1;
});

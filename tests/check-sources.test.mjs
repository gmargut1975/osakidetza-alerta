import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../scripts/check-sources.mjs";

const resp = (body, type = "text/html; charset=utf-8") => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => new TextEncoder().encode(body).buffer });

async function setup(sources, previous) {
  const dir = await mkdtemp(join(tmpdir(), "chk-"));
  const sp = join(dir, "sources.json"), op = join(dir, "out.json");
  await writeFile(sp, JSON.stringify({ sources }));
  if (previous) await writeFile(op, JSON.stringify(previous));
  return { sp, op };
}

test("acumula avisos y conserva los de fuentes caídas", async () => {
  const prevItem = { id: "temporal-old", src: "temporal", process: "P", kind: "Plazo", title: "Antiguo", categories: [], published: "2026-09-01", start: "2026-09-01", end: "2026-09-10", url: "u" };
  const { sp, op } = await setup([
    { key: "temporal", type: "announcements", process: "Listas", label: "T", url: "https://x/temporal" },
    { key: "lanpoltsa", type: "lanpoltsa", process: "Listas", label: "L", url: "https://x/api", publicUrl: "https://x/pub" },
  ], { version: 2, checkedAt: "2026-10-01T00:00:00Z", sources: [], items: [prevItem] });
  const fetchImpl = async (url) => {
    if (url.endsWith("/api")) return resp(JSON.stringify([{ id: 9, fechaInicio: "2026-10-09", tituloES: "PUBLICACIÓN LISTAS DEFINITIVAS", resumenES: "Hoy, 9 de octubre de 2026:\r\n•\tCELADOR/A\r\nPlazo para interponer recurso de alzada hasta el 9 de noviembre de 2026, inclusive." }]), "application/json");
    return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const { output } = await run({ fetchImpl, sourcesPath: sp, outputPath: op, today: "2026-10-15" });
  const saved = JSON.parse(await readFile(op, "utf8"));
  assert.equal(saved.version, 2);
  assert.ok(saved.items.some((i) => i.id === "temporal-old"), "conserva el histórico");
  const lan = saved.items.find((i) => i.id === "lanpoltsa-9");
  assert.equal(lan.end, "2026-11-09");
  assert.equal(output.sources.find((s) => s.key === "temporal").ok, false);
  assert.equal(output.sources.find((s) => s.key === "lanpoltsa").count, 1);
});

test("descarta avisos de más de 24 meses", async () => {
  const old = { id: "x-1", src: "x", process: "P", kind: "Plazo", title: "Viejo", categories: [], published: "2023-01-01", start: "", end: "2023-02-01", url: "u" };
  const { sp, op } = await setup([], { version: 2, checkedAt: "2026-10-01T00:00:00Z", sources: [], items: [old] });
  const { output } = await run({ fetchImpl: async () => { throw new Error("sin red"); }, sourcesPath: sp, outputPath: op, today: "2026-10-15" });
  assert.equal(output.items.length, 0);
});

test("BOPV: primera ejecución recorre el año anterior y continúa en el actual", async () => {
  const { checkBopv, makeGetter } = await import("../scripts/check-sources.mjs");
  const bulletin = (fecha, href) => `<p>${fecha}</p><h5 class="BOPVSumarioOrganismo">OSAKIDETZA-SERVICIO VASCO DE SALUD</h5><p class="BOPVSumarioTitulo"><a href="${href}">RESOLUCIÓN 1/2025, por la que se aprueba la relación definitiva de personas aprobadas</a></p>`;
  const pages = {
    "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/Ultimo.shtml": "<a href='s26_0001.pdf'>pdf</a>",
    "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/2025/10/s25_0001.shtml": bulletin("Jueves, 16 de octubre de 2025", "2500001a.shtml"),
    "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/2025/10/2500001a.shtml": "Podrá interponerse recurso de alzada hasta el 20 de noviembre de 2025.",
    "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/2026/01/s26_0001.shtml": bulletin("Viernes, 2 de enero de 2026", "2600001a.shtml"),
    "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/2026/01/2600001a.shtml": "Sin plazo.",
  };
  const fetchImpl = async (url) => (pages[url] ? resp(pages[url]) : { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) });
  const r = await checkBopv({ key: "bopv", url: "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/Ultimo.shtml" }, makeGetter(fetchImpl), {}, "2026-10-15");
  assert.deepEqual(r.items.map((i) => i.published), ["2025-10-16", "2026-01-02"]);
  assert.equal(r.items[0].end, "2025-11-20");
  assert.deepEqual(r.bopv, { yy: "26", lastNumber: 1, lastDate: "2026-01-02" });
  const again = await checkBopv({ key: "bopv", url: "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/Ultimo.shtml" }, makeGetter(fetchImpl), r.bopv, "2026-10-15");
  assert.equal(again.items.length, 0, "no repite boletines ya procesados");
});

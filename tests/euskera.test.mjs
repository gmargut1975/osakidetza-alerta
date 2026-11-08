// Pruebas de los calendarios de acreditación de euskera (IVAP y HABE) y de
// las resoluciones del BOPV sobre euskera. Usa los extractos de tools/snapshot/euskera.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractIvap, extractHabe, ivapConvocatoriaLinks, habeLinks, spanishDays, basqueDays } from "../scripts/euskera.mjs";
import { bopvItem, isEuskeraAccreditation } from "../scripts/extractors.mjs";

const fx = (name) => readFileSync(new URL(`../tools/snapshot/euskera/${name}`, import.meta.url), "utf8");
const IVAP = (code) => `https://www.ivap.euskadi.eus/convocatoria-${code}/webivap00-a3hedei/es/`;

test("fechas en castellano y en euskera", () => {
  const es = (t) => spanishDays(t).map((x) => `${x.day}/${x.month}`);
  assert.deepEqual(es("Plazo de solicitudes: 5 - 18 de septiembre, ambos inclusive"), ["5/9", "18/9"]);
  assert.deepEqual(es("los días 9, 10 y 11 de diciembre (*)"), ["9/12", "10/12", "11/12"]);
  assert.deepEqual(es("Del 23 de junio al 4 de julio"), ["23/6", "4/7"]);
  assert.deepEqual(es("a las 10:00 del 3 de marzo"), ["3/3"]);
  const eu = (t) => basqueDays(t).map((x) => `${x.day}/${x.month}`);
  assert.deepEqual(eu("Apirilaren&nbsp;27tik maiatzaren 4ra"), ["27/4", "4/5"]);
  assert.deepEqual(eu("Ekainaren 25etik 27ra eta uztailaren 2tik 4ra"), ["25/6", "27/6", "2/7", "4/7"]);
  assert.deepEqual(eu("Abenduaren&nbsp;18a"), ["18/12"]);
});

test("IVAP: convocatorias enlazadas y calendario de la 2026-2", () => {
  assert.deepEqual(ivapConvocatoriaLinks(fx("ivap-perfiles.html"), "https://www.ivap.euskadi.eus/perfiles/").map((p) => p.code), ["2026-2", "2026-1"]);
  const items = extractIvap(fx("ivap-2026-2.html"), IVAP("2026-2"), "ivap", "2026-11-08");
  assert.equal(items.length, 13);
  assert.ok(items.every((i) => i.process === "Euskera · Perfiles lingüísticos" && i.org === "IVAP" && i.published === "2026-09-04"));
  const get = (re) => items.find((i) => re.test(i.title));
  assert.deepEqual([get(/Plazo de solicitudes/).start, get(/Plazo de solicitudes/).end, get(/Plazo de solicitudes/).kind], ["2026-09-05", "2026-09-18", "Inscripción"]);
  assert.deepEqual([get(/Prueba oral/).start, get(/Prueba oral/).end, get(/Prueba oral/).kind], ["2026-12-09", "2026-12-11", "Examen"]);
  // La convocatoria de septiembre termina en enero del año siguiente.
  assert.deepEqual([get(/reclamaciones/).start, get(/reclamaciones/).end], ["2026-12-30", "2027-01-08"]);
  assert.equal(get(/resultados definitivos/).end, "2027-01-28");
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  // Una convocatoria futura no se da por publicada antes de tiempo.
  assert.equal(extractIvap(fx("ivap-2026-2.html"), IVAP("2026-2"), "ivap", "2026-08-01")[0].published, "2026-08-01");
});

test("IVAP: los identificadores no cambian entre convocatorias ni al reordenar", () => {
  const a = extractIvap(fx("ivap-2026-1.html"), IVAP("2026-1"), "ivap", "2026-11-08");
  const b = extractIvap(fx("ivap-2025-2.html"), IVAP("2025-2"), "ivap", "2026-11-08");
  assert.equal(a.length, 13);
  assert.equal(b.length, 13);
  assert.equal(a.find((i) => /Prueba escrita$/.test(i.title)).end, "2026-04-25");
  assert.ok(!a.some((i) => b.some((j) => j.id === i.id)));
});

test("HABE: convocatoria abierta y HOBE (en euskera)", () => {
  const links = habeLinks(fx("habe-convocatorias.html"), "https://www.habe.euskadi.eus/convocatorias-examen/webhabe00-edukiak/es/");
  assert.deepEqual(links.map((l) => l.name), ["Convocatoria abierta", "HOBE (por ordenador)"]);
  const abierta = extractHabe(fx("habe-abierta.html"), links[0].url, "habe", "2026-11-08", { name: links[0].name });
  assert.equal(abierta.length, 24);
  const m2 = abierta.find((i) => /2\.º periodo: Matriculación/.test(i.title));
  assert.deepEqual([m2.start, m2.end, m2.kind, m2.org], ["2026-09-07", "2026-09-13", "Inscripción", "HABE"]);
  const rev = abierta.filter((i) => /revisión/.test(i.title) && /2\.º/.test(i.title)).map((i) => i.title);
  assert.equal(new Set(rev).size, 2);
  const hobe = extractHabe(fx("habe-hobe.html"), links[1].url, "habe", "2026-11-08", { name: links[1].name });
  assert.equal(hobe.length, 20);
  const oral = hobe.find((i) => /2\.º periodo: Prueba de expresión oral/.test(i.title));
  assert.deepEqual([oral.start, oral.end], ["2026-11-26", "2026-12-05"]);
  assert.equal(new Set([...abierta, ...hobe].map((i) => i.id)).size, abierta.length + hobe.length);
});

test("BOPV: resoluciones de euskera del IVAP, de HABE y de Osakidetza (no las del profesorado)", () => {
  const ivap = "RESOLUCIÓN de 3 de agosto de 2026, de la directora del Instituto Vasco de Administración Pública, por la que se convocan los exámenes de acreditación de perfiles lingüísticos correspondientes a la segunda convocatoria ordinaria de 2026.";
  const habe = "RESOLUCIÓN de 18 de marzo de 2026, del director general de HABE, por la que se convoca la acreditación HOBE de 2026 de los niveles B1, B2, C1 y C2 de competencia comunicativa en euskera definidos en el HEOC.";
  const concertada = "RESOLUCIÓN de 26 de enero de 2026, de la directora del Instituto para el Aprendizaje del Euskera y de las Lenguas, por la que se convocan pruebas para la acreditación de perfil lingüístico de la enseñanza concertada durante el año 2026.";
  assert.equal(isEuskeraAccreditation(concertada), false);
  const it = bopvItem({ title: ivap, url: "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/2026/09/2603806a.shtml" }, "2026-09-04",
    "El plazo para la presentación de solicitudes para la realización de los exámenes de acreditación será de 10 días hábiles, contados a partir del día siguiente al de la publicación de esta Resolución en el Boletín Oficial del País Vasco.", "bopv");
  assert.deepEqual([it.process, it.org, it.end, it.estimated], ["Euskera · Perfiles lingüísticos", "IVAP", "2026-09-18", true]);
  const h = bopvItem({ title: habe, url: "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/2026/03/2601372a.shtml" }, "2026-03-30", "HABE publicará los plazos en su web.", "bopv");
  assert.deepEqual([h.process, h.org, h.kind], ["Euskera · Niveles B1-C2 (HABE)", "HABE", "Publicación"]);
});

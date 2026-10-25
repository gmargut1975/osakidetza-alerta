import assert from "node:assert/strict";
import { test } from "node:test";
import * as X from "../scripts/extractors.mjs";

const T = "2026-10-15";
test("rango numérico", () => {
  const d = X.findDeadlines("Plazo de presentación de solicitudes: abierto desde el 13/10/2026 hasta el 26/10/2026, ambos inclusive.", T);
  assert.equal(d.length, 1); assert.equal(d[0].start, "2026-10-13"); assert.equal(d[0].end, "2026-10-26");
});
test("rango textual del X al Y", () => {
  const d = X.findDeadlines("El plazo para alegar requisitos y méritos será de 15 días hábiles: Del 9 al 29 de septiembre de 2026.", T);
  assert.deepEqual([d[0].start, d[0].end], ["2026-09-09", "2026-09-29"]);
});
test("rango textual con meses distintos", () => {
  const d = X.findDeadlines("Plazo para efectuar el recurso de alzada: desde el 15 de septiembre al 14 de octubre de 2026, ambos incluidos.", T);
  assert.deepEqual([d[0].start, d[0].end], ["2026-09-15", "2026-10-14"]);
});
test("cruce de año", () => {
  const d = X.findDeadlines("abierto desde el 31/12/2025 hasta el 15/01/2026", T);
  assert.deepEqual([d[0].start, d[0].end], ["2025-12-31", "2026-01-15"]);
  const e = X.findDeadlines("del 20 de diciembre al 10 de enero de 2027", T);
  assert.deepEqual([e[0].start, e[0].end], ["2026-12-20", "2027-01-10"]);
});
test("hasta la finalización del día", () => {
  const d = X.findDeadlines("podrán modificar la solicitud hasta la finalización del día 10 de septiembre de 2026 en relación con este ciclo.", "2026-08-20");
  assert.equal(d[0].end, "2026-09-10");
});
test("desde el día ... hasta el día", () => {
  const d = X.findDeadlines("El plazo para la toma de posesión se extenderá desde el día 17 de julio de 2026 hasta el día 23 de julio de 2026, ambos incluidos.", T);
  assert.deepEqual([d[0].start, d[0].end], ["2026-07-17", "2026-07-23"]);
});
test("sin año infiere el siguiente", () => {
  const d = X.findDeadlines("Plazo para interponer reclamación hasta el 8 de octubre, inclusive.", "2026-09-24");
  assert.equal(d[0].end, "2026-10-08");
});
test("fecha inválida descartada", () => {
  assert.equal(X.numericDate("31/02/2026"), "");
});
test("año pasado inferido", () => {
  assert.equal(X.inferPastYear(28, 12, "2027-01-05"), "2026-12-28");
  assert.equal(X.inferPastYear(24, 9, "2026-10-15"), "2026-09-24");
});
test("niceCase", () => {
  assert.equal(X.niceCase("TÉCNICO/A SUPERIOR JURÍDICO/A"), "Técnico/a Superior Jurídico/a");
  assert.equal(X.niceCase("VARIAS CATEGORÍAS - OSI DEBAGOIENA"), "Varias Categorías - OSI Debagoiena");
  assert.equal(X.niceCase("Ya en minúsculas"), "Ya en minúsculas");
});
test("lista de enlaces", () => {
  const html = `<div class="r01-editor"><ul><li><a class="fondoPdf" href="adjuntos/261009_X.pdf">T&Eacute;CNICO/A SUPERIOR INFORM&Aacute;TICO/A - OSI ARABA - LISTA PROVISIONAL - Plazo para presentar alegaciones: abierto desde el 13/10/2026 hasta el 26/10/2026, ambos inclusive.</a></li>
  <!-- <li><a href="x.pdf">OCULTO - Plazo: abierto desde el 01/01/2026 hasta el 02/01/2026</a></li> --></ul></div></article>`;
  const items = X.extractLinkList(html, { key: "comisiones2026", process: "Comisiones de servicios", url: "https://www.osakidetza.euskadi.eus/comisiones-servicios-2026/webosk00-procon/es/" }, T);
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.org, "OSI Araba"); assert.equal(it.kind, "Alegaciones"); assert.equal(it.end, "2026-10-26");
  assert.equal(it.url, "https://www.osakidetza.euskadi.eus/comisiones-servicios-2026/webosk00-procon/es/adjuntos/261009_X.pdf");
  assert.match(it.title, /Lista Provisional/);
  assert.deepEqual(it.categories, ["Técnico/a Superior Informático/a"]);
});
test("avisos fechados", () => {
  const html = `<div class="r01-editor"><!-- <p>Hoy día 18 de octubre, a las 15:00h, se cierra esta web</p> -->
  <h3>AVISO IMPORTANTE</h3>
  <p><strong>PUBLICACI&Oacute;N LISTAS DEFINITIVAS OFICIAL MANTENIMIENTO</strong></p>
  <p>Hoy, <b>9 de octubre de 2026</b>, est&aacute; prevista la publicaci&oacute;n de las Listas definitivas de los siguientes puestos:</p>
  <p>-&nbsp;&nbsp; <b>OFICIAL MANTENIMIENTO CARPINTER&Iacute;A</b></p>
  <p>-&nbsp;&nbsp; <b>OFICIAL MANTENIMIENTO EL&Eacute;CTRICO/A</b></p>
  <p><b>Plazo para interponer recurso de alzada hasta el 9 de noviembre de 2026</b>, inclusive.</p>
  <p><strong>PUBLICACI&Oacute;N LISTAS PROVISIONALES</strong></p>
  <p>Hoy, <b>24 de septiembre</b>, est&aacute; prevista la publicaci&oacute;n de las Listas provisionales:</p>
  <p>&middot;&nbsp;&nbsp; <b>DIPLOMADO/A PODOLOG&Iacute;A</b></p>
  <p><b>Plazo para interponer reclamaci&oacute;n hasta el 8 de octubre de 2026</b>, inclusive.</p></div></article>`;
  const items = X.extractAnnouncements(html, { key: "temporal", process: "Listas de contratación temporal", url: "https://www.osakidetza.euskadi.eus/contratacion-temporal/webosk00-procon/es/" }, T);
  assert.equal(items.length, 2);
  assert.equal(items[0].published, "2026-10-09"); assert.equal(items[0].end, "2026-11-09"); assert.equal(items[0].kind, "Recurso de alzada");
  assert.match(items[0].title, /Publicación Listas Definitivas Oficial Mantenimiento/);
  assert.deepEqual(items[0].categories, ["Oficial Mantenimiento Carpintería", "Oficial Mantenimiento Eléctrico/a"]);
  assert.ok(!items[0].categories.some((c) => /Provisional/.test(c)), "el titular siguiente no debe colarse como categoría");
  assert.equal(items[1].published, "2026-09-24"); assert.equal(items[1].end, "2026-10-08"); assert.equal(items[1].kind, "Reclamación");
  assert.match(items[0].url, /#:~:text=Hoy%2C%209%20de%20octubre/);
});
test("BOPV plazo un mes estimado", () => {
  const r = X.bopvDeadline("Contra esta Resolución podrá ser interpuesto recurso de alzada ante la directora general en el plazo de un mes contado a partir del día siguiente al de su publicación en el BOPV.", "2026-10-15");
  assert.equal(r.end, "2026-11-16"); assert.equal(r.estimated, true); assert.equal(r.kind, "Recurso de alzada");
  assert.equal(X.addMonthsClamped("2026-01-31", 1), "2026-02-28");
});
test("BOPV días hábiles", () => {
  const r = X.bopvDeadline("El plazo de presentación de solicitudes será de veinte días hábiles contados a partir del día siguiente al de la publicación de esta resolución en el BOPV.", "2026-10-15");
  assert.equal(r.end, "2026-11-12"); assert.equal(r.estimated, true);
});
test("BOPV sumario", () => {
  const html = `<h5 class="BOPVSumarioOrganismo">DEPARTAMENTO DE SALUD</h5><div><p class="BOPVSumarioTitulo"><a href="2026/10/1.shtml">ORDEN otra cosa</a></p></div>
  <h5 class="BOPVSumarioOrganismo">OSAKIDETZA-SERVICIO VASCO DE SALUD </h5><div><p class="BOPVSumarioTitulo"><a href="2026/10/2604272a.shtml">RESOLUCIÓN 1547/2026, de 10 de septiembre, de la directora general de Osakidetza-Servicio vasco de salud, por la que se publica la oferta de destinos del ciclo de mayo 2026 del concurso de traslados abierto y permanente, de la categoría/puesto funcional de enfermero/a del grupo profesional de diplomados/as.</a></p></div>
  <h5 class="BOPVSumarioOrganismo"> </h5><div><p class="BOPVSumarioTitulo"><a href="2026/10/2604273a.shtml">RESOLUCIÓN 1548/2026, igual organismo</a></p></div>`;
  const e = X.bopvSummaryEntries(html, "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/Ultimo.shtml");
  assert.equal(e.length, 2);
  assert.equal(e[0].url, "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/2026/10/2604272a.shtml");
  const it = X.bopvItem(e[0], "2026-10-15", "Podrán modificar la solicitud hasta la finalización del día 5 de noviembre de 2026.", "bopv");
  assert.equal(it.process, "Traslados"); assert.equal(it.end, "2026-11-05"); assert.deepEqual(it.categories, ["Enfermero/a"]);
  assert.equal(X.bopvBulletinDate("<p>Boletín jueves 15 de octubre de  2026</p>"), "2026-10-15");
});
test("lanpoltsa", () => {
  const items = X.extractLanpoltsa([{ id: 4484, tituloES: "OFERTA DE INTERINIDADES – ENFERMERÍA", resumenES: "Se va a realizar una oferta de interinidades:\r\nENFERMERÍA\r\nMás información en el área privada.", fechaInicio: "2026-10-08" },
   { id: 4491, tituloES: "PUBLICACIÓN LISTAS DEFINITIVAS", resumenES: "Hoy, 9 de octubre de 2026:\r\n•\tOFICIAL MANTENIMIENTO PINTURA\r\nPlazo para interponer recurso de alzada hasta el 9 de noviembre de 2026, inclusive.", fechaInicio: "2026-10-09" }], { key: "lanpoltsa", url: "x", publicUrl: "https://lanpoltsa.osakidetza.eus/c28/avisos-generales" }, T);
  assert.equal(items[0].process, "Interinidades y ofertas de nombramiento"); assert.equal(items[0].end, ""); assert.deepEqual(items[0].categories, ["Enfermería"]);
  assert.equal(items[1].end, "2026-11-09"); assert.equal(items[1].process, "Listas de contratación temporal");
});
test("merge deduplica entre fuentes", () => {
  const a = { id: "a", src: "temporal", published: "2026-10-09", end: "2026-11-09", title: "x", categories: ["Oficial Mantenimiento Carpintería"], url: "u1" };
  const b = { id: "b", src: "lanpoltsa", published: "2026-10-09", end: "2026-11-09", title: "y", categories: ["Oficial Mantenimiento Carpintería", "Otra"], url: "u2" };
  const m = X.mergeItems([[a], [b]]);
  assert.equal(m.length, 1); assert.equal(m[0].altUrl, "u2"); assert.deepEqual(m[0].aliases, ["b"]);
});
test("splitHead con dos partes de puesto", () => {
  const r = X.splitHead(["TÉCNICO/A RESPONSABLE DE ÁREA CORPORATIVA", "TÉCNICO/A SUPERIOR INFORMÁTICO/A", "DIRECCIÓN GENERAL", "LISTA PROVISIONAL"]);
  assert.equal(r.org, "DIRECCIÓN GENERAL"); assert.equal(r.puesto, "TÉCNICO/A RESPONSABLE DE ÁREA CORPORATIVA – TÉCNICO/A SUPERIOR INFORMÁTICO/A"); assert.deepEqual(r.phases, ["LISTA PROVISIONAL"]);
  assert.deepEqual(X.categoriesFromPuesto(r.puesto), ["Técnico/a Superior Informático/a"]);
});
test("ventana de plazos descarta fechas lejanas", () => {
  const d = X.deadlinesOfLines(["Plazo de reclamación hasta el 20 de julio de 2026.", "Normativa vigente hasta el 7 de mayo de 2027."], "2026-07-10");
  assert.equal(d.length, 1); assert.equal(d[0].end, "2026-07-20");
});
const P = (lines) => `<div class="r01-editor">${lines.map((l) => `<p>${l}</p>`).join("")}</div></article>`;
const SRC = { key: "ope", process: "OPE", url: "https://www.osakidetza.euskadi.eus/x/" };
test("titulares separados de la fecha por una frase de introducción", () => {
  const items = X.extractAnnouncements(P(["Procedimiento de selección.", "¡AVISO!",
    "OPE DIFÍCIL COBERTURA (RESULTAS 2): PUBLICACIÓN RESOLUCIONES NOMBRAMIENTO (III)",
    "En relación con la publicación de las Resoluciones se remite esta información:",
    "En el BOPV del día 19 de junio de 2026 está prevista la publicación de las Resoluciones de las siguientes categorías:",
    "FEM PEDIATRÍA EAP", "La toma de posesión del destino adjudicado se realizará el día 22 de junio de 2026",
    "Las referidas resoluciones se publicarán hoy en la web.",
    "OPE DIFÍCIL COBERTURA (RESULTAS 2): PUBLICACIÓN RESOLUCIONES NOMBRAMIENTO (II)",
    "En relación con la publicación de las Resoluciones se remite esta información:",
    "En el BOPV del día 5 de junio de 2026 está prevista la publicación:", "FEM FAMILIA EAP",
    "La toma de posesión del destino adjudicado se realizará el día 8 de junio de 2026."]), SRC, "2026-10-15");
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].categories, ["FEM Pediatría EAP"]);
  assert.match(items[0].title, /Resoluciones Nombramiento \(III\)/);
  assert.equal(items[0].end, "2026-06-22"); assert.equal(items[0].kind, "Toma de posesión");
  assert.deepEqual(items[1].categories, ["FEM Familia EAP"]); assert.equal(items[1].published, "2026-06-05");
});
test("aviso sin frase fechada y varios trámites", () => {
  const items = X.extractAnnouncements(P(["CONTACTO:", "Formulario", "¡AVISO!",
    "OPE 2023-2024-2025: Plazo de alegación de requisitos y méritos y calendario de exámenes",
    "La Dirección de Recursos Humanos informa de las siguientes actuaciones:",
    "El plazo para alegar requisitos y méritos a través de la aplicación de CV será de 15 días hábiles: Del 9 al 29 de septiembre de 2026."]), SRC, "2026-10-15");
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "Méritos y requisitos"); assert.equal(items[0].start, "2026-09-09"); assert.equal(items[0].end, "2026-09-29");
  assert.match(items[0].title, /^OPE 2023-2024-2025: Plazo de alegación/);
});
test("enlaces intermedios no cortan el aviso", () => {
  const items = X.extractAnnouncements(P(["Resolución DEFINITIVA de asignación de niveles:",
    "Con fecha 14 de septiembre se publica la Resolución 1509/2026, de 1 de septiembre.", "Preguntas frecuentes",
    "Plazo para efectuar el recurso de alzada: desde el 15 de septiembre al 14 de octubre de 2026, ambos incluidos."]), SRC, "2026-10-15");
  assert.equal(items[0].end, "2026-10-14"); assert.equal(items[0].kind, "Recurso de alzada");
});
test("frase BOPV de seguimiento y fecha lejana del titular", () => {
  const items = X.extractAnnouncements(P(["Hoy, día 31 de agosto de 2026, está prevista la publicación de la modificación.",
    "En el BOPV del día 3 de septiembre de 2026 está prevista la publicación de la modificación indicada.",
    "AVISO OPE 23-24-25: ACTUALIZACIÓN DE LA BATERÍA DE PREGUNTAS",
    "En relación con el proceso selectivo, se informa de la actualización.", "Texto 1", "Texto 2", "Texto 3", "Texto 4",
    "Hoy, día 10 de julio de 2026, está prevista la publicación de la Relación de aprobados:", "ENFERMERO/A",
    "El plazo para la presentación de reclamaciones se extenderá desde el día 13 de julio hasta el día 24 de julio de 2026."]), SRC, "2026-10-15");
  const pubs = items.map((i) => i.published);
  assert.ok(!pubs.includes("2026-09-03"), "la frase del BOPV no es un aviso aparte");
  const rec = items.find((i) => i.kind === "Reclamación");
  assert.equal(rec.end, "2026-07-24"); assert.ok(!/Batería/.test(rec.title), "no hereda el titular de otro aviso");
});
test("política BOPV", () => {
  const ent = (t) => ({ title: t, url: "https://www.euskadi.eus/web01-bopv/es/bopv2/datos/2026/10/1.shtml" });
  const rec = "Contra esta Resolución podrá interponerse recurso de alzada en el plazo de un mes contado a partir del día siguiente al de su publicación en el BOPV.";
  assert.equal(X.bopvItem(ent("RESOLUCIÓN 6900/2026, por la que se nombra, mediante libre designación, jefa de Equipo"), "2026-10-15", rec, "bopv"), null);
  assert.equal(X.bopvItem(ent("RESOLUCIÓN 1/2026, por la que se cesa, a petición propia, al jefe de Servicio"), "2026-10-15", rec, "bopv"), null);
  const trib = X.bopvItem(ent("RESOLUCIÓN 1571/2026, por la que se nombra el tribunal calificador de las pruebas selectivas de la categoría de oficial/a mantenimiento (Instalaciones)"), "2026-10-15", rec, "bopv");
  assert.equal(trib.end, ""); assert.equal(trib.kind, "Publicación");
  const adm = X.bopvItem(ent("RESOLUCIÓN 1547/2026, por la que se hacen públicas las relaciones de personas admitidas y excluidas y se procede a la asignación definitiva de destinos convocados, en el ciclo de diciembre 2025 del concurso de traslados abierto y permanente, de la categoría/puesto funcional de facultativo/a especialista médico/a de alergología del grupo profesional"), "2026-10-15", rec, "bopv");
  assert.equal(adm.process, "Traslados"); assert.equal(adm.end, "2026-11-16"); assert.equal(adm.estimated, true);
  assert.deepEqual(adm.categories, ["Facultativo/a especialista médico/a de alergología"]);
  const nomb = X.bopvItem(ent("RESOLUCIÓN 1126/2026, por la que se procede a la publicación del nombramiento como personal estatutario fijo, OPE 2020-2021-2022"), "2026-07-03", rec, "bopv");
  assert.equal(nomb.end, "", "sin toma de posesión explícita no se estima el recurso");
  assert.equal(X.bopvCategory("de la categoría de oficial/a mantenimiento (Instalaciones), del grupo"), "Oficial/a mantenimiento (Instalaciones)");
});
test("títulos cortos BOPV", () => {
  assert.equal(X.bopvShortTitle("RESOLUCIÓN 1548/2026, de 10 de septiembre, de la directora, por la que se hacen públicas las relaciones de personas admitidas y excluidas y se procede a la asignación definitiva de destinos convocados, en el ciclo de diciembre 2025 del concurso de traslados"), "Admitidos/as y asignación definitiva de destinos · ciclo diciembre 2025 (Resolución 1548/2026)");
  assert.equal(X.bopvShortTitle("RESOLUCIÓN 1411/2026, por la que se publica la oferta de destinos del ciclo de mayo 2026 del concurso"), "Oferta de destinos · ciclo mayo 2026 (Resolución 1411/2026)");
});
test("último día", () => {
  assert.equal(X.findDeadlines("Último día de presentación de solicitudes: 13 de octubre de 2026 (incluido).", "2026-10-01")[0].end, "2026-10-13");
  assert.equal(X.findDeadlines("Se recuerda que último día para realizar la elección de nombramientos es el 30 de septiembre de 2026 hasta las 14:00h.", "2026-09-24")[0].end, "2026-09-30");
  assert.equal(X.findDeadlines("Plazo de solicitud: hasta el 20 de octubre de 2026 (incluido).", "2026-10-05")[0].end, "2026-10-20");
});
test("lanpoltsa real", async () => {
  const fs = await import("node:fs");
  const list = JSON.parse(fs.readFileSync(new URL("../../build/snapshot/lanpoltsa.json", import.meta.url)));
  const items = X.extractLanpoltsa(list, { key: "lanpoltsa", publicUrl: "https://lanpoltsa.osakidetza.eus/c28/avisos-generales" }, "2026-10-15");
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(by["lanpoltsa-4478"].end, "2026-10-13"); assert.equal(by["lanpoltsa-4478"].process, "Interinidades y ofertas de nombramiento");
  assert.equal(by["lanpoltsa-4467"].end, "2026-09-30");
  assert.equal(by["lanpoltsa-4484"].end, ""); assert.deepEqual(by["lanpoltsa-4484"].categories, ["Enfermería"]);
  assert.equal(by["lanpoltsa-4468"].end, "2026-10-08"); assert.equal(by["lanpoltsa-4468"].kind, "Reclamación");
  assert.equal(by["lanpoltsa-4491"].categories.length, 6);
});
test("fases y paréntesis en listas de enlaces", () => {
  const P1 = X.splitOutsideParens("SUBDIRECTOR/A (ESCUELA UNIVERSITARIA DE ENFERMERÍA – VITORIA-GASTEIZ) - DIRECCIÓN GENERAL - Plazo: x");
  assert.deepEqual(P1, ["SUBDIRECTOR/A (ESCUELA UNIVERSITARIA DE ENFERMERÍA – VITORIA-GASTEIZ)", "DIRECCIÓN GENERAL", "Plazo: x"]);
  const r = X.splitHead(["TÉCNICO/A DE INFORMÁTICA (SERVICIO DE TECNOLOGÍA)", "DECLARADA DESIERTA", "DIRECCIÓN GENERAL"]);
  assert.equal(r.puesto, "TÉCNICO/A DE INFORMÁTICA (SERVICIO DE TECNOLOGÍA)"); assert.deepEqual(r.phases, ["DECLARADA DESIERTA"]);
  assert.deepEqual(X.categoriesFromPuesto(r.puesto), ["Técnico/a de Informática"]);
  const g = X.splitHead(["SECRETARIO/A DE DIRECCIÓN", "H. GORLIZ", "CESE"]);
  assert.equal(g.org, "H. GORLIZ"); assert.deepEqual(g.phases, ["CESE"]);
  const a = X.splitHead(["ACTUALIZACIÓN : VARIAS CATEGORIAS", "OSI BARRUALDE-GALDAKAO", "LISTA DEFINITIVA"]);
  assert.deepEqual(X.categoriesFromPuesto(a.puesto), ["Varias categorías"]); assert.deepEqual(a.phases, ["ACTUALIZACIÓN", "LISTA DEFINITIVA"]);
});

test("CTAP: avisos públicos del concurso de traslados", () => {
  const block = (n, date, title, body) => `<div class="announcement"> <div class="row"> <div class="col-sm-2"> <span class="announcement__number">${n}</span> <span class="announcement__date">${date}</span> </div> <div class="col-sm-6"> <div class="announcement__title"> Concurso de Traslados Abierto y Permanente </div> <div class="announcement__title" style="word-wrap: break-word; display: block;"> <span style="white-space: pre-wrap;">${title}</span> </div> <div> <span class="entry-text wrapText"><span class="entry-text__content wrapTextContent-avisos" style="white-space: pre-wrap;">${body}</span> </span> <a class="see-more-avisos">Más(+)</a> </div> </div> </div> </div>`;
  const html = `<main>${block(1, "21-10-2026", "MODELO RECLAMACIÓN CTAP: CONTRA LA ASIGNACIÓN PROVISIONAL DE DESTINOS", "Para descargar el modelo de reclamación, pinche en el pdf adjunto .")}${block(2, "21-10-2026", "PUBLICACIÓN ADJUDICACIÓN PROVISIONAL CICLO MAYO 2026", "Se procede a la publicación de las Resoluciones ... de las siguientes categorías:\n\n1.\tOFICIAL DE MANTENIMIENTO CARPINTERÍA\n2.\tTÉCNICO/A DE AUDIOPRÓTESIS\n\nVer Resoluciones en la parte pública y listados en el área privada.\n\nPlazo reclamaciones: 10 días hábiles, hasta el día 04/11/2026 incluido.")}${block(3, "29-09-2026", "AVISO PREVISIÓN PUBLICACIÓN ASIGNACIÓN PROVISIONAL CICLO MAYO 2026", "Con fecha 21 de octubre de 2026 está prevista la publicación.\n\nLas aspirantes que deseen renunciar a su participación disponen de plazo hasta el día 6 de octubre de 2026, incluido, haciendo uso del botón RENUNCIA.")}</main>`;
  const rows = X.ctapAnnouncements(html);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].title, "PUBLICACIÓN ADJUDICACIÓN PROVISIONAL CICLO MAYO 2026");
  const items = X.extractCtap(rows, { key: "ctap", process: "Traslados" }, "2026-10-25");
  assert.equal(items.length, 2, "los modelos de impresos no son plazos");
  const [prov, aviso] = items;
  assert.equal(prov.title, "Asignación provisional de destinos · ciclo mayo 2026");
  assert.equal(prov.kind, "Reclamación");
  assert.equal(prov.published, "2026-10-21");
  assert.equal(prov.end, "2026-11-04");
  assert.deepEqual(prov.categories, ["Oficial de Mantenimiento Carpintería", "Técnico/a de Audioprótesis"]);
  assert.equal(prov.url, X.CTAP_PUBLIC_URL);
  assert.equal(aviso.kind, "Renuncia / desistimiento");
  assert.equal(aviso.end, "2026-10-06");
});

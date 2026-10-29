import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const AlertCore = createRequire(import.meta.url)("../android-app/runner/alert-core.js");

const feed = (items) => ({ items });
const item = (id, extra = {}) => ({ id, process: "Traslados", kind: "Reclamación", title: `Aviso ${id}`, org: "", categories: ["Enfermero/a"], published: "2026-10-21", end: "2026-11-04", ...extra });
const sync = { enabled: true, interests: { processes: ["Traslados"], categories: [] }, remind: [3, 1], tracked: [] };

test("primera ejecución: aprende sin avisar", () => {
  const r = AlertCore.computeAlerts(sync, feed([item("a"), item("b")]), {}, "2026-10-29");
  assert.equal(r.notifications.length, 0);
  assert.ok(r.memory.initialized);
  assert.deepEqual(Object.keys(r.memory.known).sort(), ["a", "b"]);
});

test("novedad de mis intereses: se avisa una sola vez", () => {
  const first = AlertCore.computeAlerts(sync, feed([item("a")]), {}, "2026-10-29");
  const second = AlertCore.computeAlerts(sync, feed([item("a"), item("b"), item("c", { process: "OPE 2023-2024-2025" })]), first.memory, "2026-10-29");
  assert.equal(second.notifications.length, 1, "solo la de Traslados");
  assert.match(second.notifications[0].body, /Aviso b/);
  const third = AlertCore.computeAlerts(sync, feed([item("a"), item("b")]), second.memory, "2026-10-30");
  assert.equal(third.notifications.length, 0, "no se repite");
});

test("intereses por categoría con género y plural; sin intereses no hay novedades", () => {
  const s = { ...sync, interests: { processes: [], categories: ["enfermera"] } };
  const m = AlertCore.computeAlerts(s, feed([]), {}, "2026-10-29").memory;
  const r = AlertCore.computeAlerts(s, feed([item("x"), item("y", { categories: ["Celador/a"], title: "Otro" })]), m, "2026-10-29");
  assert.deepEqual(r.notifications.map((n) => n.body.includes("Aviso x")), [true]);
  const none = AlertCore.computeAlerts({ ...sync, interests: { processes: [], categories: [] } }, feed([item("z")]), m, "2026-10-29");
  assert.equal(none.notifications.length, 0);
});

test("muchas novedades se agrupan y lo cerrado no avisa", () => {
  const m = AlertCore.computeAlerts(sync, feed([]), {}, "2026-10-29").memory;
  const many = ["1", "2", "3", "4", "5"].map((id) => item(id));
  many.push(item("old", { end: "2026-10-01" }));
  const r = AlertCore.computeAlerts(sync, feed(many), m, "2026-10-29");
  assert.equal(r.notifications.length, 1);
  assert.match(r.notifications[0].title, /^5 novedades/);
});

test("recordatorios: días antes, una vez por umbral, respetando el estado", () => {
  const s = { ...sync, tracked: [
    { id: "t1", title: "Recurso", org: "OSI Araba", end: "2026-11-01", status: "pendiente" },
    { id: "t2", title: "Hecho", end: "2026-10-30", status: "hecho" },
    { id: "t3", title: "Presentado", end: "2026-10-30", status: "presentado", responseEnd: "2026-10-31" },
  ] };
  const d1 = AlertCore.computeAlerts(s, null, { initialized: true }, "2026-10-29");
  assert.deepEqual(d1.notifications.map((n) => n.title), ["Termina el plazo en 3 días", "Termina el plazo de contestación en 2 días"]);
  assert.match(d1.notifications[0].body, /OSI Araba · Recurso \(01\/11\/2026\)/);
  const again = AlertCore.computeAlerts(s, null, d1.memory, "2026-10-30");
  assert.deepEqual(again.notifications.map((n) => n.title), ["Termina el plazo de contestación mañana"]);
  const lastDay = AlertCore.computeAlerts(s, null, again.memory, "2026-10-31");
  assert.deepEqual(lastDay.notifications.map((n) => n.title), ["Termina el plazo mañana", "Termina el plazo de contestación hoy"]);
});

test("identificadores de notificación enteros positivos de 32 bits", () => {
  const id = AlertCore.notifId("rem|x");
  assert.ok(Number.isInteger(id) && id > 0 && id <= 0x7fffffff);
});

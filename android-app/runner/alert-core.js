// android-app/runner/alert-core.js
//
// Lógica pura de las alertas de la app Android: decide qué notificaciones
// hay que mostrar a partir de
//   - el estado que la app sincroniza (intereses, plazos seguidos, días de
//     aviso) y
//   - el resumen ligero de avisos que publica GitHub (data/feed.json).
// No usa ninguna API de Capacitor, así que se prueba en Node
// (tests/alert-core.test.mjs) y se concatena delante de runner-main.js para
// formar el script que Android ejecuta en segundo plano.

/* eslint-disable no-unused-vars */
var AlertCore = (function () {
  var MAX_SINGLE = 3; // por encima, una sola notificación resumen

  // Sin String.prototype.normalize (el motor de segundo plano puede no tenerlo).
  var ACCENTS = { "á": "a", "à": "a", "ä": "a", "â": "a", "é": "e", "è": "e", "ë": "e", "ê": "e", "í": "i", "ì": "i", "ï": "i", "î": "i", "ó": "o", "ò": "o", "ö": "o", "ô": "o", "ú": "u", "ù": "u", "ü": "u", "û": "u", "ñ": "n", "ç": "c" };
  function fold(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/[áàäâéèëêíìïîóòöôúùüûñç]/g, function (c) { return ACCENTS[c]; });
  }
  function stem(w) { return w.length > 4 ? w.replace(/(as|os|es|a|o|s)$/, "") : w; }
  function terms(text) { return fold(text).split(/[\s,;]+/).filter(Boolean).map(stem); }
  function matchesAll(hay, text) { return terms(text).every(function (t) { return hay.indexOf(t) >= 0; }); }

  function toDate(iso) { var p = iso.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function fmt(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : ""; }
  function addDays(iso, n) { var d = new Date(toDate(iso) + n * 86400000); return d.toISOString().slice(0, 10); }

  // Identificador numérico estable (Android exige un entero de 32 bits).
  function notifId(key) {
    var h = 0x811c9dc5;
    for (var i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return (h & 0x7fffffff) || 1;
  }

  function hayOf(it) {
    return fold([it.title, it.process, it.kind, it.org, (it.categories || []).join(" "), it.literal].join(" "));
  }
  function hasInterests(interests) {
    return Boolean(interests && ((interests.processes || []).length || (interests.categories || []).length));
  }
  function matchesInterests(it, interests) {
    var processes = interests.processes || [];
    var categories = interests.categories || [];
    var hay = hayOf(it);
    var okP = !processes.length || processes.indexOf(it.process) >= 0;
    var okC = !categories.length || categories.some(function (c) { return matchesAll(hay, c); });
    return okP && okC;
  }
  // Igual que en la app: solo se avisa de lo que aún tiene plazo o es una oferta.
  function isAlertable(it, today) {
    if (it.kind === "Oferta de nombramientos") return it.published >= addDays(today, -7);
    return Boolean(it.end) && it.end >= today;
  }
  function label(it) {
    var org = it.org ? it.org + " · " : "";
    var when = it.end ? " · hasta el " + fmt(it.end) : "";
    return org + it.title + when;
  }

  /**
   * @param {object} sync     estado sincronizado desde la app
   * @param {object|null} feed  contenido de data/feed.json (null si no se pudo leer)
   * @param {object} memory   memoria propia del comprobador {known:{id:fecha}, notified:{clave:fecha}, initialized}
   * @param {string} today    AAAA-MM-DD (hora de Euskadi)
   * @returns {{notifications: Array, memory: object}}
   */
  function computeAlerts(sync, feed, memory, today) {
    sync = sync || {};
    memory = memory || {};
    var known = Object.assign({}, memory.known || {});
    var notified = Object.assign({}, memory.notified || {});
    var out = [];
    var enabled = sync.enabled !== false;

    // 1) Novedades de mis intereses.
    if (feed && Array.isArray(feed.items)) {
      var fresh = [];
      feed.items.forEach(function (it) {
        if (!it || !it.id) return;
        if (!known[it.id]) {
          // La primera vez solo se aprende lo que hay: no se avisa de nada antiguo.
          if (memory.initialized && enabled && hasInterests(sync.interests) && matchesInterests(it, sync.interests) && isAlertable(it, today)) fresh.push(it);
          known[it.id] = today;
        }
      });
      if (fresh.length && fresh.length <= MAX_SINGLE) {
        fresh.forEach(function (it) {
          out.push({ id: notifId("new|" + it.id), title: "Nuevo: " + it.kind + (it.process ? " · " + it.process : ""), body: label(it), group: "novedades" });
        });
      } else if (fresh.length) {
        out.push({
          id: notifId("new|" + today + "|" + fresh.length + "|" + fresh[0].id),
          title: fresh.length + " novedades de tus intereses",
          body: fresh.slice(0, 4).map(function (it) { return "• " + label(it); }).join("\n") + (fresh.length > 4 ? "\n…y " + (fresh.length - 4) + " más" : ""),
          group: "novedades",
        });
      }
    }

    // 2) Recordatorios de los plazos que sigo.
    if (enabled) {
      var defaults = (sync.remind && sync.remind.length) ? sync.remind : [3, 1];
      (sync.tracked || []).forEach(function (t) {
        if (!t || ["hecho", "descartado"].indexOf(t.status) >= 0) return;
        var targets = [];
        if (t.end && t.status !== "presentado") targets.push(["fin", t.end, "Termina el plazo"]);
        if (t.responseEnd) targets.push(["resp", t.responseEnd, "Termina el plazo de contestación"]);
        targets.forEach(function (tg) {
          var left = diffDays(today, tg[1]);
          if (left < 0) return;
          // Además de los días elegidos, siempre se avisa el mismo día del fin.
          var offsets = (t.remind && t.remind.length ? t.remind : defaults).concat([0]).filter(function (d) { return left <= d; });
          if (!offsets.length) return;
          var key = t.id + "|" + tg[0] + "|" + tg[1] + "|" + Math.min.apply(null, offsets);
          if (notified[key]) return;
          notified[key] = today;
          var when = left === 0 ? "hoy" : left === 1 ? "mañana" : "en " + left + " días";
          out.push({ id: notifId("rem|" + key), title: tg[2] + " " + when, body: (t.org ? t.org + " · " : "") + t.title + " (" + fmt(tg[1]) + ")", group: "recordatorios" });
        });
      });
    }

    // Memoria acotada: lo visto hace más de 400 días se olvida.
    var limit = addDays(today, -400);
    Object.keys(known).forEach(function (k) { if (known[k] < limit) delete known[k]; });
    Object.keys(notified).forEach(function (k) { if (notified[k] < limit) delete notified[k]; });
    return { notifications: out, memory: { known: known, notified: notified, initialized: true } };
  }

  // Fecha en Euskadi sin Intl: horario de verano del último domingo de marzo
  // (01:00 UTC) al último domingo de octubre (01:00 UTC).
  function lastSundayUtc(year, month) {
    var d = new Date(Date.UTC(year, month + 1, 0, 1));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  }
  function madridToday(now) {
    var t = (now || new Date()).getTime();
    var y = new Date(t).getUTCFullYear();
    var summer = t >= lastSundayUtc(y, 2) && t < lastSundayUtc(y, 9);
    return new Date(t + (summer ? 2 : 1) * 3600000).toISOString().slice(0, 10);
  }

  return { computeAlerts: computeAlerts, matchesInterests: matchesInterests, notifId: notifId, madridToday: madridToday, fold: fold };
})();
if (typeof module !== "undefined") module.exports = AlertCore;

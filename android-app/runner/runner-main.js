// android-app/runner/runner-main.js
//
// Script que Android ejecuta en segundo plano (Capacitor Background Runner),
// aunque la app esté cerrada. Se concatena detrás de alert-core.js.
//
// Eventos:
//   checkPlazos  periódico (cada ~60 min, cuando Android lo permita): descarga
//                data/feed.json y lanza las notificaciones que tocan.
//   syncState    lo envía la app cada vez que cambian los intereses, los
//                plazos seguidos o los días de aviso.

var FEED_URL = "https://gmargut1975.github.io/osakidetza-alerta/data/feed.json";
var KEY_SYNC = "plazos.sync";
var KEY_MEMORY = "plazos.memory";

function kvGet(key) {
  try {
    var r = CapacitorKV.get(key);
    var raw = r && typeof r === "object" ? r.value : r;
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function kvSet(key, value) {
  CapacitorKV.set(key, JSON.stringify(value));
}

addEventListener("syncState", function (resolve, reject, args) {
  try {
    kvSet(KEY_SYNC, args || {});
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener("checkPlazos", async function (resolve, reject) {
  try {
    var sync = kvGet(KEY_SYNC) || {};
    var memory = kvGet(KEY_MEMORY) || {};
    var feed = null;
    try {
      var res = await fetch(FEED_URL + "?t=" + Date.now());
      if (res.ok) feed = await res.json();
    } catch (e) {
      feed = null; // sin conexión: se hacen solo los recordatorios
    }
    var result = AlertCore.computeAlerts(sync, feed, memory, AlertCore.madridToday());
    kvSet(KEY_MEMORY, result.memory);
    if (result.notifications.length) {
      var at = new Date(Date.now() + 2000);
      CapacitorNotifications.schedule(result.notifications.map(function (n) {
        return { id: n.id, title: n.title, body: n.body, scheduleAt: at, autoCancel: true };
      }));
    }
    resolve();
  } catch (e) {
    reject(e);
  }
});

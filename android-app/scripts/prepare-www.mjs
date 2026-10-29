// android-app/scripts/prepare-www.mjs
//
// Prepara la carpeta www/ que Capacitor mete en el APK:
//   - la misma index.html de la web, marcada como app nativa y con los datos
//     leídos de GitHub Pages;
//   - los scripts de Capacitor y del plugin de segundo plano (sin empaquetador);
//   - el comprobador de segundo plano (alert-core.js + runner-main.js).
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
const DATA_BASE = process.env.PLAZOS_DATA_BASE || "https://gmargut1975.github.io/osakidetza-alerta/";
const VERSION = process.env.PLAZOS_APP_VERSION || "dev";

await mkdir(here("../www/vendor"), { recursive: true });
await mkdir(here("../www/runners"), { recursive: true });

const candidates = {
  "vendor/capacitor.js": ["../node_modules/@capacitor/core/dist/capacitor.js"],
  "vendor/background-runner.js": ["../node_modules/@capacitor/background-runner/dist/plugin.js"],
};
// Android inyecta por sí mismo el puente de Capacitor (window.Capacitor.Plugins);
// estos scripts solo añaden registerPlugin por si acaso, así que son opcionales.
const vendor = [];
for (const [dest, list] of Object.entries(candidates)) {
  const found = list.find((p) => existsSync(here(p)));
  if (!found) { console.warn(`Aviso: no se encuentra ${list.join(" / ")}; se omite.`); continue; }
  await copyFile(here(found), here(`../www/${dest}`));
  vendor.push(dest);
}

let html = await readFile(here("../../index.html"), "utf8");
const inject = `<script>window.PLAZOS_NATIVE=true;window.PLAZOS_DATA_BASE=${JSON.stringify(DATA_BASE)};window.PLAZOS_APP_VERSION=${JSON.stringify(VERSION)};</script>
${vendor.map((v) => `<script src="${v}"></script>`).join("\n")}
`;
if (!html.includes("</head>")) throw new Error("index.html sin </head>");
html = html.replace("</head>", `${inject}</head>`);
await writeFile(here("../www/index.html"), html);

const core = await readFile(here("../runner/alert-core.js"), "utf8");
const main = await readFile(here("../runner/runner-main.js"), "utf8");
await writeFile(here("../www/runners/background.js"), `${core.replace(/^if \(typeof module[^\n]*\n?/m, "")}\n${main}`);
console.log(`www/ preparada (versión ${VERSION}, datos de ${DATA_BASE})`);

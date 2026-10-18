// tools/build.mjs — genera index.html (un único archivo) a partir de
// src/app.html, la instantánea data/snapshot.json y el logotipo.
// Uso: node tools/build-snapshot.mjs && node tools/build.mjs
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const here = (p) => new URL(p, import.meta.url);
const tpl = await readFile(here("../src/app.html"), "utf8");
const snap = gzipSync(await readFile(here("../data/snapshot.json")), { level: 9 }).toString("base64");
const logo = `data:image/webp;base64,${(await readFile(here("../icons/logo.webp"))).toString("base64")}`;
const html = tpl.replace("{{LOGO}}", logo).replace("{{SNAPSHOT}}", () => snap);
await writeFile(here("../index.html"), html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB`);

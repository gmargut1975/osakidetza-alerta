// scripts/fetch-ctap.mjs
//
// Descarga la página pública de avisos de la aplicación del concurso de
// traslados (CTAP) de Osakidetza. Es una aplicación JSF/PrimeFaces: la página
// de avisos solo responde dentro de una sesión en la que se ha elegido antes
// una convocatoria, así que se recorre como lo haría una persona (castellano →
// «Concurso de Traslados» → primera categoría → «Ver todos» los avisos) con un
// navegador sin interfaz (Playwright). Los avisos son comunes a todo el
// concurso: da igual qué categoría se abra.

export const CTAP_HOME = "https://hh-sp.osakidetza.eus/B96/home_usuario_publico.xhtml";
export const CTAP_AVISOS = "https://hh-sp.osakidetza.eus/B96/avisosProcesoPub.xhtml";

export async function fetchCtapHtml({ home = CTAP_HOME, avisos = CTAP_AVISOS, timeout = 60000, launchOptions = {} } = {}) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright no está instalado (necesario para leer la aplicación de traslados)");
  }
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ locale: "es-ES" });
    page.setDefaultTimeout(timeout);
    await page.goto(home, { waitUntil: "domcontentloaded" });
    // La cola de acceso (Queue-Fair) puede retener unos segundos antes de la portada.
    await page.waitForSelector("a[id$=':es']");
    if (!/Empleo P[úu]blico/i.test(await page.content())) {
      await Promise.all([page.waitForLoadState("domcontentloaded"), page.click("a[id$=':es']")]);
      await page.waitForSelector("a[id$=':es']");
    }
    const header = () => page.getByText(/Concurso de Traslados Abierto y Permanente|Lekualdatze-lehiaketa irekia/i);
    await header().first().click();
    await page.waitForTimeout(800);
    if ((await header().count()) > 1) {
      await header().nth(1).click();
      await page.waitForTimeout(800);
    }
    const link = page.locator("a[onclick*='PrimeFaces.ab']:visible, a[data-ctap-link]:visible").first();
    await Promise.all([page.waitForURL(/informacion_convocatoria/), link.click()]);
    await page.goto(avisos, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".announcement");
    return await page.content();
  } finally {
    await browser.close();
  }
}

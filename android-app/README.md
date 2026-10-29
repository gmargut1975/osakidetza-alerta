# App Android de Plazos Osakidetza

La misma aplicación web empaquetada con Capacitor, más un comprobador en
segundo plano (`runner/`) que Android ejecuta aproximadamente cada hora,
aunque la app esté cerrada:

- descarga `data/feed.json` (lo actualiza el robot de GitHub cada 30 minutos);
- avisa de las **novedades que encajan con tus intereses** (Ajustes > Mis intereses);
- avisa de los **plazos que sigues**: los días elegidos antes del fin y el mismo día.

La primera comprobación solo aprende lo que ya hay publicado; avisa de lo que
aparezca después. Cada aviso se lanza una única vez.

El APK lo compila GitHub (`.github/workflows/build-android.yml`) y lo publica en
*Releases*: https://github.com/gmargut1975/osakidetza-alerta/releases/latest/download/plazos-osakidetza.apk

Pruebas de la lógica de avisos: `node --test tests/alert-core.test.mjs`.

# issue-18-tiempo-simple · Medición previa

Medido el 2026-11-13 con la tarjeta **actual** (`WeatherCard` antes del cambio) en la pila de pruebas `onway-e2e`, con la ubicación del dispositivo simulada (`DEVICE_AT`), el coordinador de la semilla y `data-status="ok"`. Altura de la tarjeta del tiempo (`section.env-card` «Meteorología») sin desplegar el detalle por hora.

| Formato | Pantalla | Altura de la tarjeta | Ancho de la tarjeta |
|---|---|---|---|
| Escritorio | 1280 × 720 | **770 px** | 352 px |
| Móvil | 375 × 812 | **770 px** | 343 px |

**Umbral decidido por el usuario:** la tarjeta nueva mide **como mucho el 55 %** de la actual: **≤ 423 px** en los dos formatos. Lo comprueba `weather-simple-demo.spec.ts` (T6) con esa cifra fija.

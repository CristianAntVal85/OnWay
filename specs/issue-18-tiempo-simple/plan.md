# issue-18-tiempo-simple · Tarjeta del tiempo simple, con vista de detalle — Plan

Estado: **BORRADOR 4: decisiones resueltas por el usuario el 2026-11-13, pendiente del visto bueno para empezar** · Origen: issue #18 · Rama prevista: `hito/issue-18-tiempo-simple` (creada desde `main`, sin commits) · Fase: Cambio de alcance (`/sdd-change`), sin código.

**No es un hito de v1 ni añade requisitos.** Como `UI-rediseno` (issue #14): cambia cómo se ve y se reparte lo que ya existe. **Sin contrato, sin proveedor, sin base de datos y sin operaciones nuevas** (decisión del usuario, 2026-11-13: «con los datos que tenemos»). `getEnvironment` no cambia, así que el doc 06 y el OpenAPI tampoco.

**Revisión 2 (2026-11-13):** el usuario concreta la tarjeta: **solo tres cosas**, el símbolo del tiempo (sol, sol con nube, nube, nube con lluvia…), el termómetro con la temperatura actual en °C y el viento (icono y km/h). **Todo lo demás pasa a la vista de detalle.**

**Revisión 4 (2026-11-13):** el usuario resuelve las preguntas. Los tramos son Mañana 06–12, Tarde 12–18 y Noche 18–24, **cada uno con su horario en pequeño**. Se muestran **empezando por el tramo en curso** y siguiendo en orden: si ya estamos en la tarde, salen Tarde, Noche y Mañana, cada uno con su rango horario; no hace falta rótulo de «mañana»: el horario ya dice que es el día siguiente. **Sin tormenta. Umbral de «ocupa menos»: tarjeta ≤ 55 % de la actual.**

**Revisión 3 (2026-11-13):** el «símbolo del tiempo» no es uno solo: son **tres iconos por tramo del día** (las primeras horas, las horas centrales de la tarde y la tarde-noche). La posibilidad de lluvia se lee en cada uno (sol, sol con nube, nube, nube con lluvia…). Junto a ellos, el termómetro con la temperatura actual y el viento.

## 0. Decisiones del usuario (no se reabren)

1. Con los datos que ya devuelve `getEnvironment`: nada de pedir campos nuevos a Open-Meteo.
2. Enseñar **lo imprescindible** en la tarjeta de Inicio: **tres iconos del tiempo (mañana, tarde y noche), termómetro con la temperatura actual (°C) y viento (icono y km/h)**.
3. Un **botón** lleva a una **vista con todos los datos** que ya tenemos (lo que hoy muestra la tarjeta).
4. **Más visual y alegre**: iconos y color, menos texto que leer.

## 1. Qué cambia respecto a la issue (hay que decirlo)

La issue pide UV, probabilidad de lluvia, un código de estado del tiempo y un semáforo de «buenas condiciones». **El contrato no trae ninguno** (`WeatherPoint`: temperatura, viento, rachas, precipitación en mm, nieve, nubosidad, isoterma de 0 °C), así que:

| La issue pide | Esta propuesta |
|---|---|
| Icono principal del estado | **Tres símbolos, uno por tramo del día** (Mañana, Tarde, Noche), derivados de las **horas previstas** de ese tramo (nubosidad, precipitación, nieve y temperatura): sol, sol con nube, nube, nube con lluvia, nube con lluvia fuerte, nube con nieve; luna en vez de sol de noche |
| Temperatura actual | 🌡️ **termómetro con la temperatura en °C** |
| Descripción breve | Cada símbolo lleva su **rótulo corto** («Mañana · Despejado»…): es también su texto alternativo, así que no depende solo de la imagen |
| 💧 probabilidad de lluvia | **No hay probabilidad.** Cada tramo la muestra como **símbolo**: nube con lluvia si en ese tramo hay precipitación prevista, nube o sol si no. La cantidad en mm va al detalle |
| 🌬️ viento | 🌬️ **icono y km/h** (las rachas, al detalle) |
| ☀️ índice UV | **No se muestra** (no hay dato) |
| 🟢 semáforo de actividades | **Fuera**: sería una regla propia con umbrales de seguridad (doc 01 deja fuera la «predicción propia») y puede tranquilizar en falso |
| «Nube con trueno» (petición del usuario) | **No se puede derivar**: ningún dato nuestro dice que haya tormenta eléctrica, y un icono de rayo sin dato sería inventar. Entra solo si algún día se pide el código de estado al proveedor (cambio de contrato, fuera de este plan) |

Criterios de aceptación de la issue que **no se cumplen tal cual** por falta de dato: UV, probabilidad de lluvia, semáforo y tormenta. Hay que anotarlo en la issue al cerrarla.

## 2. Alcance

- **Requisitos:** RF-704 (previsión de montaña) y RF-705 (luz y luna) se siguen cumpliendo: lo que sale de la tarjeta pasa a la vista de detalle. D-18 y R-06 (altitud del punto, isoterma) no se tocan.
- **Operaciones:** 0 nuevas (`CURRENT_MILESTONE` sigue en `'H5'`, 59 montadas). **Invariantes:** ninguno nuevo; INV-30 y RN-26 (la posición no se guarda) se mantienen: la vista nueva reutiliza la ubicación en memoria de `DeviceLocationProvider`, sin la URL ni almacenamiento.
- **Dónde se ve la tarjeta:** Inicio (coordinador y administrador), Mis misiones (rescatista) y el detalle de una misión del rescatista (los tres usan `EnvironmentSection`).
- **Fuera:** UV, probabilidad de lluvia, semáforo, cualquier campo nuevo del contrato, boletines (RF-706), el mapa de Inicio (RF-707).

## 3. Diseño

**Tarjeta compacta** (`WeatherCard`, nueva): una fila de **tres iconos a color**, cada uno con su **rótulo y su horario en pequeño** («Mañana · 06–12 h», «Tarde · 12–18 h», «Noche · 18–24 h»; por el reloj de quien mira, el mismo que ya usa la tabla por hora), el **termómetro con la temperatura actual** en grande y el **viento con su icono y km/h**. **Orden:** primero el tramo en curso y después los siguientes; el que ya pasó va al final con su rango (el servidor no envía las horas ya pasadas, así que ese tramo es el de mañana y el horario basta para entenderlo). De 00 a 06 h el primero es Mañana. El tramo en curso usa las horas que le quedan. Nada más: ni nieve, nubosidad, isoterma, rachas, próximos días, tabla por hora, amanecer, atardecer ni luna. Los avisos `stale` y `unavailable` y la cita a Open-Meteo se conservan. Debajo, el botón **«Ver todo el detalle del tiempo»** (un enlace con aspecto de botón). La tarjeta de **Luz y luna** sale de Inicio y pasa entera al detalle.

**Vista de detalle** `/weather` (`PATHS.weather`, `EVERYONE`; sin entrada en la barra): ubicación (o misión) y altitud, **todo lo que mostraba la tarjeta y lo que ya no cabe en ella**: ahora (temperatura, viento y rachas, precipitación, nieve, nubosidad, isoterma de 0 °C), próximos días, detalle por hora y la tarjeta de Luz y luna. Estados de carga, vacío (sin ubicación: la misma explicación y el reintento), error y `stale`/`unavailable`; móvil y teclado. Recibe `?mission=<id>` si se venía de una misión; sin él usa la ubicación del dispositivo, que `DeviceLocationProvider` ya tiene en memoria (la coordenada no viaja en la dirección). Enlace de vuelta «← Volver».

**Lógica fuera de React (regla 9):** en `packages/geo/src/weather.ts`, funciones puras con su prueba. `weatherSymbol()`: entra nubosidad media, precipitación y nieve acumuladas, temperatura media y día/noche; sale uno de `clear | partly | cloudy | rain | heavy-rain | snow` (con variante noche para `clear` y `partly`): sol, sol con nube, nube, nube con lluvia, nube con lluvia fuerte, nube con nieve. `dayPartSymbols()`: recibe las horas previstas (`hourly`), la hora actual y una función que da la hora del reloj de cada instante (la web le pasa `Intl`), agrupa por tramo y devuelve los tres símbolos **ya en el orden de la tarjeta** (el tramo en curso primero), cada uno con su rango horario y el día al que pertenece (hoy o mañana). Umbrales fijados y probados; nunca inventa tormenta ni niebla porque no hay dato.

**Iconos y color:** SVG propios en línea (`apps/web/src/environment/weather-icons.tsx`), `aria-hidden`, sin dependencia nueva (constitución 12). Colores como **tokens** en `tokens.css` para oscuro y claro (`--wx-sun`, `--wx-cloud`, `--wx-rain`, `--wx-snow`, `--wx-wind`, `--wx-ice`), con contraste ≥ 3:1 sobre la superficie calculado por `theme-contrast.test.ts`; el color nunca es lo único que informa (cada icono lleva su texto); `forced-colors` cae a `currentColor`.

**Textos:** `packages/i18n` es/fr (rótulos de símbolo, viento, botón, vista de detalle). Los textos técnicos actuales se reutilizan en el detalle.

## 4. Qué cambia, por carpeta

`packages/geo` (`weather.ts`, `index.ts`, prueba) · `packages/i18n` (es, fr, types) · `apps/web` (`environment/weather-card.tsx` compacta, `environment/weather-detail.tsx` con lo que sale de la tarjeta, `environment/weather-icons.tsx`, `environment/environment-section.tsx` sin `LightCard` y con el botón, `pages/weather-page.tsx`, `app/routes.tsx`, `nav/navigation.ts`, `theme/tokens.css`, `styles.css`, pruebas) · docs. **No cambian:** `apps/api`, `packages/contracts`, `db/`, `infra/`, `data/seed`.

## 5. Decisiones con alternativa descartada

| # | Decisión | Alternativa descartada |
|---|---|---|
| D-W1 | Icono **derivado** de nubosidad, precipitación, nieve y temperatura | Pedir `weather_code` a Open-Meteo: cambia contrato, proveedor, caché y `providers-stub` (el usuario pidió no hacerlo) |
| D-W2 | La tarjeta solo lleva **símbolo, temperatura y viento**; isoterma, lluvia en mm, rachas, nieve, nubosidad y luz pasan al detalle (decisión del usuario) | Sustituir el UV por la isoterma u otro indicador en la tarjeta: más ruido, que es lo que se quiere evitar |
| D-W3 | Sin semáforo | Semáforo con umbrales propios: predicción propia y falsa tranquilidad |
| D-W4 | Vista **`/weather`** con su dirección, para que el botón sea un enlace (teclado, «atrás» y recarga funcionan) | Un diálogo o un despliegue en la misma página: no cabe todo en 375 px y no tiene dirección |
| D-W5 | Luz y luna **completas** al detalle; nada de luz en Inicio | Dejar la tarjeta de Luz y luna en Inicio o una línea de amanecer y atardecer: sigue el ruido |
| D-W7 | **Sin símbolo de tormenta** (no hay dato) | Rayo para «lluvia fuerte con rachas»: parecería un dato que no existe |
| D-W8 | **Tres tramos fijos** (Mañana, Tarde, Noche) por el reloj de quien mira, con su horario en pequeño y **el tramo en curso primero**; el pasado va al final con su rango, sin rótulo extra | Tramos «de aquí a 3 h, 6 h…» (no es lo que se pidió); un guion en el tramo pasado; la hora local del punto (el contrato no trae la zona horaria) |
| D-W9 | El símbolo de un tramo sale de **sus horas** (nubosidad media; lluvia o nieve si el total del tramo pasa un umbral) | Mirar solo la hora actual: no responde a «¿lloverá por la tarde?» |
| D-W6 | SVG propios con tokens | Emojis (se ven distinto en cada sistema y no siguen el tema) o librería de iconos (dependencia nueva) |

## 6. Riesgos

- **El tramo mezcla horas distintas:** una tormenta de 30 min en una tarde seca puede quedar sin icono de lluvia o, al revés, una llovizna dejar «lluvia» todo el tramo. Mitigación: umbrales de total (mm) y no de una hora, probados; el detalle por hora sigue a un clic.
- **Un símbolo mal derivado** da una idea falsa del tiempo (p. ej. «despejado» con rachas fuertes o isoterma baja, que ya no se ven en la tarjeta). Mitigación: umbrales conservadores, un rótulo que no promete más de lo que hay, el aviso de proveedor y un botón de detalle siempre visible.
- **Pierde visibilidad lo técnico** (rachas, isoterma, nieve, nubosidad, luz, por hora): queda a un clic, pero un clic más para quien lo usa.
- **Pruebas que describen la tarjeta antigua** (`home.test.tsx`, `device-location.test.tsx`, `environment-support.ts`, `h1-demo.spec.ts`) se reescriben; que el resto del E2E (118) siga verde.
- **Revisar el mapa de pruebas** de la vista nueva a 375 px y con la ubicación denegada.

## 7. Verificación

- `packages/geo`: `weatherSymbol` con una prueba por umbral y por día/noche; `dayPartSymbols` con horas ya pasadas, tramo vacío, cambio de hora de verano y los límites 06, 12 y 18 h. `theme-contrast` con los tokens nuevos. `@onway/web`: la tarjeta de Inicio muestra solo los tres iconos de tramo, la temperatura y el viento (sin precipitación, nieve, nubosidad, isoterma, rachas, próximos días, tabla por hora ni luz y luna), el botón enlaza a `/weather` con y sin `?mission=`, la vista de detalle lo trae todo; estados `stale`, `unavailable`, sin ubicación y error; es y fr.
- **Medición previa** (T1): altura de la tarjeta actual a 375 y 1280 px (`specs/issue-18-tiempo-simple/medidas.md`) y **umbral**: la nueva ≤ 55 % de la actual en los dos anchos. Sin él, «ocupa menos» no se puede comprobar.
- **E2E** `weather-simple-demo.spec.ts` (escritorio y 375 px; francés solo con teclado): Inicio sin ruido, el botón lleva al detalle, el detalle tiene todos los datos y vuelve. Suite entera en verde con `CI=1`.
- `pnpm lint`, `format:check`, `typecheck`, `test`, `build`; `test:api`/`test:db` sin cambios.

## 8. Documentos

`docs/02` §3.2 (fila de Meteorología, vista nueva «Tiempo en detalle», tabla de navegación sin cambios) · `docs/01` RF-704 y RF-705 (dónde se ve cada cosa) · `docs/04` §3 (iconos propios, `weatherSymbol` en `packages/geo`) · `docs/07` (sección del cambio) · `CLAUDE.md` (recuentos) · `docs/estado.md`. 03, 05 y 06 no cambian.

## 9. Preguntas

Resueltas el 2026-11-13: (1) tramos y orden como arriba; (2) sin tormenta (D-W7); (3) umbral ≤ 55 %. **Abierta:** ninguna; falta el visto bueno para empezar por T1.

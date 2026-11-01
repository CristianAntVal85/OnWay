# PoC · Motor de rutas (R-01)

Prueba técnica aislada que decide el motor de rutas de H3: **GraphHopper frente a Valhalla**, con tres pares reales de los Pirineos. Plan y tareas: `specs/PoC-motor-rutas/`. Criterios: doc 04 §7.3 y plan §4.

Esto **no es parte de la aplicación**: no está en el workspace de pnpm, ni en `compose.yml`, ni en el CI. Los datos pesados viven en `.data/` (ignorado por git).

## Reproducir

```
poc/motor-rutas/scripts/fetch-extract.sh     # baja los extractos regionales (~1,3 GB), comprueba su MD5 y deja .data/pyrenees.osm.pbf + pyrenees.sha256
node poc/motor-rutas/run-cases.mjs --check   # valida cases/*.json (los motores llegan en T2–T5)
```

Necesita Docker (construye `onway-poc-osmium`) y `curl`. Con el mismo `SNAPSHOT` del script y la misma versión de osmium sale el mismo extracto (misma suma SHA-256; comprobado dos veces seguidas). Resultado de la instantánea `261031`: 95 MB, 12,7 M de nodos, 771 000 vías y 11 000 relaciones (viales, barreras y restricciones de giro; caja real -1,98…3,30 / 41,76…43,29), SHA-256 `d479ba4e0dab4539f30b225b3a15b55bb7e4a2178e5e3430efa8c715ad9db706`.

## Datos y licencias (consultado el 2026-11-01)

| Pieza | Versión | Licencia | Fuente |
|---|---|---|---|
| Datos de OpenStreetMap vía Geofabrik | instantánea `261031` (2026-10-31) | ODbL 1.0; atribución «© OpenStreetMap contributors» | `https://download.geofabrik.de/` (siete regiones: Navarra, Aragón, Cataluña, Andorra, Aquitania, Midi-Pyrénées y Languedoc-Roussillon) |
| GraphHopper | 11.1 (publicada el 2026-09-29) | Apache-2.0 | `https://github.com/graphhopper/graphhopper/blob/master/LICENSE.txt`; `graphhopper-web-11.1.jar`, SHA-256 `8462f758d9ea49edaded557cec5c687a0a24f004ec371cd4daaeb0534824ea33` (T2) |
| Valhalla | 3.9.1 (publicada el 2026-10-06) | MIT (el `LICENSE.md` remite a `COPYING`, que es la MIT) | `https://github.com/valhalla/valhalla/blob/master/COPYING` (T3) |
| osmium-tool | 1.15.0 (paquete de Debian bookworm; la última de upstream es la 1.19.0) | GPL-3.0 (libosmium, BSL-1.0) | `https://github.com/osmcode/osmium-tool/blob/master/LICENSE.txt` |

- Las imágenes se fijan por huella (`@sha256:`). La de `osmium` (base `debian:bookworm-slim`) ya lo está en `docker/osmium/Dockerfile`; las de GraphHopper y Valhalla se fijan en T2 y T3, que son quienes las usan.
- El código de los motores no se copia al repositorio: solo se ejecutan en contenedores locales. Nada de esto entra en la aplicación hasta que H3 se planifique con el motor elegido.

## Casos (`cases/pairs.json`)

Tres pares fijados por el usuario el 2026-11-01. Las coordenadas son las de los objetos de OSM indicados (centro del objeto si es un área), tomadas de la instantánea `261031`:

| Par | Origen | Destino | Nota |
|---|---|---|---|
| `coronas-aneto` | Refugio de Coronas (`way/374407667`, 1965 m) | Aneto (`node/4252339778`, 3404 m, «Tuca d'Aneto / Maladeta de Corones») | El origen ya es un refugio de montaña: el «inicio del sendero» es el propio origen |
| `bujaruelo-brecha` | Aparcamiento de Bujaruelo (`way/140315162`) | Brèche de Roland (`node/2191612631`, 2807 m) | El destino está sobre la frontera (`touchesBorder`); si el motor pasa por el lado francés se anota en T4 |
| `ordesa-perdido` | Aparcamiento de la Pradera de Ordesa (`way/97212138`) | Monte Perdido (`node/948790896`, 3349 m en OSM) | Ver supuestos |

Supuestos a confirmar con el usuario:

- **«Parking de Ordesa»:** en OSM el único aparcamiento con «Ordesa» en el nombre es el del Centro de Visitantes (`way/97209630`, a unos 8 km por carretera del valle). Se usa el de la **Pradera de Ordesa** (`way/97212138`, final de la carretera y salida habitual hacia Góriz y Monte Perdido), porque el criterio 2 mide el tramo de sendero desde el inicio del sendero. Cambiar de aparcamiento es cambiar tres números en `pairs.json`.
- **Monte Perdido:** el nodo de OSM se llama «Punta de Treserols / Monte Perdido» y lleva `ele=3349`, no los 3355 m oficiales. Es el único pico de esa cima en la instantánea; se usa tal cual (su altitud no entra en el cálculo: la mide el servidor, no OSM).
- Origen y «inicio del sendero» coinciden en los tres pares. La clasificación `road`/`track`/`path` desde ese punto es lo que mide el criterio 2.

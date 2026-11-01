# H3 · Hoja de revisión de los pesos del perfil de montaña (P6)

Estado: **pendiente de revisión por una persona que conozca esas rutas** (plan P6: quien decida el usuario, antes de validar H3). Esta hoja no es un veredicto: es lo que esa persona necesita para darlo. Los pesos están en `infra/routing/mountain.json` (el motor los lee al arrancar; cambiarlos no exige tocar código) y su primera pasada razonada viene de la prueba técnica (`poc/motor-rutas/graphhopper/mountain.json`, documento 04 §7.6).

Los datos son reales solo en el motor (OpenStreetMap, ODbL, y el modelo de elevación de Copernicus): nada de esto se versiona. Las cifras de abajo salen de `poc/motor-rutas/results/h3-regression*.json`, medidas el 2026-11-01 con el motor de OnWay (su perfil, su altitud, el extracto de los Pirineos de la instantánea `261031` de Geofabrik).

## 1. Qué hace cada peso

El motor reparte «prioridad» entre 0 y 1 a cada tramo: 1 es neutro, menos es peor, 0 está prohibido. Una ruta es mejor cuanto menos pierde. No hay pesos mayores que 1: «preferir sendero» se consigue castigando la carretera.

| Peso | Valor | Para qué | Qué mirar |
|---|---|---|---|
| Sin acceso a pie | 0 | Nunca pasar por donde no se puede andar | — |
| Dificultad SAC T6 o más (`hike_rating ≥ 6`) | 0 (prohibido) | Una ruta de rescate no propone trepadas ni pasos expuestos | ¿Hay algún paso T6 que sí haga falta? |
| SAC T5 (`== 5`) | ×0,3 | Solo si no hay otra salida | ¿Un rescatista aceptaría T5 sin avisar? |
| SAC T4 (`== 4`) | ×0,6 | Se admite si compensa el atajo | Con ×0,6, ¿el motor pasa por T4 cuando hay un T3 algo más largo? |
| Carreteras de coche (primaria, secundaria, terciaria, residencial, sin clasificar, servicio, calle residencial) | ×0,5 | Sirven para llegar al inicio del sendero, pero a igual longitud gana la pista o el sendero | ¿Quedan rutas con tramos largos de asfalto que un equipo evitaría? |
| Velocidad por pendiente | ≥ 15 %: 1,5 km/h · ≥ 7 %: 2,5 km/h · ≥ 4 %: ×0,85 · ≤ −4 %: ×1,05 | Que el coste del tramo refleje el esfuerzo (como el perfil de a pie con desnivel de serie) | No se muestra ningún tiempo (D-03): solo influye en qué ruta se prefiere |
| Límite de pendiente | no expuesto | El motor guarda la pendiente máxima en 5 bits y satura en 31 %: con un límite ≤ 30 % ninguno de los tres pares tiene ruta (no hay otra salida). Por eso `generateRoutes` no lo ofrece | ¿Interesa un aviso del tipo «esta ruta tiene un tramo de más de X %»? (hoy la pendiente máxima ya se muestra en el detalle) |

Además, la **estrategia de alternativas** (servidor, `apps/api/src/routing/`): se piden las alternativas propias del motor y, si dan menos de las pedidas, se bloquean 200 m en medio de la ruta principal y se vuelve a preguntar; se acepta un rodeo si comparte **a lo sumo el 70 %** con lo ya guardado. ¿Es razonable que dos alternativas puedan compartir hasta el 70 %?

## 2. Lo que sale con los pesos actuales (extracto real de los Pirineos)

Ruta principal y segunda alternativa de cada par, con distancia y subida **medidas por OnWay** (no por el motor) y la composición por tipo de vía.

| Par | Principal | Composición principal | Segunda | Qué comparte la segunda |
|---|---|---|---|---|
| Refugio de Coronas → Aneto | 5,6 km, +1426 m | 92 % sendero, 8 % pista | 8,1 km, +1618 m | 43 % (alternativa propia del motor) |
| Aparcamiento de Bujaruelo → Brecha de Rolando | 9,1 km, +1572 m | 99 % sendero, 1 % pista | 10,9 km, +1774 m | 68 % (rodeo por bloqueo) |
| Pradera de Ordesa → Monte Perdido | 15,5 km, +2293 m | 87 % sendero, 12 % pista, 1 % carretera | 19,6 km, +2641 m | 24 % (rodeo por bloqueo) |
| Gavarnie → Vignemale (lado francés) | 17,4 km, +2228 m | 72 % sendero, 24 % pista, 4 % carretera | **36,8 km, +3820 m** | 28 % (rodeo por bloqueo) |

**Atención a la última fila:** la segunda alternativa de Gavarnie → Vignemale es más del doble de larga que la principal (36,8 frente a 17,4 km). El motor la da por válida porque comparte poco con la principal, pero un equipo probablemente no la querría. Hoy no hay un tope de «cuánto más larga» (solo el reparto máximo del 70 %); si esta persona está de acuerdo, el tope sería una propuesta para después de H3. Los tres pares del usuario y el francés responden en menos de 130 ms (p95) con el motor de OnWay. Las pendientes máximas de las principales son 67 %, 55 % y 100 % (`coronas-aneto`, `bujaruelo-brecha`, `ordesa-perdido`): son tramos de la propia ruta en terreno muy escarpado, no un error de medida (la altitud es la de Copernicus GLO-30 de OnWay, suavizada con la ventana de 60 m del documento 04 §7.4).

## 3. Cómo revisarlo

1. Levantar la pila con datos reales (`docker compose up --wait`; la primera vez baja ~1,3 GB de red de caminos y ~0,8 GB de mapa y relieve, y convierte el relieve en ~10 minutos).
2. Con un coordinador (`coordinador@example.org`, contraseña pública de demostración en `data/seed/README.md`), abrir *Rutas → Generar rutas* y probar rutas que se conozcan: de un aparcamiento a un refugio, a un collado, a una cima. Con 3 o 4 alternativas.
3. Para cada par: ¿la ruta principal es la que propondría un equipo? ¿Las alternativas son opciones reales o rodeos absurdos? ¿Hay carretera o pista donde habría sendero (o al revés)? ¿Algún paso de dificultad que no se debería proponer?
4. Anotar abajo lo que cambiaría. Un peso se cambia editando `infra/routing/mountain.json` y reiniciando `routing` (`docker compose restart routing`; reconstruye el grafo solo si cambió la red). Después de cualquier cambio se repite la regresión real (`infra/scripts/routing-regression.sh`, documento 04 §12).

## 4. Resultado de la revisión

| Fecha | Quién | Pares probados | Qué cambiaría (peso, de qué a qué, por qué) |
|---|---|---|---|
| — | — | — | Sin hacer |

# OnWay — Documento 02: Flujo del coordinador y estructura de vistas

Versión: 1.12 (borrador) · Fecha: 2026-11-22 · Depende de: documento 01 (v1.9)

Este documento define cómo recorre la app un coordinador, qué vistas existen, qué contiene cada una y qué puede hacer cada rol en ellas. Los IDs RF, RN, D y Q remiten al documento 01. Los elementos marcados *(propuesto)* no los has definido tú y están pendientes de confirmar. Lo marcado **segunda entrega** va en la segunda fase de v1 (D-21).

Los **15 bocetos de baja fidelidad** acompañan a este documento (lienzo aparte). La sección 13 indica qué boceto corresponde a cada vista.

---

## 1. Flujo principal del coordinador

```mermaid
flowchart TD
    A[Acceso: login] --> B[Inicio informativo]
    B --> C[Misiones]
    B --> D[Crear misión]
    B --> R[Rutas: biblioteca]
    B --> T[Equipos]
    B --> AD[Administración: solo administrador]
    D -->|Guardar con los 3 campos obligatorios| E[Detalle de misión: En planificación]
    C --> E
    R --> N[Nueva ruta: generar, importar, dibujar]
    R --> S[Buscar rutas por punto - 2.ª entrega]
    S --> AP[Adaptar ruta: cortar y recalcular el final - 2.ª entrega]
    E --> V[Voluntarios y participantes]
    V --> F[Ficha del voluntario]
    E --> G[Puntos: origen, intermedios, reunión]
    E --> H[Añadir ruta desde la biblioteca]
    H --> I[Comparar y validar]
    E --> ACT[Activar misión]
    ACT --> J[Misión Activa: voluntarios se ofrecen]
    J --> K[Cerrar misión: confirmar quién participó]
```

Principios de diseño:
- **La misión se crea en segundos** con lo mínimo y se completa desde su propio detalle (D-10). Nada de lo opcional bloquea el guardado ni el avance.
- **Las rutas no pertenecen a la misión.** Se crean y se guardan en la biblioteca, y la misión las añade (D-14). Lo que se trabaja una vez se reutiliza.
- **Lo que ve el rescatista nunca cambia solo.** La misión fija una versión de cada ruta (D-19).
- **Los datos personales se enseñan lo justo.** Las listas muestran lo mínimo; los datos de contacto están en la ficha; los datos sensibles no salen de la ficha propia ni de la administración (D-22, D-24, D-28).
- **El historial es lo que el coordinador confirma al cerrar**, no lo que se acepta al abrir (D-27).
- **Legible en campo.** La interfaz se ve en **oscuro** por defecto y tiene un tema **claro de alto contraste** para pleno sol; cada persona lo elige en Cuenta. El contenido va centrado bajo la cabecera y las páginas con mapa o con listas usan el ancho de la pantalla.

## 2. Navegación

Barra de navegación principal, visible en todas las vistas tras el login.

| Enlace | Administrador | Coordinador | Rescatista |
|---|---|---|---|
| Inicio | Sí | Sí | Sí (versión reducida) |
| Misiones | Sí | Sí | Sí (solo activas y cerradas) |
| Crear misión | No (Q-14) | Sí | No |
| Rutas (biblioteca) | Sí *(propuesto)* | Sí | No (Q-17) |
| Equipos | Sí *(propuesto)* | Sí *(propuesto)* | No |
| Administración | Sí | No | No |
| Mi perfil | No aplica | No aplica | Sí |
| Cuenta (idioma, **tema**, cerrar sesión) | Sí | Sí | Sí |

El administrador no tiene «Crear misión» porque no escribe misiones (Q-14 resuelta: no, 2026-10-31); ve Misiones y el detalle en solo lectura. Rutas aparece como enlace porque la biblioteca es independiente de las misiones. Equipos, porque la lista de equipos "ya formados" tiene que gestionarse en algún sitio (Q-12). Mi perfil, porque el rescatista mantiene sus datos, habilidades e historial. Administración, porque alguien tiene que aprobar cuentas y custodiar los datos sensibles (D-25).

En el boceto del rescatista (14) la barra tiene solo Misiones y Mi perfil.

**Cuenta** reúne el **nombre visible**, el idioma (que se guarda en la cuenta: es el de los correos y el inicial en cualquier navegador; si no se puede guardar, el cambio vale solo en este navegador y se avisa), el **tema**, **cambiar la contraseña** (actual, nueva y repetida; la sesión actual sigue y se cierran las demás; una contraseña actual errónea cuenta para el bloqueo) y cerrar sesión (construido en `H5-perfil`). El tema ofrece tres opciones, con teclado y objetivos de 48 px: «Oscuro» (el que se ve si no se ha elegido nada), «Claro (alto contraste)» y «Como el sistema» (la única que sigue la preferencia del sistema). Se aplica al momento, se recuerda solo en este navegador (no viaja al servidor) y vale también en la pantalla de acceso, sin destello al cargar. El mapa de carreteras sigue al tema; el satélite y el topográfico no.

## 3. Vistas

### 3.1 Acceso: login, registro y espera

Boceto 1. Una sola pantalla de entrada con tres estados.

**Login**
- **Campos:** correo, contraseña.
- **Acciones:** entrar, **«He olvidado mi contraseña»** y **«Crear una cuenta»** (dos enlaces bajo el botón; construido en `H5-acceso`).
- **Errores:** credenciales incorrectas (mensaje genérico, sin revelar si el correo existe), cuenta desactivada, bloqueo temporal por intentos.
- **Resultado:** lleva a Inicio (RF-101). Si es un rescatista con el perfil incompleto, lleva antes al formulario de alta (3.9). Si la cuenta está pendiente, lleva a la pantalla de espera.
- Al iniciar sesión, el navegador pide permiso para leer la ubicación del dispositivo, que usa el Inicio (RF-708). Si se deniega, el acceso sigue con normalidad.

**Registro** (RF-104)
- **Campos:** correo, nombre visible, contraseña, repetir contraseña y **código de invitación de la organización**, que asocia la solicitud a su organización (OnWay inicia sesión con el correo: no hay nombre de usuario, D-28). La vista valida en el cliente los obligatorios, el formato del correo, la contraseña y que coincida con su repetición, con los mismos esquemas que el servidor.
- El registro nunca concede el rol de coordinador (RN-25).
- Un correo ya registrado no revela de quién es.
- Al enviarse: pantalla **«Solicitud recibida»** («Un administrador de tu organización debe aprobarla. Hasta entonces podrás iniciar sesión, pero no acceder a ningún dato») con enlace al inicio de sesión; el foco pasa a su título. No se abre sesión sola (RN-25). Un código inválido, el de otra organización y un correo ya registrado dan **el mismo mensaje** («No hemos podido completar el registro…»), sin revelar cuál es el motivo. Si se piden demasiados registros desde la misma conexión, aparece el aviso de espera (`RATE_LIMITED`).
- Un código de invitación se escribe tal como se recibe (mayúsculas y guiones); solo se recortan los espacios de los extremos.

**Recuperar contraseña** (Q-33, `H5-acceso`)
- **Petición** (`/forgot-password`): un campo, el correo. La respuesta es siempre la misma («Si existe una cuenta con ese correo, te hemos enviado un enlace…»), exista o no, y no se puede saber si el envío tuvo éxito.
- **Enlace:** de un solo uso, caduca a 1 h, y lleva el token en el fragmento (`/reset-password#token=…`). En desarrollo no se envía ningún correo: el enlace sale por el registro del `api` (puerto `Mailer`, `ConsoleMailer`; `docker compose logs api`). El correo sale en el idioma de la cuenta.
- **Nueva contraseña** (`/reset-password`): la web lee el token del fragmento y lo quita de la barra de direcciones; pide contraseña y repetirla. Un enlace usado, caducado, mal formado o sin token da el mismo mensaje («Enlace no válido») con «Pedir otro enlace». Al terminar aparece «Contraseña cambiada» con el enlace a iniciar sesión: se han cerrado todas las sesiones, también la de esta persona si la tenía abierta.

**Espera de aprobación** (RF-106)
- Mensaje: "Tu solicitud está pendiente. Un administrador de tu organización debe aprobarla".
- La persona no ve nada más: ni misiones, ni datos de la organización.
- Solo puede cerrar sesión. Al aprobarse, el siguiente acceso lleva al formulario de alta.

### 3.2 Inicio

Boceto 3. Vista informativa. No se edita nada desde aquí (RF-701). El criterio es mostrar lo que un alpinista consultaría antes de salir, en una sola pantalla.

**Ubicación para el tiempo (RF-704, RF-708, D-30).** El tiempo (tarjeta simple) se calcula por defecto para la **ubicación del dispositivo**, leída al iniciar sesión; la luz y la luna se ven en la vista de detalle (3.2.1) para el mismo punto. El título de la tarjeta indica "📍 Mi ubicación". Si el coordinador pincha una de las **misiones activas** de la lista, la tarjeta cambia al **objetivo de esa misión** y el título lo indica. Un enlace "Volver a mi ubicación" restablece la posición del dispositivo.

| Bloque | Qué muestra | Prioridad |
|---|---|---|
| Misiones activas | Tarjetas **pinchables** con nombre, coordinador responsable, voluntarios por decidir, participantes aceptados y pendientes (rutas sin validar, sin origen). La tarjeta elegida queda resaltada | Should (RF-703) |
| Meteorología | **Tarjeta simple** (issue #18): tres iconos por tramo del día con su horario (Mañana 06–12 h, Tarde 12–18 h, Noche 18–24 h; el tramo en curso primero), el **termómetro con la temperatura actual** y el **viento** (icono y km/h), calculados a la **altitud del punto**. Un botón «Ver todo el detalle del tiempo» lleva a la vista de detalle (3.2.1) | Should (RF-704) |
| Luz y luna | Ya no está en Inicio: se ve en la vista de detalle del tiempo (3.2.1) | Should (RF-705) |
| Boletines oficiales | Enlaces a la predicción de montaña de AEMET y Météo-France y, en temporada, a los boletines de aludes, según la zona mostrada | Could (RF-706) |
| Mapa | Posición del dispositivo y objetivos de las misiones activas, con la misión elegida resaltada | Could (RF-707) |
| Acceso rápido a Crear misión | Botón destacado (solo coordinador) | Must |

- **Por qué a la altitud del punto:** los modelos meteorológicos suavizan el relieve. Una previsión a nivel de valle puede errar varios grados en una cima (R-06). Es lo que distingue una previsión de montaña de una de ciudad.
- **Proveedores:** Open-Meteo como principal y Meteoblue como alternativa, ambos con planes gratuitos no comerciales (D-18). Los datos se guardan en caché por punto y altitud redondeados, por los cupos gratuitos (R-09).
- **La posición del dispositivo no se guarda** (RN-26). Solo se usa para esa consulta, redondeada (~1 km).
- **Sin permiso de ubicación o sin señal:** la tarjeta muestra "Activa la ubicación o elige una misión". Está pendiente decidir si se usa el punto base de la organización como alternativa (Q-32).
- **Sin misiones activas:** mensaje claro y botón para crear una misión. El tiempo sigue mostrándose para la ubicación del dispositivo.
- **Fallo del proveedor meteorológico:** la tarjeta muestra "no disponible" o el último dato con su hora, y el resto del inicio sigue funcionando.
- **Rescatista:** versión reducida con las misiones activas, aquellas en las que se ha ofrecido (con su estado) y la misma tarjeta del tiempo simple (la luz y la luna, en el detalle, 3.2.1), pero **solo de su ubicación**: las tarjetas de sus misiones no llevan botón para cambiarla al objetivo, porque el tiempo del objetivo ya está en el detalle de cada misión. Sin ubicación, la tarjeta remite a abrir una misión (boceto 14).

### 3.2.1 Tiempo en detalle

Vista a la que lleva el botón «Ver todo el detalle del tiempo» de la tarjeta de Inicio, de Mis misiones y del detalle de una misión del rescatista (`/weather`; con `?mission=<id>` para el objetivo de una misión, sin él la ubicación del dispositivo). La puede abrir quien tiene acceso a la aplicación; no tiene entrada en la barra. Enlace «Volver».

- **Qué muestra:** la ubicación y su altitud; **ahora** (temperatura, viento y rachas, precipitación, nieve, nubosidad e isoterma de 0 °C); **próximos días**; **detalle por hora** de las próximas 24 horas; y la tarjeta de **luz y luna** (amanecer, atardecer, crepúsculos, fase lunar). Todo lo que antes mostraba Inicio.
- **Estados:** carga; sin ubicación (la misma explicación y el reintento que Inicio); error; dato guardado con su hora (`stale`); no disponible. La posición del dispositivo no se guarda ni viaja en la dirección (RN-26).
- **Los iconos de la tarjeta simple** se derivan en `packages/geo` de la nubosidad, la precipitación y la nieve de las horas de cada tramo. No hay probabilidad de lluvia, índice UV ni tormenta, y ninguna valoración de «buenas condiciones».

### 3.3 Misiones

Boceto 4. Lista de misiones de la organización (RF-204), con **pestañas por estado**.

| Pestaña | Contenido | Quién la ve |
|---|---|---|
| En planificación | Misiones en preparación | Coordinadores y administrador *(propuesto, Q-16)* |
| Activas | Misiones en curso | Todos |
| Cerradas | Histórico | Todos |

- **Cada elemento:** nombre, coordinador responsable, objetivo (coordenadas o lugar), orígenes, rutas (validadas / añadidas), participantes y voluntarios pendientes, fecha de creación.
- **Acciones:** abrir la misión, buscar por nombre, crear misión (atajo).
- **Estado vacío:** "No hay misiones" en la pestaña, con botón para crear.
- **Rescatista:** solo ve *Activas* y *Cerradas*, sin atajo de crear, con un indicador del estado de su oferta ("Pendiente", "Aceptado", "No seleccionado").

### 3.4 Crear misión

Boceto 5. Formulario en una sola página, con el mapa visible al lado para elegir puntos (RF-201). Una **barra inferior fija** con **Cancelar** y un botón grande **Crear misión**, siempre visible.

**Alto del mapa (medido en `UI-rediseno`).** Desde 1024 px de ancho el mapa va al lado y llena el alto de la ventana bajo la cabecera, sin hueco vacío debajo (56 % del alto de la ventana a 1024×768, 58 % a 1280×720, 76 % a 1920×1080 y 83 % a 2560×1440). Por debajo de 1024 px (móvil, tableta vertical, ventana al 125 % de zoom) el mapa va arriba y entero, con el 42 % del alto de la ventana entre 320 y 576 px (`clamp(20rem, 42dvh, 36rem)`): 341 px a 375×812, 320 px a 375×667 y 430 px a 768×1024. El primer campo queda debajo del mapa, sin solape, y la barra inferior fija deja sitio al foco.

**Sección 1 · Datos obligatorios**

| Campo | Notas |
|---|---|
| Nombre de la misión | Texto de 3 a 120 caracteres. Debe ser único entre las misiones no cerradas de la organización *(propuesto)* |
| Coordinador responsable | Selector con los coordinadores de la organización. Por defecto, el usuario actual |
| Punto objetivo | Tres formas de entrada (RF-401): coordenadas, clic en el mapa o dirección. La altitud se obtiene automáticamente |

El botón **Crear misión** se activa cuando las tres cosas son válidas.

**Sección 2 · Opcional (se puede añadir después)**

| Campo | Notas |
|---|---|
| Descripción o notas *(propuesto)* | Texto libre |
| Equipos | Selección múltiple de equipos activos. Se muestra su localidad |
| Rescatistas individuales | Selección múltiple de rescatistas de la organización con el perfil completo. Entran como aceptados (RF-804) |
| Puntos de origen | Cero o varios. Cada uno con nombre, nota y ubicación (tres formas de entrada) |
| Rutas | Se eligen de la biblioteca. Con la búsqueda por punto, una vez fijado el objetivo se mostrarán primero las **rutas existentes cercanas** (**segunda entrega**, RF-514) |

- **Validaciones del objetivo:** coordenadas dentro de rango (latitud entre -90 y 90, longitud entre -180 y 180). Si la dirección es ambigua se muestran candidatos. Si la dirección resuelve a otro país, se muestra el país para evitar confusiones en zona fronteriza.
- **Búsqueda de dirección:** se lanza al pulsar el botón de buscar, no mientras se escribe (documento 04, límites del servicio de geocodificación).
- **Al guardar:** la misión se crea *En planificación* y el usuario llega al detalle de la misión.
- **Crear rutas nuevas no está en el formulario.** Se hace desde la biblioteca o desde el detalle de la misión. Es un proceso con progreso y con resultados que hay que revisar y validar.

### 3.5 Detalle de misión (centro de trabajo)

Boceto 6. Vista central (RF-205). Todo lo que se añade después de crear la misión se hace desde aquí.

**Cabecera:** nombre, estado, coordinador responsable, coordenadas y lugar del objetivo. Acciones: editar datos, duplicar, **Activar misión** (si está en planificación), **Cerrar misión** (si está activa), **Reabrir** (si está cerrada).

**Lista de preparación** (no bloquea nada):
- Objetivo definido: se marca solo.
- Puntos de origen añadidos.
- Equipos o voluntarios aceptados.
- Al menos una ruta validada añadida.

Cada elemento pendiente enlaza a la acción que lo resuelve.

**Secciones** (pestañas o bloques):

| Sección | Contenido | Acciones del coordinador |
|---|---|---|
| Mapa | Objetivo, orígenes, puntos intermedios, puntos de reunión, rutas añadidas | Cambiar capa (satélite, topográfica, carreteras), mostrar u ocultar rutas |
| Voluntarios y participantes | Lista de rescatistas ofrecidos y aceptados (ver 3.7) | Aceptar, rechazar, quitar, añadir, asignar equipos |
| Puntos | Orígenes, intermedios obligatorios, puntos de reunión | Añadir, editar, borrar, importar desde GPX o KML |
| Rutas de la misión | Tabla comparativa y rutas en el mapa: versión fijada, estado de validación, origen, equipo asignado, métricas, disponibilidad | **Añadir ruta**, **Generar rutas** y **Pintar ruta** (en «Más ⋯» de la sección, con la misión abierta y con origen), cambiar versión, marcar no disponible, **quitar de la misión**, cambiar el nombre de la ruta y **Continuar a mano** (en el «⋯» de cada fila, en planificación o activa), exportar |
| Historial | Registro de cambios (RN-05) | Solo lectura |

**Rutas de la misión, tal como se construyó (H4).** La tabla comparativa lleva, de la versión **fijada**, distancia, subida, bajada, altitud mínima y máxima, pendiente máxima, composición, fecha de validación, origen y equipo (solo se muestra; el selector llega con los equipos en H5), con su propio desplazamiento horizontal enfocable en pantallas estrechas. Cada fila reúne en su primera celda el nombre, las marcas (*No disponible*, *Validación antigua*, borrador), los avisos y las acciones. Marcar varias rutas las resalta en el mapa y saca el perfil de cada una. Con la misión cerrada o para el administrador no hay ningún control que escriba; ver el mapa y exportar siguen. **Añadir ruta** abre un diálogo (4.3) y **Validar** está en la fila de una versión fijada en borrador (4.4).

**Rescatista:** ve las secciones Mapa, Puntos y Rutas de la misión en solo lectura, y solo las versiones validadas (RN-03). No ve Voluntarios y participantes (RF-602). Tiene el botón **Me ofrezco como voluntario** o **Retirar mi oferta** (RF-605) mientras la misión esté activa. Si su perfil está incompleto, el botón lo lleva a completarlo (RN-20). Boceto 14.

### 3.6 Rutas (biblioteca)

Boceto 9. Vista nueva (RF-512). Es el fondo permanente de rutas de la organización. Sigue el modelo de **Wikiloc**: pantalla partida con la **lista a la izquierda y un mapa grande a la derecha**.

**Lista (izquierda)**
- Tarjetas con casilla de selección, nombre, estado de la última versión (Borrador, Validada, Archivada), distancia, desnivel, altitud máxima, antigüedad de la validación y número de misiones donde se usa.
- La lista muestra las rutas del **área visible del mapa** y se actualiza al moverlo. Una opción permite buscar solo al pulsar "Buscar en esta zona".
- Pasar el ratón por una tarjeta resalta su trazado en el mapa, y al revés.
- Filtros: estado, distancia, desnivel, antigüedad de la validación y búsqueda por nombre o lugar. Etiquetas si se acepta Q-21. Orden y paginación.
- Acciones sobre la selección: **exportar** y archivar. En la vista de **archivadas** (`?status=archived`) la selección también se puede **eliminar** («Eliminar seleccionadas»): confirmación que dice cuántas rutas son y que no se puede deshacer; solo se eliminan las que no están en ninguna misión. En las demás vistas, incluido el detalle, no hay botón de eliminar (issue #17). Botones **Generar rutas**, **Dibujar ruta** e **Importar ruta**. La composición por tipo de vía (barra y texto) es real en lo generado o dibujado pegado a los caminos; en lo importado o dibujado en línea recta dice «sin clasificar».

**Mapa (derecha)**
- Capas satélite, topográfica y carreteras, conmutables.
- Botón de "mi posición".
- Trazados de las rutas de la lista, con el seleccionado resaltado.
- **Segunda entrega:** dibujar una zona y hacer clic en un punto para buscar las rutas que pasan cerca (RF-514).

**Nueva ruta** (tres vías)

*A) Generar* (RF-501, RF-507; vista `/routes/generate`)
1. El coordinador elige punto de inicio y punto final con las tres formas de entrada.
2. Opcionalmente, puntos intermedios obligatorios y **zonas a evitar**: una lista con casillas de las zonas de la organización (y de la misión, si viene de una), **Dibujar una zona** (toques en el mapa; al menos tres vértices; la tabla de coordenadas es la alternativa de teclado), motivo opcional y borrar. Las rutas no cruzan las zonas marcadas.
3. Elige el número de alternativas (1 a 4) y el **nombre, obligatorio**: se propone el del punto de inicio (desde la misión, el del origen elegido, y sigue al selector hasta que el coordinador escribe; desde la biblioteca, la dirección si se eligió por dirección; si no, vacío) y se añade el número de la alternativa («Collado Norte 1», «Collado Norte 2»…). Sin nombre no se genera.
4. La app pide el cálculo (un trabajo en segundo plano) y muestra el progreso, sondeando cada 1,5 s. La interfaz no se bloquea.
5. Cada alternativa queda como una ruta nueva en *Borrador*, versión 1, con las métricas del servidor y su composición real. El resultado es una tabla comparable (distancia, subida, bajada, tipo de vía) con el enlace a cada ruta, el resaltado en el mapa y **Generar otras rutas**. El motor puede devolver menos alternativas de las pedidas si la red no ofrece más; nunca repite una.
6. Si no hay ruta posible, un mensaje lo indica y propone mover los puntos o quitar alguna zona. Mensajes propios para «fuera de la zona que cubre el motor» y «el motor no responde» (el resto de la aplicación sigue).

*B) Importar* (RF-510)
1. Seleccionar un archivo GPX o KML.
2. Vista previa sobre el mapa.
3. La app recalcula las métricas con su modelo de elevación (RN-10).
4. El coordinador pone nombre y guarda. Entra como *Borrador*.
5. Errores: archivo inválido, vacío o demasiado grande. No se guarda nada.

*C) Dibujar a mano* *(propuesto, Should)*
1. El coordinador marca puntos sobre el mapa con el interruptor **Pintar ruta** (activado al entrar; desactivado, tocar el mapa no añade puntos y el mapa se mueve como siempre; con teclado, la lista de coordenadas). Los puntos se unen en línea recta. Si marca la casilla **«Unir los puntos siguiendo los caminos»** (desmarcada de serie: dibujar a mano se usa cuando el camino no está en la red; 2 a 50 puntos), pulsa **Calcular la ruta por los caminos**: el servidor los une en orden por la red y devuelve la línea, las métricas y la composición como vista previa (nada se guarda; si se mueve un punto, la vista previa se retira).
2. Se guarda como *Borrador*, marcada como modificada manualmente. Con la casilla desmarcada se guarda en línea recta y queda «sin clasificar». La edición posterior de vértices sigue siendo en línea recta.
3. **Desde una misión** (`?mission=`, «Más ⋯ → Pintar ruta» de la sección de rutas): el primer punto es el origen elegido (selector si hay varios), el objetivo se ve en el mapa y **Terminar en el objetivo** lo añade como último punto. El nombre es obligatorio y se propone el del origen. Al guardar, la ruta se añade a la misión con su versión 1 fijada y se vuelve a la misión.

*D) Continuar a mano* (RF-505)
1. Desde el detalle de la ruta («Más ⋯ → Continuar a mano») o desde el «⋯» de su fila en la misión. Se ve la versión de partida.
2. **Hasta dónde vale:** tocar la ruta elige el punto de corte (el vértice más cercano; a más de 200 m de la ruta no vale); el campo **Conservar los primeros N km** hace lo mismo con teclado. La parte conservada se ve con el color de la ruta y el resto, atenuado.
3. **Tramo a mano:** con **Pintar ruta**, cada toque añade un punto después del corte, unido en línea recta; deshacer, borrar y lista de coordenadas como al dibujar. Desde una misión, **Terminar en el objetivo**.
4. Guardar crea la **versión siguiente** en *Borrador* (la de partida no cambia). El servidor toma la parte conservada de la versión guardada, con sus tipos de vía, cuenta el tramo a mano como «sin camino» y mide el conjunto. La versión nueva **no se fija sola** en la misión: al volver, un aviso dice que hay que validarla para fijarla (RF-518).

**Buscar rutas por punto** (RF-514, **segunda entrega**)
1. El coordinador indica un punto (por defecto, el objetivo de la misión en la que está trabajando) o hace clic en el mapa.
2. Ajusta el radio. Por defecto se muestran primero las rutas que pasan dentro del radio y, debajo, las más cercanas.
3. Cada resultado muestra la **distancia de la ruta al punto** y marca en el mapa el lugar de la ruta más próximo.
4. Puede comparar varios resultados en el mapa y en la tabla de métricas, y añadirlos a la misión.
5. Sin resultados: "No hay rutas a menos de X km", con opción de ampliar el radio o crear una ruta nueva.

**Adaptar ruta** (RF-515, **segunda entrega**)
1. Desde un resultado o desde el detalle de una ruta: **Adaptar**.
2. El coordinador elige el punto de corte sobre la ruta (por defecto, el más cercano al nuevo objetivo) y el nuevo punto final.
3. La app conserva el tramo hasta el corte sin cambios y calcula solo el tramo restante.
4. El coordinador revisa y elige **Guardar como nueva versión** o **Guardar como nueva ruta** (con otro nombre). Esta segunda opción crea una ruta derivada (RF-517).

En la primera entrega, **Guardar como nueva ruta** también existe al editar una ruta a mano: es la derivación sin el cálculo automático del tramo final.

**Detalle de ruta** (boceto 10)
- Mapa, perfil de elevación y métricas de la versión seleccionada.
- Historial de versiones: fecha, autor, estado, notas. Se puede abrir cualquier versión anterior.
- "Deriva de": enlace a la ruta de origen, si existe.
- "Derivadas": rutas creadas a partir de esta.
- "Usada en": misiones (activas, en planificación, cerradas) y qué versión fija cada una. En las misiones en planificación o activas, quien escribe tiene **Quitar de la misión** (confirmación en la fila); las cerradas dicen «solo lectura» y no tienen botón (RN-09). Si archivar falla porque la ruta está en una misión, el mensaje dice en cuáles y que se quita desde aquí.
- Acciones (una fila, UI-simplificacion): **Validar** (acción principal, solo con la versión en borrador), **Editar ruta** (el editor guarda como versión nueva o, desde su desplegable, como ruta nueva), **Exportar ▾** (GPX, KML) y **Más ⋯** (Cambiar nombre, Continuar a mano, Duplicar ruta —derivar sin editar, RF-517— y Archivar ruta). Una ruta archivada solo ofrece Exportar y Duplicar. **Cambiar nombre** no crea versión (el nombre es de la ruta): lo ven igual las misiones que la usan, también el rescatista, y la auditoría guarda el nombre anterior.
- Una ruta usada en alguna misión no se puede eliminar, solo archivar (RN-14). El detalle no elimina: para borrar una ruta se quita de sus misiones, se archiva y se elimina desde la lista de archivadas.

### 3.7 Voluntarios y participantes (dentro de la misión)

Boceto 7. Vista pensada para decidir rápido y en bloque, **al estilo de una bandeja de correo** (RF-803).

**Disposición**
- Barra superior: casilla "seleccionar todos", contador ("12 seleccionados"), acciones en bloque, buscador y filtros.
- Cada fila: **casilla a la izquierda** y, a la derecha, **nombre, equipo y localidad del equipo**, más el estado y la fecha de la oferta (D-22).
- Un rescatista sin equipo aparece con "Sin equipo" y sin localidad. Si pertenece a varios, se muestran todos con su localidad.
- La lista no muestra ningún otro dato personal (RN-21).
- A la derecha de la lista, la **ficha** del rescatista seleccionado.

**Selección**
- Casilla de cabecera: selecciona todos los de la página. Al hacerlo aparece el aviso "Se han seleccionado los 25 de esta página. Seleccionar los 134 resultados", como en el correo.
- Quitar la selección con la misma casilla, o con "Ninguno".
- Seleccionar un rango con Mayús + clic *(propuesto)*.

**Acciones en bloque** (aparecen al seleccionar algo)

| Acción | Efecto | Confirmación |
|---|---|---|
| Aceptar | Pasa a Aceptado | No |
| Rechazar | Pasa a No seleccionado | No |
| Quitar | Elimina de la misión (aceptados o rechazados) | Sí, con número de afectados, y opción de deshacer *(propuesto)* |

**Filtros:** estado (Pendientes, Aceptados, No seleccionados), equipo, localidad del equipo, y búsqueda por nombre. Por defecto, la vista abre en *Pendientes*. Filtrar por habilidad llega en la segunda entrega (RF-811).

**Ficha del voluntario**

Al pulsar sobre un nombre, se abre la ficha en el panel lateral con:
- Nombre, equipo o equipos y su localidad.
- **Cursos y habilidades** (RF-808), cada curso con un enlace **"📎 abrir certificado"** si lo adjuntó (D-29). Cada apertura queda registrada *(propuesto, RN-24)*.
- **Teléfono y correo** (D-28). El coordinador los ve de quienes se ofrecieron o fueron añadidos a sus misiones *(propuesto, RN-23)*.
- Estado y fecha de la oferta en esta misión.
- **No muestra documento de identidad ni dirección, ni el historial de misiones** (RN-18, D-24). El pie de la ficha lo recuerda: "Aquí no aparecen documento ni dirección".

Desde la ficha se puede aceptar o rechazar a ese voluntario.

**Otras acciones**
- **Añadir equipo:** sus miembros entran como Aceptados *(propuesto)*.
- **Añadir rescatista:** el coordinador elige un rescatista de la organización y entra como Aceptado (RF-804).

**Estados vacíos**
- Sin voluntarios: "Nadie se ha ofrecido todavía". Si la misión está en planificación: "Los rescatistas podrán ofrecerse cuando actives la misión".
- Sin resultados con los filtros: "Ningún rescatista coincide", con enlace para limpiar filtros.

**Casos límite**
- El rescatista retira su oferta mientras el coordinador tiene la lista abierta: la fila desaparece al actualizar, y el coordinador ve un aviso si intentaba actuar sobre ella.
- Una acción en bloque sobre una selección de varias páginas se aplica sobre los resultados filtrados, no sobre toda la misión.
- La lista cargada en pantalla no puede quedar obsoleta sin avisar: se actualiza periódicamente o con un botón de refrescar.

### 3.8 Equipos

Boceto 12. Vista de gestión de equipos de la organización (RF-801).
- Lista de equipos: nombre, **localidad**, número de miembros, estado.
- Detalle: miembros (nombre), añadir y quitar, desactivar el equipo.
- Crear o editar un equipo pide nombre y localidad. La localidad es lo que se enseña en la lista de voluntarios.
- "Agrupación" y "equipo" son lo mismo (D-26): no hay un nivel más.
- Los gestionan el administrador y el coordinador (Q-12, resuelta); el rescatista no entra en esta vista.

**Tal como se construyó (`H5-equipos`).** `/teams` lista los equipos con pestañas Activos y Archivados, búsqueda por nombre o localidad y paginación (todo en la dirección); cada fila lleva el nombre (enlace al detalle), la localidad y el **código de tres caracteres**, el número de miembros y «Editar». Crear y editar piden nombre, localidad y código; el código se propone de la localidad (Alicante → `ALC`) mientras nadie lo toque y un nombre o código repetido sale en su campo (`DUPLICATE_NAME`). `/teams/:teamId` enseña los miembros solo con su nombre (sin contacto, RN-21) con «Quitar» (confirmación), «Añadir miembros» (selector con búsqueda y paginación de rescatistas con el perfil completo; los que ya son miembros salen marcados) y «Archivar» o «Reactivar» (confirmación); un equipo archivado conserva sus miembros y no admite nuevos. En la misión, la columna Equipo de «Rutas de la misión» es un selector de los equipos activos con «Sin equipo» (RF-805), solo con la misión no cerrada. El rescatista ve el nombre y la localidad del equipo de cada ruta (D-34) y el alias del coordinador responsable en lugar de su nombre (Q-36).

### 3.9 Alta y perfil del rescatista

Boceto 2 (alta) y boceto 15 (Mi perfil). Vista nueva (RF-806, RF-807, RF-808, RF-809). Es a la vez el **formulario de alta** y la pantalla **Mi perfil**.

**Alta (primer acceso)**

Cuando un rescatista accede por primera vez con la cuenta ya aprobada (D-25), debe completar este formulario antes de usar la app. Hasta entonces, el perfil está incompleto y no puede ofrecerse a misiones (RN-20). Un aviso lo recuerda.

| Bloque | Campos | Obligatorio | Notas |
|---|---|---|---|
| Datos personales | Nombre completo | Sí | |
| | Tipo de documento (DNI, NIE, pasaporte, otro) | Sí | *(propuesto)* para admitir rescatistas franceses |
| | Número de documento | Sí | Para DNI y NIE se valida el formato y la letra de control. Para el resto, formato libre |
| Contacto | Teléfono | Sí | Lo ven administrador y coordinadores (D-28) |
| | Correo electrónico | Sí | **Es el correo del inicio de sesión.** Viene relleno y no editable. No se pide dos veces |
| Dirección | Calle, número, piso | Calle y número sí | |
| | Código postal, localidad, provincia, país | Sí | |
| Cursos y habilidades | Lista de entradas (ver abajo) | No | Se puede completar después |

El formulario indica qué datos ve cada uno: "Teléfono y correo los ven el administrador y los coordinadores. Documento y dirección se guardan cifrados: los ves tú y el administrador".

**Cursos y habilidades** (RF-808)

Cada entrada tiene: nombre, tipo (curso o habilidad), entidad que lo expidió (opcional), fecha y caducidad (opcionales) *(propuesto)* y **certificado adjunto opcional**, en PDF o imagen (D-29). Ejemplos: primeros auxilios en montaña, técnico de rescate, conducción 4x4, manejo de dron. El rescatista añade, edita y elimina las suyas. Un curso sin certificado es declarativo y se muestra sin la marca "adjunto".

**Mi perfil (después del alta)** · boceto 15

Dos bloques de datos separados a propósito:
- **Datos de contacto** (obligatorios): nombre completo, teléfono y correo (el de acceso, no editable aquí; cambiarlo es cambiar la cuenta). Los ven administrador y coordinadores.
- **Datos sensibles**: documento de identidad y dirección. Solo el rescatista y el administrador. Se muestran enmascarados.

Secciones:
- **Cursos y habilidades**, con columna de certificado ("📎 adjunto" o "Adjuntar").
- **Mis equipos:** los que le ha asignado el coordinador, con su localidad. Solo lectura.
- **Historial de misiones:** solo lectura, generado a partir de las misiones en que el coordinador **confirmó su participación al cerrarlas** (RF-809, RN-19, D-27). Haber sido aceptado y luego desmarcado no cuenta.
- **Mis datos y privacidad:** descargar mis datos, solicitar la eliminación (el historial se conserva anonimizado, RN-22, RF-812) y consultar quién ha accedido a mis datos sensibles *(propuesto)*.

**Quién ve qué**

| Dato | El propio rescatista | Coordinador | Administrador |
|---|---|---|---|
| Nombre, equipo, localidad del equipo | Sí | Sí | Sí |
| Cursos y habilidades | Sí | Sí | Sí |
| Certificado de un curso | Sí | Sí, con registro de la apertura *(propuesto)* | Sí, con registro de la apertura *(propuesto)* |
| Teléfono y correo | Sí | Sí, de quienes se ofrecieron o fueron añadidos a sus misiones *(propuesto)* | Sí |
| Historial de misiones | Sí | **No** | Sí *(propuesto)* |
| Documento de identidad | Sí | **No** | Sí, con registro de cada consulta |
| Dirección completa | Sí | **No** | Sí, con registro de cada consulta |

**Errores y casos límite**
- Documento con formato o letra de control inválidos: mensaje claro, sin guardar.
- Documento ya registrado en la organización: el sistema lo detecta y lo rechaza sin revelar de quién es.
- El rescatista abandona el formulario a medias: queda como perfil incompleto y se le pide al volver.
- Certificado de tipo o tamaño no admitido: error claro, el curso no se guarda con el archivo.
- Cualquier dato sensible se muestra enmascarado por defecto (por ejemplo, el número de documento con los primeros dígitos ocultos) hasta que el propio usuario lo pide *(propuesto)*.

**Tal como se construyó (`H5-perfil`).** Con el perfil incompleto, cualquier vista lleva a «Completa tu perfil» y la barra solo tiene «Mi perfil» y «Cuenta» (el servidor no bloquea lecturas; RN-20 impide ofrecerse). El formulario lleva el correo de la cuenta en solo lectura, el aviso de quién ve qué, tipo de documento (DNI, NIE, pasaporte, otro) y número, teléfono y la dirección con el país (España, Francia, Andorra o Portugal); se comprueba en el cliente con los mismos esquemas que el servidor, y el documento ya registrado se dice en su campo sin decir de quién es. Al completarse, la app abre Mis misiones. En Mi perfil, el documento sale como `•••••••8Z` y la dirección como `•••••, 22600 Sabiñánigo (ES)`; «Mostrar» los enseña enteros (`getMySensitive`, sin guardarlos) y «Ocultar» los retira. «Corregir mis datos» abre el mismo formulario con lo guardado y envía solo los bloques que cambiaron. Cursos y habilidades llegan en `H5-habilidades` (abajo); historial y privacidad, en H6.

**Tal como se construyó (`H5-habilidades`).** «Cursos y habilidades» es una sección de Mi perfil y también va bajo el formulario del alta. Cada entrada enseña nombre, tipo, entidad, fecha y caducidad; un curso con certificado lleva «adjunto» y «Abrir certificado» (pestaña nueva, `inline`), y uno sin él, el botón «Adjuntar», que abre el diálogo de edición con el foco en el archivo. «Añadir» y «Editar» abren un diálogo que valida con el esquema del contrato; el archivo (PDF, JPG o PNG, hasta 10 MB) solo se ofrece en un curso, se sube primero y, si el tipo o el tamaño no valen, el error sale en su campo y la entrada no se guarda; «Quitar certificado» lo retira al guardar. El tipo no se cambia al editar y una fecha ya guardada no se puede vaciar (el contrato no admite `null`). Eliminar pide confirmación y el foco vuelve a la sección. Máximo 50 entradas. Coordinador y administrador abren el certificado por la ficha del voluntario (H6) y `getUser` (`H5-equipos`): en este hito la regla del servidor está hecha y probada, sin pantalla.

### 3.10 Administración

Boceto 13. Vista solo para el administrador de organización (RF-106, RF-813).

> Primer trozo, `H5-acceso` (2026-11-05, construido): de esta vista existen solo **Solicitudes de alta** y **Código de invitación**; la ruta `/admin` sigue cerrada a coordinador y rescatista. «Usuarios de la organización» y «Datos sensibles y accesos» siguen en el resto de H5.

**Solicitudes de alta** (parte superior)
- Lista tipo bandeja con casilla, nombre, correo y fecha de la solicitud. No muestra equipo ni «datos completos»: el perfil se crea al aprobar y lo rellena la persona en su primer acceso (Q-34).
- Pestañas **Pendientes / Aprobadas / Rechazadas**, búsqueda por nombre o correo y paginación; el estado, la búsqueda y la página viven en la dirección (`?tab=approved&q=…&page=2`). Las decididas no admiten más acciones.
- Casillas por fila y «Seleccionar las solicitudes de esta página»: solo se selecciona lo de la página visible (no hay «seleccionar todos los resultados») y la selección se vacía al cambiar de pestaña, búsqueda o página.
- Acciones en bloque: **aprobar**, que abre un diálogo donde se elige el rol (rescatista o coordinador, **sin ninguno marcado de antemano**; coordinador muestra el aviso de que concede permisos de edición), y **rechazar**, con su diálogo de confirmación y sin rol. La decisión es de todo o nada: si alguna solicitud ya estaba decidida o ya no existe, no cambia ninguna, se avisa y se relee la bandeja.
- Vacío, carga y error en cada pestaña. Al terminar, el foco vuelve al botón (si se cancela) o al título de la sección (si ya no existe).
- Hasta que se aprueba, la persona solo ve la pantalla de espera (3.1).

**Usuarios de la organización**
- Lista con nombre, rol, estado (activo, desactivado) y último acceso.
- Acciones: cambiar rol, desactivar y reactivar. Un administrador no puede quitarse a sí mismo el rol si es el último.
- Si se desactiva a un coordinador responsable de misiones, la app obliga a reasignarlas (RN-11).

**Datos sensibles y accesos**
- Desde un usuario, el administrador puede abrir sus datos sensibles (documento y dirección). Cada consulta queda registrada con quién, qué y cuándo (RF-810).
- Registro de accesos a datos sensibles y a certificados, con filtros por usuario y fecha *(propuesto)*.

**Código de invitación** (construido en `H5-acceso`): el administrador ve el código actual (16 caracteres en grupos de cuatro, en un recuadro monoespaciado) y cuándo se generó, lo **copia** (si el navegador no da acceso al portapapeles —sin HTTPS— se avisa y el código sigue a la vista para copiarlo a mano) y lo **regenera** con un diálogo de confirmación cuyo foco inicial está en «Cancelar». Al regenerarlo el anterior deja de valer en el acto; las solicitudes ya enviadas no cambian.

El administrador no escribe misiones (Q-14 resuelta: no); las lee, sin acciones de escritura.

**Tal como se construyó (`H5-usuarios`).** «Usuarios» es la sección de `/admin` entre la bandeja y el código de invitación: búsqueda por nombre o correo, filtros de rol y estado y paginación, todo en la dirección (`?users.q=…&users.role=…&users.status=…&users.page=…`, parámetros propios para no chocar con los de la bandeja). Solo lista a quien ya es miembro; las solicitudes pendientes y rechazadas siguen en la bandeja. Cada fila enseña nombre, correo, rol, estado y último acceso, y lleva a la ficha `/admin/users/:userId`, que vuelve a la lista con sus filtros. La ficha muestra contacto (correo, teléfono), rol, estado, último acceso y alta, cursos y habilidades (con «Abrir certificado», que avisa de que queda registrado) y equipos en solo lectura; nunca documento ni dirección (H6). Sus acciones: **Cambiar rol** (sin opción marcada de antemano, con el aviso de permisos de coordinador y de administrador), **Desactivar cuenta** y **Reactivar cuenta**, cada una con su diálogo con el foco inicial en «Cancelar». Si la persona es coordinadora con misiones abiertas, tanto cambiar el rol como desactivarla piden quién asume esas misiones (un coordinador activo que no sea ella) y las reasignan en el mismo cambio; las cerradas no cambian (RN-11, INV-11). El administrador puede cambiar o desactivar su propia cuenta salvo que sea el último administrador activo (`LAST_ADMIN`, que se explica en el diálogo y no cambia nada). Datos sensibles y auditoría siguen en H6.

## 4. Subflujos desde el detalle de misión

### 4.1 Voluntariado

1. La misión se activa (4.5). Desde ese momento es visible para los rescatistas.
2. El rescatista, con el perfil completo, abre la misión y pulsa **Me ofrezco como voluntario**. Queda *Pendiente*.
3. El coordinador abre *Voluntarios y participantes*, filtra, selecciona y **acepta** o **rechaza** (3.7). Puede abrir la ficha de un voluntario para decidir.
4. El rescatista ve el cambio de estado dentro de la app. En v1 no hay notificaciones activas.
5. El rescatista puede retirar su oferta mientras la misión esté activa.
6. Al cerrar la misión, el coordinador confirma quién participó (4.5). Solo esos quedan en su historial.

### 4.2 Añadir punto de origen

1. En *Puntos*, **Añadir origen**.
2. Nombre, nota y ubicación con las tres formas de entrada.
3. Se guarda y aparece en el mapa. No genera rutas por sí solo.

### 4.3 Añadir una ruta a la misión

Boceto 11. Desde *Rutas de la misión*, **Añadir ruta** abre un diálogo con tres caminos:

**A) Elegir de la biblioteca**
1. Se abre el selector de la biblioteca. Con la búsqueda por punto (**segunda entrega**), las **sugerencias** de rutas que pasan cerca del objetivo aparecen arriba (RF-514).
2. El coordinador elige una o varias. Si una ruta tiene varias versiones, se propone la última validada.
3. Opcionalmente asigna cada una a un origen de la misión y a un equipo (RF-805).
4. La misión **fija la versión** elegida (D-19).

**B) Crear una ruta nueva para esta misión**
1. Generar, importar o dibujar (3.6), con los puntos rellenados con el objetivo y un origen de la misión. En el detalle de la misión, la sección **Generar rutas** abre la vista de generar con `?mission=` (objetivo fijo, selector de origen, aviso de que las rutas se añadirán).
2. Si la misión no tiene origen, el botón de generar está desactivado con una explicación y enlace a *Añadir origen* (RN-08). Una misión cerrada tampoco genera.
3. Al terminar, la ruta queda en la biblioteca y se añade a la misión con su versión 1 fijada. Si la misión se cierra mientras se calcula, las rutas quedan solo en la biblioteca.

**C) Adaptar una ruta cercana** (**segunda entrega**)
1. Desde las sugerencias, **Adaptar** (3.6).
2. Al guardar como nueva ruta o nueva versión, se añade a la misión.

Una versión en *Borrador* puede añadirse a la misión, pero el rescatista no la ve hasta que se valide.

*Tal como se construyó (H4).* El diálogo **Añadir ruta** tiene dos pasos. Primero se elige de la biblioteca (búsqueda por nombre, filtro por la última versión, páginas de 10, hasta 20 a la vez aunque cambie la búsqueda); las rutas que la misión ya tiene salen marcadas y no se pueden elegir (INV-13). Después, por cada ruta, la **versión que fija la misión** (la última validada por defecto; si es un borrador se avisa de que el rescatista no la verá), el origen de la misión y una nota. Los otros dos caminos son enlaces del mismo diálogo: **Generar** (solo si la misión tiene origen, RN-08) e **Importar**, que llevan `?mission=`; importar pasa `addToMission` al guardar y vuelve a la misión avisando. Cada error tiene su mensaje: ya está en la misión (con su nombre), ruta archivada (derivar una copia), misión cerrada, algo que ya no existe. El lote es atómico: si falla una, no se añade ninguna. La adaptación de una ruta cercana (camino C) sigue siendo de la segunda entrega.

*Pintar ruta (issue-pintar-ruta).* El camino B gana **Pintar**: el editor de §3.6 C con `?mission=`, desde el origen elegido hasta el objetivo, que pasa `addToMission` al guardar y vuelve a la misión avisando. Una misión cerrada no lo ofrece.

### 4.4 Comparar y validar rutas

1. Tabla de rutas de la misión con distancia, desnivel positivo y negativo, altitud mínima y máxima, pendiente máxima, composición por tipo de vía, fecha de validación. Sin tiempo (D-03).
2. Selección de varias rutas para verlas superpuestas en el mapa, con el perfil de elevación.
3. **Validar** pide confirmación y muestra el aviso de que la ruta es una propuesta y no sustituye el criterio del equipo (RF-506).
4. Una versión validada pasa a ser visible para los rescatistas de esa misión, si está activa.
5. Si una ruta se vuelve inviable en esta misión, el coordinador la marca como *No disponible en esta misión* (RF-508). Los rescatistas la ven señalada, no desaparecida.
6. Si aparece una versión validada más reciente de una ruta ya añadida, la misión lo indica y el coordinador decide si actualiza (RF-518). **Nunca se actualiza sola.**
7. Si la validación tiene más de N días, la ruta aparece marcada como posiblemente desactualizada (RF-519).

*Tal como se construyó (H4).* La comparación es la tabla y los perfiles de las rutas marcadas; el aviso de versión nueva lleva **Actualizar a la versión N**, que pide confirmación y nunca se hace sola (RN-13). Una ruta marcada como no disponible se puede reactivar. Quitar una ruta de la misión pide confirmación y la deja en la biblioteca, desde donde vuelve a poder archivarse. Exportar da un solo GPX o KML con la versión fijada de cada ruta, borradores incluidos y sin las no disponibles.

### 4.5 Activar y cerrar misión

**Activar**
1. El coordinador pulsa **Activar misión**.
2. Si no hay ninguna ruta validada, la app avisa pero permite continuar *(propuesto)*.
3. La misión pasa a *Activa*, es visible para los rescatistas y se abre el voluntariado.

**Cerrar, confirmando la participación** (boceto 8, RF-208, D-27)
1. El coordinador pulsa **Cerrar misión**.
2. Se abre un diálogo: "¿Quién participó?". Lista los **rescatistas aceptados**, cada uno con una casilla y su equipo.
3. **Todos vienen marcados por defecto** *(propuesto)*, para que solo desmarque a quien no fue. Hay acciones "Marcar todos" y "Desmarcar todos", y un resumen en vivo ("3 de 4 han participado").
4. Un aviso explica el efecto: "Solo los marcados quedarán en su historial de misiones".
5. Al confirmar, la misión pasa a *Cerrada* y es de solo lectura para todos (RN-09).
6. Desaparece de *Activas* y se consulta en *Cerradas*.
7. El coordinador puede reabrirla como *Activa*. Al volver a cerrarla se confirma de nuevo la lista *(propuesto)*.
8. Cancelar el diálogo deja la misión *Activa*.

Si no hay ningún aceptado, el diálogo se salta y solo pide confirmar el cierre.

## 5. Ciclos de vida

**Misión**

```mermaid
stateDiagram-v2
    [*] --> EnPlanificacion: Crear con 3 campos obligatorios
    EnPlanificacion --> Activa: Activar
    Activa --> Cerrada: Cerrar y confirmar participación
    Cerrada --> Activa: Reabrir
```

**Versión de ruta**

```mermaid
stateDiagram-v2
    [*] --> Borrador: Generada, importada, dibujada o editada
    Borrador --> Validada: Validar (coordinador)
    Validada --> [*]: Inmutable
```

Una versión validada no se edita. Para cambiarla se crea una versión nueva en *Borrador*, que a su vez se valida. La ruta puede archivarse cuando ya no se quiere usar.

**Ruta dentro de una misión**

```mermaid
stateDiagram-v2
    [*] --> Añadida: Fijar versión
    Añadida --> NoDisponible: Marcar no disponible en esta misión
    NoDisponible --> Añadida: Reactivar
    Añadida --> [*]: Quitar de la misión
```

**Participación de un rescatista en una misión**

```mermaid
stateDiagram-v2
    [*] --> Pendiente: Se ofrece
    [*] --> Aceptado: Añadido por coordinador o por equipo
    Pendiente --> Aceptado: Coordinador acepta
    Pendiente --> NoSeleccionado: Coordinador rechaza
    Pendiente --> Retirado: El rescatista retira su oferta
    Aceptado --> Quitado: Coordinador quita
    NoSeleccionado --> Pendiente: Coordinador reconsidera
```

Dentro de *Aceptado*, al cerrar la misión se guarda además si **participó** (casilla confirmada) o no. Es un dato aparte del estado y es el que alimenta el historial.

**Cuenta de usuario**

```mermaid
stateDiagram-v2
    [*] --> Pendiente: Se registra
    Pendiente --> Activa: Administrador aprueba y asigna rol
    Pendiente --> Rechazada: Administrador rechaza
    Activa --> Desactivada: Administrador desactiva
    Desactivada --> Activa: Administrador reactiva
```

**Perfil de rescatista**

```mermaid
stateDiagram-v2
    [*] --> Incompleto: Cuenta aprobada
    Incompleto --> Completo: Rellena el alta
    Completo --> Completo: Edita sus datos
    Completo --> Eliminado: Solicita eliminación
```

Un rescatista con perfil *Incompleto* no puede ofrecerse a misiones (RN-20). En *Eliminado* se borran sus datos personales y su historial queda anonimizado (RN-22).

## 6. Permisos por acción

| Acción | Administrador | Coordinador | Rescatista |
|---|---|---|---|
| Ver Inicio | Sí | Sí | Sí (reducido) |
| Ver misiones activas | Sí | Sí | Sí |
| Ver misiones en planificación | Sí | Sí | No *(propuesto, Q-16)* |
| Crear misión | No | Sí | No |
| Editar datos de misión | No | Sí (Q-10) | No |
| Activar, cerrar o reabrir misión | No | Sí | No |
| Confirmar la participación al cerrar | No | Sí | No |
| Añadir equipos y rescatistas | No | Sí | No |
| Ofrecerse o retirar su oferta | No aplica | No aplica | Sí, solo a sí mismo, solo en misiones activas, con el perfil completo |
| Aceptar, rechazar o quitar voluntarios | No | Sí | No |
| Ver lista de voluntarios y participantes | Sí | Sí | No |
| Ver ficha del voluntario (habilidades, teléfono, correo) | Sí | Sí, de quienes se ofrecieron o añadió a sus misiones *(propuesto)* | No |
| Abrir un certificado | Sí, con registro | Sí, con registro *(propuesto)* | Solo los propios |
| Ver el historial de misiones de un rescatista | Sí *(propuesto)* | **No** | Solo el propio |
| Ver documento de identidad y dirección de un rescatista | Sí, con registro | **No** | Solo los propios |
| Editar el propio perfil, habilidades y datos | No aplica | No aplica | Sí |
| Solicitar la eliminación de los propios datos | No aplica | No aplica | Sí |
| Añadir puntos | No | Sí | No |
| Ver la biblioteca de rutas | Sí | Sí | No (Q-17) |
| Generar, importar, dibujar, adaptar y editar rutas | No | Sí | No |
| Validar versiones de ruta | No | Sí | No |
| Añadir, quitar o cambiar la versión de una ruta en una misión | No | Sí | No |
| Marcar una ruta no disponible en una misión | No | Sí | No |
| Ver rutas o versiones en borrador | Sí | Sí | No |
| Ver rutas validadas de una misión activa | Sí | Sí | Sí |
| Exportar rutas | Sí | Sí | Sí, solo validadas de misiones activas |
| Ver misiones cerradas | Sí | Sí | Sí |
| Gestionar equipos | Sí *(propuesto, Q-12)* | Sí *(propuesto, Q-12)* | No |
| Aprobar o rechazar solicitudes de alta | Sí | No | No |
| Gestionar usuarios (rol, desactivar) | Sí | No | No |
| Ver el registro de accesos a datos sensibles | Sí | No | Solo los accesos a los propios *(propuesto)* |

Todas estas comprobaciones se aplican en el servidor (RF-103), no solo ocultando botones. Esto incluye los datos sensibles: la API de listados no los devuelve nunca (RN-21). Q-14 está resuelta (no): el administrador lee misiones y rutas, y solo gestiona usuarios y datos; no las escribe.

## 7. Flujo del rescatista (resumen)

Boceto 14. Se detallará en un documento posterior, pero el recorrido base es:

1. Registro con código de invitación → pantalla de espera → el administrador aprueba (3.1).
2. Primer acceso → **formulario de alta** (3.9).
3. Login → Inicio reducido, con la tarjeta del tiempo simple de su ubicación (luz y luna, en el detalle); el tiempo en el objetivo, dentro de cada misión.
4. Misiones activas → Detalle en solo lectura.
5. En la misión: ver mapa, puntos y rutas validadas con métricas, **compartir la ubicación del objetivo** (coordenadas que se copian con un aviso para el lector de pantalla, y un enlace `geo:` que abre la aplicación de mapas del móvil) y elegir una ruta para verla en el mapa con su perfil.
6. **Me ofrezco como voluntario**, y consultar el estado de la oferta. Puede retirarla.
7. Exportar una ruta o todas las validadas (GPX o KML), solo con la misión activa. *Tal como se construyó (H4):* cada ruta es una tarjeta con la versión fijada y su fecha de validación, las métricas, la composición, el origen y el equipo (solo si es miembro, D-34 lo cambia en H5); una ruta *no disponible* se ve señalada («No la uses») y sin descarga; con la misión cerrada se leen y no se descargan. Las descargas son botones de la tarjeta, así que funcionan aunque el mapa no cargue.
8. En **Mi perfil**: mantener datos y habilidades (con certificados), consultar su historial de misiones.

## 8. Estados vacíos, errores y casos límite

| Situación | Comportamiento esperado |
|---|---|
| Misión sin origen | Generar rutas desde la misión desactivado, con mensaje que enlaza a Añadir origen. Se puede seguir añadiendo rutas de la biblioteca |
| Misión sin ninguna ruta validada | El rescatista ve el objetivo y los puntos, y "Sin rutas validadas todavía" |
| Biblioteca vacía | "Aún no hay rutas", con botones para crear o importar |
| Búsqueda por punto sin resultados (segunda entrega) | "No hay rutas a menos de X km". Opciones: ampliar radio, crear una ruta nueva |
| Aparece versión validada nueva de una ruta de la misión | Aviso en la misión. El coordinador decide si actualiza. Nada cambia solo |
| Ruta fijada en una misión se archiva | No se puede archivar mientras esté en una misión no cerrada. Se explica en qué misiones se usa |
| Se intenta eliminar una ruta usada | No se elimina (RN-14): el informe dice en qué misiones está, abiertas o cerradas. Solo se elimina lo archivado y sin misión |
| Validación antigua | Marca "posiblemente desactualizada". Sigue usable, pero visible |
| Versión fijada en borrador | En la tabla del coordinador se dice, con el aviso de que el rescatista no la ve, y ofrece **Validar**. El rescatista no recibe la fila ni su geometría (INV-05) |
| Ruta marcada como no disponible | El coordinador la ve apagada y con la marca; el rescatista la ve señalada, con su aviso y sin descarga; no cuenta como validada al activar la misión |
| Añadir una ruta que otra persona acaba de añadir | El lote se rechaza entero con «“X” ya está en la misión»; el diálogo sigue abierto y la lista se actualiza |
| Añadir una ruta archivada | Se rechaza («deriva una copia para usarla»); no se añade ninguna del lote |
| Misión cerrada con rutas | El coordinador y el rescatista las leen; ninguno escribe; el rescatista no descarga (`MISSION_NOT_ACTIVE`) |
| El mapa no carga (sin WebGL) | Avisa en el mapa; las tarjetas, la tabla y las descargas siguen funcionando |
| Objetivo en zona sin datos de caminos | El trabajo falla con «fuera de la zona que cubre el motor» (`OUTSIDE_COVERAGE`) y propone elegir puntos cerca de caminos de los Pirineos. Se puede importar o dibujar |
| Sin ruta posible entre dos puntos, o con las zonas a evitar | «No hay ninguna ruta posible» (`NO_ROUTE_POSSIBLE`); propone mover los puntos o quitar alguna zona |
| Motor de rutas caído | `ROUTING_UNAVAILABLE`: al pedir el cálculo no se crea ningún trabajo y se explica que el resto de la aplicación sigue; importar, dibujar en línea recta y la biblioteca funcionan |
| Dirección que resuelve en otro país | Se muestra el país y se pide confirmación |
| Coordinador responsable desactivado | La misión queda marcada como sin responsable y se obliga a reasignarla (RN-11) |
| Importación con archivo inválido o enorme | Error claro, no se guarda nada |
| Importación sin altitudes | Se recalculan con el modelo de elevación propio |
| Proveedor meteorológico caído o cupo agotado | Tarjeta "no disponible" o con el último dato guardado y su hora. El inicio sigue operativo |
| Ubicación del dispositivo denegada o sin señal | La tarjeta pide activarla o pinchar una misión. Pendiente decidir el punto base como alternativa (Q-32) |
| Sesión caducada | Redirección al login conservando la vista a la que se iba |
| Pérdida de conexión en v1 | Mensaje claro de que la app necesita conexión. El modo offline llega en v2 (D-05) |
| Misión cerrada | Todos los controles de edición, incluido ofrecerse, quedan desactivados |
| Dos coordinadores editan a la vez | Pendiente (Q-10). Las rutas versionadas reducen el riesgo: nadie pisa la versión de otro. Como mínimo, aviso de que la misión cambió |
| Rescatista retira su oferta con la lista del coordinador abierta | La fila desaparece al actualizar. Aviso si el coordinador intentaba actuar sobre ella |
| Rescatista con perfil incompleto intenta ofrecerse | Se le lleva a completar el alta y vuelve a la misión |
| Rescatista sin equipo en la lista de voluntarios | "Sin equipo", sin localidad |
| Equipo sin localidad | No se puede crear. La localidad es obligatoria |
| Cuenta pendiente intenta entrar a una vista | Solo ve la pantalla de espera |
| Registro con un código de invitación inválido | Error genérico, no se crea la solicitud |
| Cerrar una misión sin aceptados | El diálogo de participación se salta. Solo se confirma el cierre |
| Cancelar el diálogo de cierre | La misión sigue Activa y no cambia ninguna participación |
| Reabrir y volver a cerrar | Se pide de nuevo confirmar quién participó |
| Rescatista elimina sus datos teniendo misiones en su historial | Los datos personales se borran. En las misiones queda "Participante anónimo" |
| Un coordinador intenta abrir el documento, la dirección o el historial de un rescatista | No se muestra. No existen esos campos en su ficha, y la API los rechaza |
| Certificado con formato o tamaño no admitido | Error claro. El curso no se guarda con ese archivo |

## 9. Entidades implicadas

El detalle de las entidades, sus relaciones y sus reglas está en el documento 03 (modelo de dominio). Este documento solo comprueba que el flujo no pide nada que el modelo no pueda representar.

## 10. Trazabilidad con el documento 01

| Vista o flujo | Requisitos |
|---|---|
| Acceso, registro y espera | RF-101, RF-102, RF-103, RF-104, RF-106, RN-25 |
| Inicio | RF-701, RF-703, RF-704, RF-705, RF-706, RF-707, RF-708, RN-26 |
| Navegación | RF-702 |
| Misiones | RF-204, RF-601 |
| Crear misión | RF-201, RF-401, RF-402, RF-513, RF-514 (segunda entrega) |
| Detalle de misión | RF-205, RF-207, RF-602 |
| Voluntarios y participantes | RF-605, RF-802, RF-803, RF-804, RF-811 (segunda entrega), RN-21, RN-23 |
| Ficha del voluntario | RF-803, RF-808, RN-18, RN-23, RN-24 |
| Equipos | RF-801 |
| Alta y perfil del rescatista | RF-806, RF-807, RF-808, RF-809, RF-810, RF-812, RN-18 a RN-24 |
| Administración | RF-106, RF-810, RF-813, RN-11, RN-25 |
| Puntos | RF-402, RF-403, RF-404, RF-405 |
| Biblioteca de rutas | RF-501, RF-510, RF-511, RF-512, RF-516, RF-517; RF-514 y RF-515 en la segunda entrega |
| Rutas de la misión | RF-502, RF-503, RF-504, RF-506, RF-508, RF-513, RF-518, RF-519, RF-805 |
| Activar y cerrar misión | RF-202, RF-207, RF-208, RN-09, RN-19 |

## 11. Preguntas abiertas que afectan a este documento

Las preguntas están centralizadas en el documento 01, sección 9. Las que condicionan las vistas son:

- **Q-10** Si todos los coordinadores pueden editar una misión o solo el responsable.
- **Q-12** Quién gestiona los equipos.
- **Q-13** Prioridad del inicio y proveedor meteorológico.
- ~~**Q-14** Si el administrador también trabaja con misiones y rutas, o solo gestiona usuarios y datos.~~ **Resuelta (2026-10-31): no.** El administrador no escribe misiones.
- **Q-16** Visibilidad de las misiones en planificación para los rescatistas.
- **Q-17** Si los rescatistas pueden consultar la biblioteca.
- **Q-21** Etiquetas de rutas.
- **Q-31** Qué misiones ve el rescatista y qué avisos recibe.
- **Q-32** Alternativa si se deniega la ubicación del dispositivo.

Resueltas desde la v0.3: Q-22 (equipo y agrupación son lo mismo), Q-23 (registro con aprobación), Q-24 (visibilidad de datos) y Q-25 (participación confirmada al cerrar).

## 12. Registro de cambios

**1.12 (2026-11-22)**
- Cierre de `H5-equipos` (`specs/H5-equipos/`): §3.8 «Tal como se construyó (`H5-equipos`)»: lista, crear y editar con el código, detalle con miembros, selector de equipo de la ruta (RF-805) y alias del responsable para el rescatista. Q-12 resuelta: gestionan el administrador y el coordinador

**1.11 (2026-11-22)**
- Cierre de `H5-usuarios` (`specs/H5-usuarios/`): §3.10 «Tal como se construyó (`H5-usuarios`)»: sección Usuarios, ficha y diálogos de rol, desactivar y reactivar con la reasignación de misiones. Sin cambios de permisos

**1.10 (2026-11-22)**
- Cierre de `H5-habilidades` (`specs/H5-habilidades/`): §3.9 «Tal como se construyó (`H5-habilidades`)»: lista, añadir, editar, «Adjuntar», abrir y eliminar. Sin cambios de permisos.

**1.9 (2026-11-22)**
- Cierre de `H5-perfil` (`specs/H5-perfil/`): §2 Cuenta con nombre visible, idioma guardado en la cuenta (antes solo en el navegador, D-H0-21) y cambiar la contraseña; §3.9 «Tal como se construyó»: alta obligatoria, formulario, enmascarado con «Mostrar» y «Ocultar», corregir solo lo cambiado. Sin cambios de permisos.

**1.8 (2026-11-22)**
- §3.2 y §7: en Mis misiones del rescatista, la tarjeta del tiempo es solo de su ubicación y las tarjetas de misión pierden el botón «Tiempo» (se confundía con la tarjeta de arriba); el tiempo del objetivo está en el detalle de la misión.

**1.7 (2026-11-21)**
- Pintar ruta y continuar a mano (`specs/issue-pintar-ruta/`): §3.6 C con el interruptor «Pintar ruta», la casilla de unir por los caminos desmarcada de serie y el dibujo desde la misión; §3.6 D nueva «Continuar a mano»; «Más ⋯» del detalle de ruta y §3.5 con las acciones nuevas; §4.3 B, dibujar construido.

**1.6 (2026-11-21)**
- Nombre de las rutas y desvincular: §3.6 A paso 3 (nombre obligatorio, propuesto con el del punto de inicio), detalle de ruta («Cambiar nombre» en «Más ⋯»; «Quitar de la misión» en «Usada en» para misiones en planificación o activas) y §3.5 (el «⋯» de cada ruta de la misión dice «Quitar de la misión» y trae «Cambiar nombre»).

**1.5 (2026-11-15)**
- `UI-simplificacion`: una sola acción principal por vista y el resto en menús con nombre fijo («Exportar ▾», «Más ⋯», «⋯» por fila). §3.6 con la fila de acciones del detalle de ruta («Derivar» pasa a «Duplicar ruta» dentro de «Más»). Inicio como centro de operaciones (cifras que ya da `listMissions`), Crear misión en secciones con icono y sin textos de ayuda, detalle de misión con «Añadir punto ▾» y «⋯» en cada ruta y punto. Capas del mapa en un desplegable con icono.

**1.4 (2026-11-13)**
- Issue #18: §3.2 con la tarjeta del tiempo simple (tres iconos por tramo, temperatura y viento) y la luz y luna fuera de Inicio; nueva §3.2.1 «Tiempo en detalle».

**1.3 (2026-11-13)**
- Issue #17: §3.6 y §8 con «Eliminar seleccionadas» en la lista de archivadas (el detalle y la lista de activas no tienen botón de eliminar) y el protocolo quitar → archivar → eliminar.

**1.2 (2026-11-06)**
- Cierre de `UI-rediseno` (issue #14): §1 principio «Legible en campo» (oscuro por defecto y claro de alto contraste, contenido centrado); §2 Cuenta con el **tema** y su selector de tres opciones; §3.4 alto del mapa de Crear misión medido en escritorio y en columna. Sin cambios de permisos ni de flujo.

**1.1 (2026-11-05)**
- Cierre de `H5-acceso` (T10): §3.1 y §3.10 tal como se construyeron: enlaces del login, registro con nombre visible y su validación, «Solicitud recibida», recuperar contraseña (petición, enlace con el token en el fragmento que se quita de la barra, «Enlace no válido», «Contraseña cambiada»), bandeja con pestañas, búsqueda, selección por página y diálogos de aprobar (rol sin valor marcado) y rechazar, y código de invitación con copiar y regenerar con confirmación. Sin cambios de permisos

**1.0 (2026-11-05)**
- Cambio de alcance `H5-acceso` (issue #9): §3.1 con la pantalla «Solicitud recibida», la vista de recuperar contraseña y los enlaces del login; §3.10 con el corte de la administración que se construye primero (solicitudes y código de invitación). Sin cambios de permisos

**0.9 (2026-11-02)**
- H4 (§3.5, §4.3, §4.4, §7, §8): «Rutas de la misión» tal como se construyó (tabla comparativa con desplazamiento propio, selección con mapa y perfil, avisos, no disponible, quitar y exportar), el diálogo **Añadir ruta** en dos pasos con los otros dos caminos, **Validar** desde la fila, la vista del rescatista (tarjetas, perfil, descarga y compartir ubicación) y los casos límite nuevos (borrador fijado, no disponible, duplicada, archivada, misión cerrada, mapa caído).

**0.8 (2026-11-01)**
- H3 (§3.6, §4.3, §8): «Generar rutas» (zonas a evitar, progreso, comparación con la composición real, generar desde la misión), dibujar a mano con la casilla de unir a los caminos, y los casos de misión sin origen, sin ruta posible, fuera de cobertura y motor caído.

**0.7 (2026-10-31)**
- H2 (§3.6): dibujar y editar a mano son líneas rectas, sin ajuste a caminos hasta H3; «Generar» no se muestra en H2; la composición por tipo de vía dice «sin clasificar»; la selección se conserva entre páginas y se exporta (GPX/KML) o se archiva; en pantalla estrecha, pestañas Lista y Mapa.

**0.6 (2026-10-31)**
- Q-14 resuelta (no): el administrador no escribe misiones. §2: sin «Crear misión» en su barra. §6: sus celdas «Q-14» pasan a «No». §3.2, §3.10 y §11 al día (H1-T6).

**0.5 (2026-10-29)**
- Solicitudes de alta (3.10): se retiran las columnas «Equipo indicado» y «Datos completos» del boceto 13 (Q-34).

**0.4 (2026-10-29)**
- El producto pasa a llamarse **OnWay**.
- Alineado con los 15 bocetos (nueva sección 13).
- Acceso con registro y pantalla de espera (3.1). Nueva vista de Administración (3.10) y columna Administrador en navegación y permisos.
- Inicio: tarjeta del tiempo simple de la ubicación del dispositivo o del objetivo de la misión elegida (3.2); el detalle del tiempo, con la luz y la luna (3.2.1).
- Biblioteca de rutas con lista y mapa, como Wikiloc (3.6).
- Ficha del voluntario con teléfono, correo y acceso al certificado; sin historial (3.7).
- Alta y perfil: correo de contacto igual al de acceso, bloque de contacto separado de los sensibles, certificado opcional (3.9).
- Cierre de misión con confirmación de quién participó (4.5). Nuevo ciclo de vida de la cuenta.
- Crear misión con barra inferior fija. Búsqueda de dirección al pulsar.

**0.3 (2026-10-29)**
- Nueva vista de alta y perfil del rescatista, con datos personales, cursos y habilidades, historial y gestión de los propios datos.
- Nueva ficha del voluntario dentro de la lista, sin documento ni dirección.
- La lista de voluntarios muestra nombre, equipo y localidad del equipo. Los equipos llevan localidad.
- Búsqueda por punto, sugerencias y adaptación marcadas como segunda entrega.
- Nuevo ciclo de vida del perfil de rescatista. Permisos ampliados con datos sensibles.
- Mi perfil en la navegación del rescatista.

**0.2 (2026-10-29)**
- Misión con tres estados. Nueva vista Rutas (biblioteca). Rutas añadidas a la misión con versión fijada. Nueva vista de voluntarios con acciones en bloque. Inicio con meteorología, luz solar y fase lunar. Entidades movidas al documento 03.

**0.1 (2026-10-29)** Primera versión.

## 13. Correspondencia con los bocetos

| Boceto | Vista | Sección |
|---|---|---|
| 1 | Acceso, registro y espera | 3.1 |
| 2 | Alta de rescatista | 3.9 |
| 3 | Inicio | 3.2 |
| 4 | Misiones | 3.3 |
| 5 | Crear misión | 3.4 |
| 6 | Detalle de misión | 3.5 |
| 7 | Voluntarios y participantes | 3.7 |
| 8 | Cierre de misión | 4.5 |
| 9 | Rutas (biblioteca) | 3.6 |
| 10 | Detalle de ruta | 3.6 |
| 11 | Añadir ruta a la misión | 4.3 |
| 12 | Equipos | 3.8 |
| 13 | Administración | 3.10 |
| 14 | Vista del rescatista | 3.5, 3.2, 7 |
| 15 | Mi perfil | 3.9 |

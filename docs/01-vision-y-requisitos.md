# OnWay — Documento 01: Visión, alcance y requisitos funcionales

Versión: 1.5 (borrador) · Fecha: 2026-11-13 · Estado: pendiente de revisión por el propietario del producto

Los elementos marcados como *(propuesto)* los ha añadido el arquitecto como consecuencia de tus decisiones y están pendientes de confirmar. El resto sale directamente de lo que has definido. El nombre del producto es **OnWay** (antes OnCourse).

---

## 1. Visión

OnWay es una aplicación para equipos de rescate en montaña. Un coordinador define una misión (objetivo, puntos de origen, equipos y rutas) y la app le ayuda a tener **varias rutas viables hacia el mismo objetivo**, analizando el terreno. Las rutas no pertenecen a una misión: viven en una **biblioteca permanente** de la organización y se reutilizan, se adaptan y se añaden a cada misión. Los rescatistas consultan las rutas en modo solo lectura y se ofrecen como voluntarios; el coordinador decide quién participa y, al cerrar la misión, confirma quién participó de verdad.

**Contexto del proyecto.** OnWay es, de momento, un **proyecto didáctico para un portfolio**, sin ánimo comercial y sin usuarios reales (D-20). Esto no cambia el diseño funcional, pero sí condiciona los proveedores externos (planes gratuitos no comerciales), el coste de despliegue (hasta 20 €/mes, ver documento 04) y el tratamiento de los datos personales (datos de demostración ficticios).

**Problema que resuelve.** Hoy, preparar rutas de aproximación a un punto de rescate se hace a mano sobre mapas, sin comparar alternativas, sin reutilizar lo ya trabajado y sin tener en cuenta de forma sistemática el terreno. Cuando una ruta queda bloqueada, replanificar cuesta tiempo.

**Propuesta de valor.**
- Varias rutas hacia un mismo objetivo, para que salgan varios equipos a la vez o haya alternativa si una falla.
- Una biblioteca de rutas permanente, con versionado y derivación, que se explora con una lista y un mapa a la vez, como en Wikiloc. En la segunda entrega: búsqueda de las rutas que pasan por un punto o más cerca de él, y adaptación del tramo final de una ruta existente.
- Rutas que aprovechan carreteras, caminos y senderos y, cuando haga falta, tramos campo a través (fase posterior).
- Misiones compartidas con los rescatistas de la organización, que las consultan sin poder modificarlas.
- Gestión ágil de voluntarios: los rescatistas se ofrecen y el coordinador acepta o rechaza en bloque.
- Perfil de rescatista con sus datos de contacto, cursos y habilidades (con certificado opcional), e historial de misiones.
- Una pantalla de inicio con la información que un alpinista consultaría antes de salir: meteorología de montaña, luz solar y fase lunar, de donde estás tú o del objetivo de la misión que elijas.
- Importación y exportación de rutas, para intercambiar trazados con otras organizaciones y con dispositivos GPS.
- Pensada para operar en zonas fronterizas (Pirineos: España y Francia). Las organizaciones del otro lado se informan fuera de la app (D-08).

**Referencia de producto:** Wikiloc (capas de mapa satélite, topográfico y carreteras; descarga offline; pantalla partida de lista y mapa).

## 2. Decisiones tomadas hasta ahora

| ID | Decisión | Consecuencia | Estado |
|---|---|---|---|
| D-01 | Plataforma v1: aplicación web. Arquitectura preparada para iOS y Android más adelante | Backend con API independiente del cliente; lógica de negocio fuera del frontend | Confirmada |
| D-02 | Cobertura geográfica: cualquier país (caso principal: Pirineos, España y Francia) | Datos de mapa y elevación globales como base; fuentes nacionales de mayor resolución como mejora. Internacionalización desde el inicio | Confirmada |
| D-03 | **No se calcula tiempo estimado.** Solo distancia y elevación | Las métricas de ruta no incluyen duración. No hay velocidades, ni perfiles de ritmo | Confirmada |
| D-04 | Las rutas alternativas pueden compartir tramos | No hace falta forzar rutas disjuntas. Se busca variedad razonable, no exclusión total | Confirmada |
| D-05 | Modo offline: v2 | En v1 se diseña el modelo de datos y el almacenamiento de mapas para que no obligue a rehacer nada, pero no se entrega la descarga | Confirmada |
| D-06 | Varias organizaciones (multi-tenant) | Aislamiento de datos por organización desde el modelo de datos; roles dentro de cada organización | Confirmada |
| D-07 | Seguimiento GPS en vivo: fase posterior | No entra en v1. El modelo de datos y la arquitectura no deben impedir añadirlo | Confirmada |
| D-08 | **La misión pertenece a nuestra organización.** Otras organizaciones implicadas en una operación se informan fuera de la app y no participan en ella | No hay compartición de misiones ni de rutas entre organizaciones. El aislamiento por organización es total y más simple | Confirmada |
| D-09 | **Importar y exportar rutas en v1** | Formatos de intercambio (GPX como base). Una ruta importada pasa por el mismo flujo de validación que una generada | Confirmada |
| D-10 | **Creación mínima de misión**: solo nombre, coordinador y punto objetivo son obligatorios. Equipos, rescatistas, orígenes y rutas se añaden después, desde la propia misión | El detalle de la misión es el centro de trabajo | Confirmada |
| D-11 | **Flujo de entrada del coordinador**: login → pantalla de inicio informativa → navegación | La pantalla de inicio no edita nada | Confirmada |
| D-12 | Existen **equipos** (grupos ya formados) y **rescatistas individuales** | El rescatista deja de ser estrictamente solo lectura (ver D-17 y RN-02) | Confirmada |
| D-13 | **Ciclo de vida de la misión: En planificación → Activa → Cerrada.** La validación de seguridad se hace sobre las rutas, no sobre la misión | Una misión recién creada está *En planificación*. "En planificación" y "Activa" están confirmados. Las reglas de visibilidad y el estado Cerrada son propuestos | Confirmada (reglas *propuestas*) |
| D-14 | **Las rutas se crean por separado de las misiones y se guardan en una biblioteca permanente** de la organización. La misión tiene "añadir ruta" y se eligen rutas de la biblioteca | Relación muchos a muchos entre misiones y rutas. Una ruta puede servir en muchas misiones | Confirmada |
| D-15 | **Buscar en la biblioteca las rutas que pasan por un punto o más cerca de él**, y adaptar el tramo final de una ruta existente | Consulta espacial sobre las rutas. **Va en la segunda entrega** (D-21). El modelo y el índice geográfico se preparan desde el principio | Confirmada |
| D-16 | **Versionado de rutas y derivación.** Editar una ruta crea una versión nueva. Se puede aprovechar una ruta, modificar solo el tramo final y guardarla con otro nombre | Las versiones son inmutables. Una ruta derivada recuerda de cuál procede | Confirmada |
| D-17 | **Voluntariado con aceptación.** Los rescatistas se ofrecen como voluntarios y el coordinador acepta. La gestión es una lista con casilla de selección a la izquierda y datos del voluntario a la derecha, con acciones en bloque, al estilo del correo electrónico | Estado de participación por rescatista y misión. Acciones masivas con selección entre páginas | Confirmada |
| D-18 | **El inicio muestra meteorología de montaña, fases lunares y luz solar.** Meteorología detrás de una interfaz sustituible: **Open-Meteo como proveedor principal** (gratuito para uso no comercial, admite la altitud del punto) y **Meteoblue como alternativa** (plan gratuito no comercial con cupo limitado). Boletines oficiales de AEMET y Météo-France enlazados. Sol y luna se calculan en local | Cambia la propuesta anterior (Meteoblue principal), porque el cupo gratuito de Meteoblue es corto para uso continuo. Límites de Open-Meteo verificados en el documento 04 | *(propuesto)* |
| D-19 | **La misión fija una versión concreta de cada ruta.** Si aparece una versión nueva validada, la misión lo indica y el coordinador decide si actualiza | Nada cambia bajo los pies de un equipo que ya salió | *(propuesto)* |
| D-20 | **Proyecto didáctico para portfolio.** Sin ánimo comercial y sin usuarios reales | Planes gratuitos no comerciales de proveedores. Datos de demostración ficticios. Despliegue de bajo coste (hasta 20 €/mes). Se resuelven Q-07 y Q-19 | Confirmada |
| D-21 | **Entrega en dos fases.** La primera entrega de v1 incluye todo salvo la búsqueda de rutas por punto y la adaptación del tramo final, que van en la segunda entrega | El alcance de la primera entrega se reduce. El modelo de datos soporta ambas desde el inicio | Confirmada |
| D-22 | **La lista de voluntarios muestra solo nombre, equipo (si pertenece a alguno) y la localidad del equipo o agrupación de procedencia**, no la del rescatista | Los equipos tienen localidad. Un rescatista sin equipo no muestra localidad | Confirmada |
| D-23 | **Alta de rescatista con formulario de datos personales:** nombre completo, documento de identidad, dirección completa, teléfono y correo, cursos y habilidades. **Se guarda el historial de misiones** en que ha participado | Entidad de perfil con datos sensibles. Historial derivado de las participaciones confirmadas | Confirmada |
| D-24 | **Los datos sensibles (documento de identidad y dirección) solo los ve el propio rescatista y el administrador de organización**, y nunca aparecen en listas. El coordinador ve nombre, equipo, localidad del equipo, cursos y habilidades, y los datos de contacto (D-28), pero no el historial de misiones | Respuesta a Q-24 | Confirmada |
| D-25 | **El rescatista se registra él mismo y un administrador de organización aprueba la cuenta** y le asigna el rol. Hasta entonces solo ve una pantalla de espera | Estado de cuenta *Pendiente de aprobación*. Vista de administración con solicitudes en bloque. Un código de invitación de la organización asocia el registro a su organización *(propuesto)*. El rol de coordinador solo lo concede el administrador | Confirmada (código de invitación *propuesto*) |
| D-26 | **"Agrupación" y "equipo" son lo mismo.** El equipo tiene una localidad obligatoria | Respuesta a Q-22. No hace falta un nivel más | Confirmada |
| D-27 | **La participación se confirma al cerrar la misión.** El coordinador marca con una casilla quién participó. Un rescatista aceptado pero desmarcado no cuenta como participado y no aparece en su historial | Respuesta a Q-25. Nuevo paso al cerrar. La participación guarda la asistencia confirmada. Todos vienen marcados por defecto *(propuesto)* | Confirmada (marcado por defecto *propuesto*) |
| D-28 | **Teléfono y correo son obligatorios en el perfil y los ven el administrador y los coordinadores.** El correo de contacto es el mismo del inicio de sesión | Datos de contacto con visibilidad distinta de los sensibles. El coordinador los ve solo de los rescatistas ofrecidos o añadidos a sus misiones *(propuesto)* | Confirmada (alcance *propuesto*) |
| D-29 | **El certificado de un curso es opcional** y se adjunta al añadirlo. Coordinadores y administrador pueden abrirlo | Archivos privados con enlace de corta duración. Cada apertura queda registrada *(propuesto)* | Confirmada (registro *propuesto*) |
| D-30 | **La meteorología del inicio usa por defecto la ubicación del dispositivo**, leída al iniciar sesión. Al pinchar una misión pasa al objetivo de esa misión | La posición del dispositivo solo se usa para consultar el tiempo y no se guarda *(propuesto)*. Sin permiso de ubicación, se pide pinchar una misión | Confirmada (no guardar *propuesto*) |
| D-31 | **El producto se llama OnWay** | Sustituye a OnCourse en todos los documentos y bocetos | Confirmada |
| D-32 | **Stack y despliegue:** TypeScript, NestJS, React + Vite, PostgreSQL con PostGIS, servidor único de 8 GB con techo de 20 €/mes | Detalle y alternativas descartadas en el documento 04 | Confirmada |
| D-33 | **Construcción por hitos pequeños (H0–H9), con el MVP en H0–H4.** Cada hito termina en algo que se puede demostrar | Documento 07. La biblioteca de rutas (H2) va antes del motor (H3) para aislar el mayor riesgo. El despliegue va al final de la primera entrega | Propuesta |
| D-34 | **Un rescatista ve el nombre y la localidad de su equipo y de los demás equipos de su organización** (por ejemplo, el equipo asignado a cada ruta de una misión). Sigue sin ver quién es miembro de cada uno | Para saber qué equipo sigue cada ruta aunque no sea el suyo. La lectura de `teams` hoy solo deja ver los propios; se amplía en H5 (backlog B-01) | Confirmada (2026-11-02), construcción en H5 |

## 3. Usuarios y roles

| Rol | Descripción | Permisos principales |
|---|---|---|
| **Coordinador** | Elabora misiones y mantiene la biblioteca de rutas | Crear y editar misiones de su organización; definir puntos; crear, importar, versionar y validar rutas; añadir rutas a misiones; gestionar equipos y voluntarios; activar y cerrar misiones (confirmando quién participó); ver la ficha de los voluntarios (nombre, equipo, localidad, cursos y habilidades con certificado, teléfono y correo; sin datos sensibles ni historial) |
| **Rescatista** | Ejecuta la misión | Solo lectura sobre el contenido de las misiones activas (puntos y rutas validadas); exportar rutas; **ofrecerse como voluntario** y retirar su oferta; mantener su propio perfil, habilidades y ver su historial |
| **Administrador de organización** *(propuesto)* | Gestiona su organización | Aprobar o rechazar solicitudes de alta y asignar el rol; ver y desactivar usuarios; ver los datos sensibles de los perfiles con registro de cada consulta (D-24); ver los datos de contacto y certificados |
| **Superadministrador de plataforma** *(propuesto)* | Gestiona OnWay | Crear organizaciones y su primer administrador; soporte |

**Equipo:** no es un rol ni un usuario. Es un grupo nombrado de rescatistas de una misma organización, con una **localidad** obligatoria (ciudad o agrupación de procedencia), que se asigna a misiones como unidad. "Agrupación" y "equipo" son lo mismo (D-26).

**Perfil de rescatista:** se rellena en el alta (RF-807). Incluye nombre completo, teléfono y correo (contacto), documento de identidad y dirección completa (sensibles), y cursos y habilidades con certificado opcional. Su historial de misiones se genera solo a partir de las participaciones confirmadas al cerrar cada misión.

Los dos últimos roles no los has definido tú. Son consecuencia directa de tener varias organizaciones, de aprobar cuentas y de la protección de datos sensibles: alguien tiene que dar de alta organizaciones, aprobar usuarios y custodiar esos datos. Confírmalos o descártalos (Q-01).

## 4. Alcance por versión

El alcance se construye por **hitos pequeños y demostrables** (H0–H9, documento 07, D-33). Correspondencia con las versiones de este documento:

| Versión | Hitos | Contenido |
|---|---|---|
| **v1 · MVP** | H0–H4 | Acceso, misiones y mapa, biblioteca de rutas, generación automática, rutas en la misión y vista del rescatista |
| **v1 · primera entrega** (resto) | H5–H7 | Personas y equipos, voluntariado, cierre con asistencia, historial, privacidad, despliegue |
| **v1 · segunda entrega** (D-21) | H8–H9 | Búsqueda por punto, adaptación de rutas, filtro por habilidad |
| **v2** | v2.1–v2.3 | Sin conexión, campo a través, apps móviles |
| **v3** | v3.1–v3.2 | GPS en vivo, avisos |

### v1, primera entrega (MVP más personas, H0–H7)
- Registro del rescatista con aprobación por un administrador, y administración de usuarios.
- Alta de rescatista con su perfil, cursos y habilidades (con certificado opcional), e historial de misiones.
- Pantalla de inicio informativa y navegación por rol.
- Misiones: crear con datos mínimos, completar progresivamente, activar, cerrar confirmando la participación.
- Biblioteca de rutas permanente con lista y mapa: crear, importar, exportar, editar con versiones, derivar, validar.
- Añadir rutas de la biblioteca a una misión, fijando la versión.
- Equipos (con localidad), rescatistas y voluntariado con aceptación del coordinador.
- Puntos: origen (cero, uno o varios), objetivo, intermedios obligatorios, de reunión.
- Entrada de puntos por coordenadas, clic en el mapa o dirección.
- Mapas: satélite, topográfico y carreteras.
- Generación de rutas por red existente (carreteras, caminos y senderos), con métricas de distancia y elevación.
- Vista de solo lectura para el rescatista.
- Inicio con meteorología de la ubicación del dispositivo o del objetivo elegido, luz solar y fase lunar.

### v1, segunda entrega (D-21, H8–H9)
- Búsqueda de rutas existentes por punto, con sugerencias cerca del objetivo al crear una misión (RF-514).
- Adaptación del tramo final de una ruta existente (RF-515).
- Filtro de voluntarios por habilidad, y lo que quede de prioridad Could.

### v2 (v2.1 sin conexión, v2.2 campo a través, v2.3 apps móviles)
- Descarga de mapas y misiones para uso offline.
- Rutas campo a través con análisis de terreno (modelo de elevación, pendiente, cobertura del suelo, obstáculos).
- Aplicaciones iOS y Android.

### v3 y posteriores (v3.1 GPS en vivo, v3.2 avisos)
- Seguimiento GPS de equipos en tiempo real.
- Notificaciones y cambios de ruta en vivo.

### Fuera de alcance (por ahora)
- Estimación de tiempos (D-03).
- Compartir misiones o rutas con otras organizaciones dentro de la app (D-08).
- Comunicación entre usuarios (chat, voz).
- Integración con sistemas de emergencias o despacho.
- Predicción propia de meteorología o aludes. Se muestran datos de proveedores externos y enlaces a boletines oficiales.
- Notificaciones activas (correo o push). En v1, el rescatista ve el estado de su oferta dentro de la app.
- Uso comercial (D-20).

## 5. Requisitos funcionales (v1)

Formato: ID, descripción, criterios de aceptación. Prioridad MoSCoW entre paréntesis. Los marcados "segunda entrega" van en la segunda fase de v1 (D-21).

### E1 · Autenticación, organizaciones y roles

**RF-101 (Must) Inicio de sesión.** Un usuario accede con correo y contraseña.
- Una cuenta desactivada no puede iniciar sesión. Una cuenta pendiente de aprobación llega solo a la pantalla de espera (RF-106).
- Tras un número configurable de intentos fallidos se aplica bloqueo temporal.
- Tras iniciar sesión, el usuario llega a la pantalla de inicio (RF-701). Si es rescatista con el perfil incompleto, llega antes al formulario de alta (RF-807).
- Al iniciar sesión, la app pide permiso para leer la ubicación del dispositivo, que usa el inicio (RF-708).

**RF-102 (Must) Pertenencia a organización.** Cada usuario pertenece a una organización y tiene un rol en ella.
- Un usuario solo ve datos de su organización.
- Un usuario no puede cambiar su propio rol.

**RF-103 (Must) Control de permisos.** Los permisos se comprueban en el servidor, no solo en la interfaz.
- Un rescatista que llama directamente a un endpoint de edición recibe un error de permisos.

**RF-104 (Must) Registro de rescatista.** Una persona se registra con correo y contraseña. Un código de invitación de la organización asocia la solicitud a su organización *(propuesto)*.
- La cuenta nace *Pendiente de aprobación* (RF-106).
- El registro nunca concede el rol de coordinador.
- Un correo ya registrado no revela de quién es.

**RF-105 (Should) Alta de organizaciones.** El superadministrador crea organizaciones y su primer administrador.

**RF-106 (Must) Aprobación de cuentas.** El administrador de organización ve las solicitudes pendientes y las **aprueba o rechaza, también en bloque**, como una bandeja de correo.
- Al aprobar elige el rol: rescatista o coordinador.
- Cada solicitud muestra el correo y el nombre que indicó la persona al registrarse (Q-34, confirmada: el perfil no existe hasta que se aprueba, así que no hay «datos completos» que mostrar).
- Hasta que se aprueba, la persona solo ve una pantalla de espera.

### E2 · Misiones

**RF-201 (Must) Crear misión con datos mínimos.** Obligatorios: **nombre de la misión, coordinador responsable y punto objetivo**.
- Opcionales: descripción o notas *(propuesto)*, equipos, rescatistas individuales, puntos de origen y rutas (elegidas de la biblioteca).
- Una misión con solo los tres campos obligatorios se guarda y queda *En planificación*.
- El coordinador responsable es por defecto el usuario que crea la misión y puede cambiarse por otro coordinador de la organización.
- El botón de crear está siempre visible y se activa cuando los tres campos son válidos. Al guardar, el usuario llega al detalle de la misión (RF-205).

**RF-202 (Must) Ciclo de vida.** Estados: *En planificación* → *Activa* → *Cerrada*. Una misión cerrada puede reabrirse como *Activa*.
- Una misión *En planificación* solo la ven los coordinadores de la organización *(propuesto, Q-16)*.
- Los rescatistas ven las misiones *Activas* de su organización y pueden ofrecerse.
- Una misión *Cerrada* es de solo lectura para todos.

**RF-203 (Should) Duplicar misión** para reutilizarla como plantilla. Copia datos, puntos y rutas asociadas (con la misma versión), sin participantes.

**RF-204 (Must) Listado de misiones**, con búsqueda y pestañas por estado (En planificación, Activas, Cerradas).

**RF-205 (Must) Detalle de misión como centro de trabajo.** Desde la misión se accede a las vistas para gestionar voluntarios y equipos, definir puntos y añadir rutas.
- Muestra una lista de preparación (objetivo definido, orígenes añadidos, equipos o voluntarios aceptados, al menos una ruta validada añadida). No bloquea ninguna acción *(propuesto)*.

**RF-206 (Could) Ficha de misión exportable** (por ejemplo PDF) para informar a otras organizaciones fuera de la app (D-08) *(propuesto)*.

**RF-207 (Must) Activar misión.** El coordinador pasa la misión de *En planificación* a *Activa*.
- Sin prerrequisitos obligatorios. Si no hay ninguna ruta validada, la app avisa pero deja activar *(propuesto)*.
- Al activar, la misión pasa a ser visible para los rescatistas y se abre el voluntariado.

**RF-208 (Must) Cerrar misión confirmando la participación.** Al cerrar, un diálogo lista los rescatistas aceptados con una casilla cada uno.
- Los marcados constan como que han participado y entran en su historial. Un aceptado desmarcado no cuenta (D-27).
- Todos vienen marcados por defecto, para que el coordinador solo desmarque a quien no fue *(propuesto)*.
- Hay acciones "Marcar todos" y "Desmarcar todos", y un resumen ("3 de 4 han participado").
- Si la misión se reabre y se vuelve a cerrar, la lista se confirma de nuevo *(propuesto)*.
- Al cerrar, la misión pasa a solo lectura para todos.

### E3 · Mapa y capas

**RF-301 (Must) Visualización de mapa** con capas satélite, topográfica y de carreteras, conmutables.

**RF-302 (Must) Navegación del mapa**: zoom, desplazamiento, rotación opcional, indicador de coordenadas y altitud del punto bajo el cursor.

**RF-303 (Should) Visualización de curvas de nivel y sombreado de relieve** en la capa topográfica.

**RF-304 (Must) El mapa funciona a través de la frontera** entre países sin cortes ni cambio de comportamiento.

### E4 · Puntos de la misión

**RF-401 (Must) Punto objetivo**, con tres formas de entrada:
- Coordenadas (formatos decimal y grados-minutos-segundos; opcionalmente UTM).
- Clic o toque directo en el mapa.
- Búsqueda por dirección o nombre de lugar. La búsqueda se lanza al pulsar buscar, no mientras se escribe, porque el servicio público de geocodificación prohíbe el autocompletado (documento 04).
- Cada forma debe resultar en el mismo objeto, con coordenadas y altitud.
- Si una dirección es ambigua, la app muestra los candidatos y el coordinador elige.

**RF-402 (Must) Puntos de origen**: cero, uno o varios por misión, cada uno con nombre y descripción (equipo o base). Se pueden añadir con las mismas tres formas de entrada.

**RF-403 (Must) Puntos intermedios obligatorios** por los que debe pasar una ruta concreta al generarla.

**RF-404 (Must) Puntos de reunión** (nombre provisional): lugares donde los equipos se concentran o cambian de medio (vehículo a pie).
- Visibles en la vista del rescatista con su nombre y notas.

**RF-405 (Should) Importar puntos** desde GPX o KML.

### E5 · Rutas y biblioteca

**RF-501 (Must) Crear ruta generándola.** Dados un punto de inicio y un punto final, la app calcula una o más rutas por la red existente, respetando los puntos intermedios obligatorios indicados.
- Se puede lanzar desde la biblioteca (el coordinador elige los dos puntos) o desde una misión (se rellenan con el objetivo y un origen de la misión).
- Desde una misión, requiere objetivo y al menos un origen. Si falta el origen, la app lo indica e invita a añadirlo (RN-08).
- Por cada pareja se generan al menos dos alternativas cuando el terreno lo permita (D-04).
- Cada alternativa se guarda como una ruta de la biblioteca, en *Borrador*, versión 1.
- Si no hay ruta posible por la red, la app lo indica con un mensaje claro, no devuelve un resultado vacío.

**RF-502 (Must) Métricas de cada versión**: distancia total, desnivel positivo, desnivel negativo, altitud mínima y máxima, pendiente máxima, perfil de elevación.
- No se muestra tiempo estimado (D-03).

**RF-503 (Should) Composición de la ruta**: porcentaje del recorrido por carretera, pista, sendero o tramo sin camino. Una ruta generada, o dibujada con la casilla «unir los puntos siguiendo los caminos» (H3), lleva la composición que mide el servidor sobre los tramos del motor. Una ruta importada, dibujada en línea recta o editada a mano se muestra como **«sin clasificar»**.

**RF-504 (Must) Comparar rutas** en el mapa y en una tabla de métricas, tanto en la misión como en los resultados de búsqueda.

**RF-505 (Must) Edición manual de una ruta** por el coordinador: arrastrar el trazado, añadir puntos de paso, recalcular el tramo afectado.
- Guardar crea una **versión nueva** en *Borrador* (RF-516). Nunca modifica la anterior.
- La versión queda marcada como *modificada manualmente*.

**RF-506 (Must) Validación humana.** El coordinador valida una versión de ruta. Los rescatistas solo ven versiones validadas.
- Toda ruta muestra un aviso de que es una propuesta y no sustituye el criterio del equipo.
- Se registra quién validó y cuándo.

**RF-507 (Should) Zonas a evitar.** Al generar una ruta, el coordinador puede dibujar polígonos que no debe cruzar (derrumbe, ríos crecidos, zona cerrada). Se guardan en la organización, con una misión opcional, y las ve y las dibuja el personal; el rescatista no las ve (Q-05, resuelta).

**RF-508 (Should) Marcar una ruta como no disponible en una misión**, para que los equipos sepan que no deben usarla. La ruta sigue visible, señalada. No afecta a otras misiones.

**RF-509 (Could, v2) Rutas campo a través** con análisis de terreno.

**RF-510 (Must) Importar ruta** en la biblioteca desde un archivo GPX (y KML con prioridad Should).
- Antes de guardar se muestra una vista previa sobre el mapa.
- La app recalcula las métricas con su propio modelo de elevación, porque la altitud de muchos archivos externos falta o es poco fiable.
- La ruta entra como *Borrador* y exige validación (RF-506).
- Un archivo inválido o demasiado grande da un error claro, sin guardar nada.

**RF-511 (Must) Exportar ruta** en GPX (y KML con prioridad Should). Se puede exportar una ruta o todas las rutas validadas de una misión en un único archivo. En la biblioteca se pueden seleccionar varias rutas y exportarlas a la vez (`exportRoutes`: un archivo con una pista por ruta, sin autor).

**RF-512 (Must) Biblioteca de rutas de la organización, con lista y mapa.** Pantalla partida como Wikiloc: lista de rutas a la izquierda y mapa grande a la derecha.
- La lista muestra las rutas del área visible del mapa y se actualiza al moverlo (con opción de buscar solo al pulsar), o al filtrar.
- Pasar el ratón por una tarjeta resalta su trazado en el mapa, y al revés.
- Cada tarjeta: nombre, estado de la última versión, distancia, desnivel, altitud máxima, antigüedad de la validación y número de misiones donde se usa.
- Filtros: estado de validación, distancia, desnivel, antigüedad de la validación y búsqueda por nombre o lugar. Orden y paginación.
- Capas de mapa conmutables, botón de "mi posición" y, en la segunda entrega, dibujar una zona.
- Detalle de cada ruta: mapa, métricas, historial de versiones, ruta de la que deriva y misiones donde se usa.
- Una ruta usada en alguna misión no se puede eliminar, solo archivar (RN-14). Una ruta **archivada y sin misión** se elimina definitivamente desde la lista de archivadas, con confirmación y selección múltiple; para eliminar una activa hay que quitarla de sus misiones, archivarla y eliminarla (issue #17).
- La biblioteca es visible solo para coordinadores (Q-17).

**RF-513 (Must) Añadir ruta a una misión.** El coordinador elige una ruta de la biblioteca y la misión fija una versión concreta (D-19).
- Hay tres caminos en un mismo diálogo: elegir de la biblioteca, generar una nueva e importar un archivo.
- Se puede asignar a un origen de la misión y a un equipo.
- Se puede añadir una versión en *Borrador*, pero el rescatista no la ve hasta que se valide.
- Desde la misión también se puede crear una ruta nueva (RF-501, RF-510) y se añade al terminar.

**RF-514 (Should, segunda entrega) Buscar rutas existentes por punto.** Dado un punto (con las tres formas de entrada; por defecto, el objetivo de la misión), la app devuelve:
- Primero las rutas que pasan a menos de un radio configurable del punto.
- Si no hay, las más cercanas, ordenadas por distancia.
- De cada una se muestra la distancia al punto y el lugar de la ruta más próximo.
- Filtros: solo validadas, longitud, desnivel.
- En la biblioteca se activa haciendo clic en el mapa.
- Con esta función, al crear una misión se sugieren las rutas cercanas al objetivo.

**RF-515 (Should, segunda entrega) Adaptar una ruta existente.** El coordinador toma una ruta, la corta en un punto y recalcula solo el tramo restante hasta otro punto (por ejemplo, el objetivo de la misión actual).
- Se guarda como versión nueva de la misma ruta o como **ruta nueva con otro nombre** (RF-517).
- El tramo conservado no cambia.

**RF-516 (Must) Versionado de rutas.** Toda edición crea una versión nueva. Las versiones anteriores se conservan, son consultables y no se modifican.

**RF-517 (Must) Derivar ruta (guardar como nueva).** Crea una ruta nueva con nombre propio a partir de otra. La ruta nueva recuerda de cuál procede.

**RF-518 (Should) Aviso de versión nueva en una misión.** Si una ruta de una misión tiene una versión validada más reciente, la misión lo indica y el coordinador decide si actualiza. La versión nunca cambia sola *(propuesto, D-19)*.

**RF-519 (Should) Antigüedad de la validación.** Cada versión muestra cuándo se validó. Si supera un número de días configurable, se marca como posiblemente desactualizada *(propuesto)*. El terreno cambia: desprendimientos, nieve, pistas cerradas.

### E6 · Vista del rescatista

**RF-601 (Must) Listado de misiones activas** de su organización, con indicación de en cuáles se ha ofrecido y con qué estado. Es su pantalla de entrada.

**RF-602 (Must) Detalle de misión en solo lectura**: puntos, rutas validadas (en la versión fijada por la misión), métricas, notas, meteorología del objetivo, sobre el mapa.
- Ningún control de edición es visible ni funcional.
- No ve la lista de otros participantes en v1 *(propuesto)*.

**RF-603 (Must) Exportar rutas** (RF-511) de las rutas validadas.

**RF-604 (Should) Compartir la ubicación del objetivo** como enlace o coordenadas copiables.

**RF-605 (Must) Ofrecerse como voluntario y retirar la oferta.** Un rescatista puede ofrecerse a una misión activa. Queda como *Pendiente* hasta que el coordinador decida (RF-803).
- Requiere el perfil completo (RN-20).
- Ve el estado de su oferta: Pendiente, Aceptado o No seleccionado.
- Puede retirar su oferta mientras la misión esté activa.
- Es la única acción de escritura permitida al rescatista sobre una misión.

### E7 · Inicio y navegación

**RF-701 (Must) Pantalla de inicio informativa** tras el login. No permite editar nada.

**RF-702 (Must) Barra de navegación principal** según rol.
- Coordinador: Inicio, Misiones, Crear misión, Rutas *(propuesto)*, Equipos *(propuesto)*.
- Administrador: lo del coordinador más Administración *(propuesto)*.
- Rescatista *(propuesto)*: Misiones, Mi perfil.

**RF-703 (Should) Resumen de misiones activas** en el inicio, con lo pendiente de cada una (por ejemplo, voluntarios por decidir, rutas sin validar o misiones sin origen) *(propuesto)*. Cada misión se puede pinchar para ver el tiempo en su objetivo (RF-704).

**RF-704 (Should) Previsión meteorológica de montaña.** Por defecto, para la **ubicación del dispositivo**, leída al iniciar sesión (RF-708). Si el coordinador pincha una misión de la lista, pasa al **objetivo de esa misión**. Hay un enlace para volver a la ubicación propia.
- Se calcula siempre a la altitud del punto, no a la del valle.
- Muestra, para los próximos días: temperatura, viento y rachas, precipitación y nieve, nubosidad, y la altitud de la isoterma de 0 °C si el proveedor la ofrece.
- Cita al proveedor, como exigen sus condiciones.
- Los datos se guardan en caché por punto y altitud redondeados para limitar las llamadas y respetar los cupos gratuitos. Si el proveedor falla, la tarjeta lo indica y el resto del inicio sigue funcionando.
- Proveedores propuestos en D-18.

**RF-705 (Should) Luz y luna del mismo punto.** Amanecer, atardecer, crepúsculos, fase lunar con porcentaje de iluminación, y salida y puesta de la luna. Se calculan en local, sin proveedor externo *(propuesto en lo que va más allá de la fase lunar)*.
- Sin estimación de tiempos (D-03), la luz y la luna son la referencia temporal útil para planificar aproximaciones nocturnas.

**RF-706 (Could) Enlaces a boletines oficiales** (meteorología de montaña de AEMET y Météo-France, y boletines de aludes cuando haya temporada) de la zona mostrada *(propuesto)*.

**RF-707 (Could) Mapa en el inicio** con la posición del dispositivo y los objetivos de las misiones activas, con la misión elegida resaltada *(propuesto)*.

**RF-708 (Should) Ubicación del dispositivo.** Al iniciar sesión la app solicita permiso y lee la posición una vez.
- Solo se usa para consultar el tiempo, la luz y la luna del inicio. **No se guarda** *(propuesto)*.
- Sin permiso o sin señal, la tarjeta indica que se active la ubicación o se pinche una misión. Si se decide, se usará el punto base de la organización como alternativa *(propuesto)*.
- Con coordenadas redondeadas (~1 km) para aprovechar la caché.

### E8 · Equipos, voluntarios, perfil del rescatista y administración

**RF-801 (Must) Gestionar equipos**: crear, nombrar, indicar su **localidad** obligatoria, añadir y quitar miembros, archivar. Quién puede hacerlo está pendiente (Q-12).

**RF-802 (Must) Asignar equipos a una misión**, desde el detalle de la misión (RF-205).
- Los miembros del equipo quedan como participantes *Aceptados* *(propuesto)*.

**RF-803 (Must) Gestionar voluntarios y participantes de una misión.** Lista con una **casilla de selección a la izquierda** y, a la derecha, los datos del rescatista: **nombre, equipo (si pertenece a alguno) y localidad del equipo**, más el estado y la fecha de la oferta (D-22).
- Un rescatista sin equipo aparece sin localidad.
- Si pertenece a varios equipos, se muestran todos con su localidad.
- Seleccionar todos, ninguno o los de la página, y "seleccionar los N resultados" cuando hay varias páginas, como en el correo electrónico.
- Acciones en bloque sobre lo seleccionado: aceptar, rechazar y quitar.
- Contador de seleccionados y barra de acciones que aparece al seleccionar.
- Filtros por estado (pendientes, aceptados, no seleccionados), equipo y localidad, y búsqueda por nombre.
- Las acciones destructivas en bloque piden confirmación y ofrecen deshacer *(propuesto)*.
- Un rescatista no puede aceptarse a sí mismo (RN-15).
- La lista no muestra datos personales más allá de los indicados (RN-21).
- Al pulsar sobre un voluntario se abre su ficha (RF-808): equipo y localidad, cursos y habilidades con acceso a su certificado, teléfono y correo. Sin documento de identidad ni dirección, y sin historial de misiones (D-24, D-28).

**RF-804 (Should) Añadir rescatistas directamente** a una misión por el coordinador. Entran como *Aceptados*.

**RF-805 (Should) Asignar un equipo a una ruta** dentro de una misión, para saber qué equipo sigue cada ruta *(propuesto)*.

**RF-806 (Must) Perfil de rescatista.** Cada rescatista tiene un perfil con los datos del alta (RF-807), sus cursos y habilidades (RF-808) y su historial (RF-809).
- Lo ve y edita el propio rescatista. Los coordinadores ven nombre, equipo, cursos y habilidades, y contacto, pero no los datos sensibles ni el historial (RN-18, RN-23).

**RF-807 (Must) Alta de rescatista.** Formulario con los datos personales habituales:
- Nombre completo.
- Teléfono de contacto y correo electrónico, ambos obligatorios. El correo es el del inicio de sesión y viene rellenado (D-28).
- Documento de identidad: tipo y número. Para DNI y NIE se valida el formato y la letra de control. Se admite pasaporte u otro documento, porque en zona fronteriza habrá rescatistas franceses *(propuesto)*.
- Dirección completa: calle, número, piso, código postal, localidad, provincia y país.
- Cursos y habilidades (RF-808), opcional en el alta.
- El perfil debe estar completo para ofrecerse a una misión (RN-20).
- La cuenta se crea por registro con aprobación (RF-104, RF-106).

**RF-808 (Must) Cursos y habilidades.** Lista de entradas útiles para estas labores: nombre, tipo (curso o habilidad), entidad que lo expidió, fecha y caducidad opcionales *(propuesto)*.
- El rescatista añade, edita y elimina las suyas.
- Al añadir un curso puede **adjuntar su certificado** (PDF o imagen), de forma opcional (D-29).
- Los coordinadores y el administrador las ven en la ficha del voluntario y pueden abrir el certificado. Cada apertura queda registrada *(propuesto)*.
- Pueden servir de filtro en la lista de voluntarios (RF-811).

**RF-809 (Must) Historial de misiones.** Lista automática de las misiones en que el rescatista ha participado: nombre, fechas y estado de la misión.
- Lo ve el propio rescatista y el administrador *(propuesto)*. El coordinador no (D-24).
- No se edita a mano. Se genera a partir de las participaciones **confirmadas al cerrar la misión** (RF-208, RN-19).

**RF-810 (Should) Protección de datos sensibles.** Documento de identidad y dirección solo los ven el propio rescatista y el administrador de organización (D-24).
- Cada consulta de estos datos por el administrador queda registrada.
- Nunca aparecen en listas, exportaciones ni respuestas de API pensadas para listas (RN-21).

**RF-811 (Could, segunda entrega) Filtrar voluntarios por habilidad** *(propuesto)*.

**RF-812 (Should) Gestión de los propios datos.** El rescatista puede ver y corregir sus datos y solicitar su eliminación. Al eliminarlos, su historial de participaciones se conserva de forma anonimizada, no se borra (RN-22) *(propuesto)*.

**RF-813 (Must) Administración de usuarios.** El administrador ve los usuarios de su organización, cambia el rol y desactiva cuentas. Puede consultar el registro de accesos a datos sensibles y a certificados *(propuesto)*.

### E9 · Fuera de v1

Offline (v2), campo a través (v2), seguimiento en vivo (v3+), notificaciones (v3+). Su detalle se redactará cuando se acerque su fase.

## 6. Reglas de negocio

- **RN-01** Toda misión pertenece a una única organización (D-08). No se comparte con otras.
- **RN-02** Un rescatista nunca puede crear, modificar ni borrar misiones, puntos, rutas ni equipos. Sobre las misiones, su única escritura permitida es ofrecerse y retirar su oferta en misiones activas. Además, mantiene su propio perfil.
- **RN-03** Un rescatista solo ve versiones de ruta validadas, en la versión fijada por la misión.
- **RN-04** Las distancias se expresan en metros y kilómetros, y las altitudes en metros, en cualquier país.
- **RN-05** Los cambios en misiones, rutas y participación se registran (quién y cuándo).
- **RN-06** La app no almacena información de salud de las personas rescatadas en v1.
- **RN-07** Una misión es válida con solo nombre, coordinador responsable y punto objetivo.
- **RN-08** Generar una ruta desde una misión requiere objetivo y al menos un origen. Desde la biblioteca requiere dos puntos.
- **RN-09** Una misión cerrada es de solo lectura, incluidos el voluntariado y las rutas. Cerrar exige confirmar antes la participación (RF-208).
- **RN-10** Una ruta importada recalcula sus métricas y exige validación, igual que una generada.
- **RN-11** Toda misión tiene siempre un coordinador responsable. Si su cuenta se desactiva, la misión debe reasignarse *(propuesto)*.
- **RN-12** Las versiones de ruta son inmutables. Editar crea una versión nueva.
- **RN-13** Una misión referencia una versión concreta de cada ruta y no cambia sola *(propuesto, D-19)*.
- **RN-14** Una ruta usada en alguna misión (abierta o cerrada) no se elimina: se archiva. Solo una ruta **archivada y sin misión** se puede eliminar definitivamente, y es irreversible; las rutas derivadas de ella siguen existiendo sin el vínculo «deriva de».
- **RN-15** El voluntariado solo se abre en misiones *Activas*. Solo un coordinador puede aceptar o rechazar. Un rescatista no puede aceptarse a sí mismo.
- **RN-16** Una misión *En planificación* solo es visible para coordinadores *(propuesto, Q-16)*.
- **RN-17** Las rutas y sus versiones pertenecen a una organización y no se comparten con otras (D-08).
- **RN-18** El documento de identidad y la dirección de un rescatista solo los ven él mismo y el administrador de organización (D-24).
- **RN-19** El historial de misiones de un rescatista se genera a partir de las participaciones **confirmadas al cerrar la misión** y no se edita a mano. Un aceptado desmarcado no cuenta (D-27).
- **RN-20** Un rescatista no puede ofrecerse a una misión si su perfil no está completo *(propuesto)*.
- **RN-21** La lista de voluntarios solo muestra nombre, equipo y localidad del equipo. Ningún otro dato personal sale en listados. La ficha de un voluntario es una consulta individual, no un listado.
- **RN-22** Eliminar los datos de un rescatista anonimiza su historial. No lo borra, para no alterar el registro de las misiones *(propuesto)*.
- **RN-23** Teléfono y correo son obligatorios y los ven el administrador y los coordinadores. El coordinador solo los de los rescatistas ofrecidos o añadidos a misiones de su organización *(propuesto, D-28)*.
- **RN-24** Un certificado de curso es privado. Solo lo abren el propio rescatista, el administrador y los coordinadores, y cada apertura ajena queda registrada *(propuesto, D-29)*.
- **RN-25** Una cuenta *Pendiente de aprobación* no accede a ningún dato de la organización. El rol de coordinador solo lo concede un administrador (D-25).
- **RN-26** La ubicación del dispositivo no se guarda (D-30) *(propuesto)*.

## 7. Requisitos no funcionales (preliminares)

El detalle de cómo se cumplen está en el documento 04.

| Área | Requisito |
|---|---|
| Seguridad | Autenticación segura, contraseñas con hash robusto, permisos en servidor, aislamiento por organización (en aplicación y en base de datos), HTTPS siempre, registro de auditoría |
| Fiabilidad | Disponibilidad alta como objetivo de diseño, aunque el proyecto sea didáctico: es una herramienta pensada para emergencias. Degradación controlada si el servicio de rutas o el de meteorología fallan: se puede seguir consultando misiones y rutas ya validadas. La pantalla de inicio no se bloquea por un proveedor externo |
| Rendimiento | Generación de rutas con feedback de progreso. La búsqueda de rutas por punto (segunda entrega) responde en pocos segundos con decenas de miles de rutas en la biblioteca *(objetivo propuesto: menos de 2 s con 10.000 rutas)* |
| Portabilidad | API independiente del cliente. Lógica de rutas y geometría en el backend o en un paquete compartido, no en componentes de interfaz |
| Internacionalización | Interfaz traducible desde el primer día (mínimo español y francés). Sin textos fijos en el código |
| Datos | Datos geoespaciales en una base con soporte nativo (PostGIS) e índices geográficos. Fuentes de mapa, elevación y meteorología abstraídas tras una interfaz, para cambiarlas sin reescribir |
| Privacidad | El perfil de rescatista contiene datos personales sensibles (documento de identidad, dirección) y de contacto. Diseño con buenas prácticas de RGPD aunque el proyecto sea didáctico: minimización, cifrado en reposo de los datos sensibles, acceso restringido y registrado, derecho de acceso, corrección y supresión (RF-812). La ubicación del dispositivo no se guarda. **Datos de demostración siempre ficticios** (R-10) |
| Accesibilidad y uso en campo | Interfaz legible con luz solar y con guantes: controles grandes y alto contraste. Dos temas: **oscuro por defecto** (el rojo de rescate como acento; todos los pares de color calculados a 4,5:1 el texto y 3:1 los componentes) y **claro de alto contraste** para pleno sol (texto a 7:1 o más). Se elige en la vista Cuenta («Oscuro», «Claro (alto contraste)» o «Como el sistema») y se recuerda solo en ese navegador. Respeta además `forced-colors` y `prefers-reduced-motion`. El lector de pantalla y los botones de zoom del mapa de 29 px siguen pendientes (H7) |
| Costes | Hasta 20 €/mes en total (servidor, copias y dominio), con servicios externos gratuitos para uso no comercial (D-20, documento 04). Los cupos de los proveedores gratuitos condicionan el uso de caché |
| Licencias de datos | Revisar licencias y condiciones de uso de OpenStreetMap, teselas satélite, modelos de elevación y proveedor meteorológico antes de elegirlos. Respetar la atribución exigida a cada uno. Verificado en parte en el documento 04 |

## 8. Riesgos principales

Los riesgos técnicos R-11 a R-16 (motor de rutas, análisis de terreno en la v2, servicios de IGN, memoria del servidor, modelo de elevación, precio del servidor) están en el documento 04.

| ID | Riesgo | Mitigación |
|---|---|---|
| R-01 | El motor de rutas campo a través es complejo y puede no alcanzar calidad suficiente | Entregar v1 con rutas sobre red. Hacer una prueba técnica aislada (PoC) antes de comprometer v2. **Medido el 2026-11-01 sobre la red de los Pirineos: cumple con GraphHopper (documento 04, §7.6); el campo a través sigue sin medirse (v2). En H3 el motor se integró y pasa los mismos casos como regresión sobre los datos reales (documento 04, §7.6 y §12).** |
| R-02 | Calidad desigual de los datos entre países (senderos, elevación) | Medir sobre zonas reales de los Pirineos en ambos lados. Permitir edición manual (RF-505) |
| R-03 | Una ruta mala puede causar daño real | Validación humana obligatoria (RF-506), versiones inmutables, versión fijada en la misión, avisos visibles, registro de cambios. En un proyecto didáctico, aviso explícito de que no debe usarse en rescates reales |
| R-04 | Coste o licencias de teselas satélite y proveedores de mapas | Documento 04: mapa base propio con datos de OpenStreetMap y satélite de los servicios abiertos de IGN España y Francia. Licencias a seguir verificando |
| R-05 | El aislamiento por organización mal modelado es muy caro de corregir después | Incluirlo en el modelo de datos desde la primera migración, con filtro en la aplicación y seguridad por filas en la base de datos. Al no haber compartición entre organizaciones (D-08), el riesgo es menor |
| R-06 | La meteorología en montaña falla si se calcula a la altitud del valle: los modelos suavizan el relieve y pueden errar varios grados en una cima. Además, cobertura y licencia varían a cada lado de la frontera | Pedir siempre el pronóstico a la altitud del punto, y contrastarlo en una prueba con cimas reales de los Pirineos frente a los boletines oficiales. Proveedor detrás de una interfaz. Si falla, la tarjeta se degrada sin afectar al resto |
| R-07 | Archivos GPX/KML importados con trazado ruidoso, sin altitud o con datos erróneos | Recalcular métricas con el modelo de elevación propio, previsualizar antes de guardar y exigir validación (RF-510) |
| R-08 | Una ruta validada hace meses puede dejar de ser segura (desprendimientos, nieve, pistas cerradas), y la biblioteca fomenta reutilizarla | Mostrar la antigüedad de la validación (RF-519), exigir validar de nuevo al reutilizar en una misión nueva si ha caducado, y permitir marcarla no disponible (RF-508) |
| R-09 | Los cupos de los planes gratuitos meteorológicos son limitados. Open-Meteo permite hasta 10.000 llamadas al día en uso no comercial; el plan gratuito de Meteoblue, 5.000 al año | Caché con refresco cada varias horas y por punto redondeado. Open-Meteo como proveedor principal (D-18), con Meteoblue como alternativa |
| R-10 | Un proyecto público de portfolio con documento de identidad y dirección completa de personas es un riesgo si alguna vez entran datos reales | Usar solo datos ficticios en demostraciones y pruebas, nunca publicar una base de datos real, cifrar los datos sensibles, restringir su acceso y dejarlo escrito en el README |

## 9. Preguntas abiertas

**Resueltas**
- **Q-03** ¿Dos organizaciones trabajan sobre la misma misión? **No.** (D-08)
- **Q-07** ¿Quiénes son los usuarios iniciales y la organización piloto? **No hay piloto ni usuarios reales: es un proyecto didáctico** (D-20).
- **Q-08** Estados de la misión: **En planificación, Activa y Cerrada** (D-13).
- **Q-09** Voluntariado: **los rescatistas se ofrecen y el coordinador acepta** (D-17).
- **Q-11** Qué pasa al editar una ruta validada: **versionado**, con derivación (D-16).
- **Q-18** Qué muestra la lista de voluntarios: **nombre, equipo y localidad del equipo** (D-22). El perfil se rellena en el alta (D-23).
- **Q-19** Modelo de negocio: **proyecto didáctico, no comercial** (D-20).
- **Q-20** Búsqueda por punto y adaptación: **segunda entrega** (D-21).
- **Q-22** ¿"Agrupación" y "equipo" son lo mismo? **Sí** (D-26).
- **Q-23** ¿Cómo se crea la cuenta de un rescatista? **Se registra él mismo y un administrador la aprueba** (D-25).
- **Q-24** ¿Qué ve el coordinador de un rescatista? **Nombre, equipo, localidad del equipo, cursos y habilidades**, y después también **teléfono y correo**, que son obligatorios (D-24, D-28). No documento, dirección ni historial.
- **Q-25** ¿Qué cuenta como haber participado? **Lo que el coordinador confirma con la casilla al cerrar la misión** (D-27).

**Pendientes**
- **Q-01** ¿Se aceptan los roles de administrador de organización y superadministrador (sección 3)? El administrador ahora aprueba cuentas y custodia datos sensibles, así que su papel es más concreto.
- **Q-02** ¿Cuántos puntos de origen y cuántas rutas por misión son típicos? Define el tamaño de una demostración razonable.
- **Q-04** ¿Los puntos de reunión necesitan atributos propios (capacidad, tipo de acceso, contacto), o basta con nombre, ubicación y notas?
- **Q-06** ¿Hay un nombre definitivo para "puntos de reunión"? (Punto de encuentro, base avanzada, punto de relevo...)
- **Q-10** ¿Pueden editar una misión todos los coordinadores de la organización, o solo su coordinador responsable?
- **Q-12** ¿Quién puede crear y gestionar equipos y sus miembros: los coordinadores, el administrador de organización, el propio rescatista al elegir su equipo, o varios?
- **Q-13** ¿Qué prioridad tiene cada elemento del inicio? ¿Aceptas Open-Meteo como proveedor meteorológico principal con Meteoblue como alternativa (D-18)?
- ~~**Q-05** ¿Quién fija las zonas a evitar y las ve el rescatista? ¿Se guardan en la misión o en la biblioteca? (RF-507)~~ **Resuelta (2026-11-01, H3): se guardan en la organización, con una misión opcional (`avoid_zones.mission_id` admite nulo, migración 0005).** Sin misión, la zona sirve a toda la organización; con ella, solo a esa misión. Las dibuja y borra el coordinador, las lee el personal y el rescatista no las ve. Una zona de una misión cerrada no se crea ni se borra (`MISSION_CLOSED`).
- ~~**Q-14** ¿Puede el administrador de organización ver y editar misiones, o solo gestionar usuarios, equipos y datos sensibles?~~ **Resuelta (2026-10-31): no.** El administrador lee las misiones pero no las escribe (ni crea, ni edita, ni activa, ni cierra); gestiona usuarios, equipos y datos sensibles. Lo escribe solo el coordinador (`MISSION_WRITERS`, y también las políticas de la base de datos: migración 0011).
- **Q-15** Para informar a otras organizaciones (D-08), ¿qué formato necesitas: ficha en PDF, enlace de solo lectura, o basta con exportar las rutas?
- **Q-16** Una misión *En planificación*, ¿solo la ven los coordinadores? ¿Los rescatistas solo pueden ofrecerse cuando está *Activa*?
- ~~**Q-17** ¿Pueden los rescatistas consultar la biblioteca de rutas, o solo ven las rutas de las misiones activas?~~ **Resuelta (2026-11-02, H4): no consultan la biblioteca.** Ven las rutas de las misiones que pueden ver (activas y cerradas), solo la versión validada y fijada (RN-03, INV-05); la *no disponible* se ve señalada. Lo deciden el servidor y las políticas de la base (`listMyMissionRoutes`).
- **Q-21** ¿Quieres poder etiquetar las rutas (macizo, vertiente, época del año, tipo de terreno) para filtrar la biblioteca?
- **Q-31** ¿El rescatista ve las misiones activas de toda la organización o solo las de sus equipos? ¿Debe recibir algún aviso al ser aceptado o al cerrarse la misión? *(nueva)*
- **Q-32** Si el rescatista deniega la ubicación del dispositivo, ¿se usa el punto base de la organización para el tiempo del inicio? *(nueva)*

- ~~**Q-33** Recuperar contraseña~~ **Cerrada:** por correo transaccional (Resend tras el puerto `Mailer`), enlace de un solo uso que caduca en 1 h. Pendiente solo el dominio para enviar a terceros (Q-28)
- **Q-34** Solicitudes de alta sin «equipo indicado» ni «datos completos»: el registro solo recoge correo, nombre, contraseña y código, y el perfil nace al aprobar **Cerrada:** confirmada (documento 06 §5)
- ~~**Q-35** Días de validación antigua (RF-519)~~ **Cerrada:** 90, configurable por organización
- **Q-36** Alias de coordinadores y rescatistas, del estilo `criantval ALC` (tres letras del nombre y de cada apellido, y un código de la localidad del equipo): ¿se genera o lo elige la persona?, ¿qué pasa con varios equipos o ninguno?, ¿qué lo ve y dónde? Aplazada hasta después del MVP; el alcance se decide al planificar H5. Detalle en `docs/backlog-post-mvp.md` (B-02) *(nueva)*

Las preguntas técnicas Q-26 a Q-30 están en el documento 04.

## 10. Glosario

- **Misión:** operación de rescate planificada, con orígenes, objetivo, puntos, equipos, voluntarios y rutas.
- **Objetivo:** punto al que se quiere llegar (la persona o lugar de rescate). En versiones anteriores se llamaba "destino".
- **Origen:** punto desde el que sale un equipo. En versiones anteriores se llamaba "salida" o "partida".
- **Ruta:** trazado con un inicio y un final, que vive en la biblioteca de la organización y puede usarse en varias misiones.
- **Versión de ruta:** estado concreto e inmutable de una ruta. Editar crea una versión nueva.
- **Ruta derivada:** ruta nueva creada a partir de otra, que recuerda su origen.
- **Biblioteca de rutas:** conjunto permanente de rutas de una organización, que se explora con lista y mapa.
- **Versión fijada:** versión concreta de una ruta que una misión ha elegido usar.
- **Alternativa:** otra ruta hacia el mismo objetivo desde el mismo origen.
- **Punto de reunión:** lugar donde se concentran equipos o cambian de medio.
- **Equipo (o agrupación):** grupo nombrado de rescatistas de una organización, con una localidad obligatoria, asignable a misiones (D-26).
- **Localidad del equipo:** ciudad o agrupación de procedencia del equipo. Es lo que se muestra en la lista de voluntarios, no la del rescatista.
- **Voluntario:** rescatista que se ha ofrecido a una misión y espera decisión del coordinador.
- **Participante:** rescatista aceptado en una misión, ya sea por oferta o por asignación de equipo.
- **Participación confirmada:** aceptado al que el coordinador ha marcado como que participó al cerrar la misión. Solo estas entran en el historial.
- **Ficha del voluntario:** vista con el equipo, la localidad, los cursos y habilidades, el teléfono y el correo de un rescatista, sin datos sensibles.
- **Datos de contacto:** teléfono y correo del rescatista. Los ven el administrador y los coordinadores.
- **Datos sensibles:** documento de identidad y dirección completa del rescatista.
- **Certificado de curso:** archivo opcional que acredita un curso.
- **Solicitud de alta:** registro de una persona pendiente de que el administrador lo apruebe.
- **Historial de misiones:** lista automática de las misiones en que un rescatista ha participado, según lo confirmado al cerrarlas.
- **Campo a través:** tramo sin camino ni sendero.
- **Validar:** acción del coordinador por la que una versión de ruta pasa a ser visible para los rescatistas.
- **En planificación:** estado inicial de una misión, en preparación.
- **Segunda entrega:** segunda fase de v1, con búsqueda por punto y adaptación de rutas.

## 11. Siguientes documentos

| Nº | Documento | Estado |
|---|---|---|
| 02 | Flujo del coordinador y estructura de vistas | v0.4 |
| 03 | Modelo de dominio y flujos clave | v0.3 |
| 04 | Arquitectura, stack y decisiones, incluida la elección del motor de rutas | v0.3 (borrador) |
| 05 | Modelo de datos, con el esquema SQL de las migraciones en la carpeta `db/` | v0.1 (borrador) |
| 06 | Contratos de API, con el paquete `packages/contracts` (esquemas Zod, registro de endpoints y 74 pruebas) | v0.3 (borrador) |
| 07 | Plan de implementación por hitos y `CLAUDE.md` | v0.1 (borrador) |

Los bocetos de baja fidelidad de las 15 vistas están en un lienzo aparte y acompañan al documento 02.

## 12. Registro de cambios

**1.5 (2026-11-13)**
- Issue #17: RN-14 y RF-512 permiten eliminar definitivamente una ruta **archivada y sin misión** (antes: «solo archivar»). Protocolo: quitar de las misiones abiertas → archivar → eliminar desde la lista de archivadas. Se revisa también el punto 10 de `docs/constitution.md` y la regla 4 de `CLAUDE.md`.

**1.4 (2026-11-06)**
- Cierre de `UI-rediseno` (issue #14): §7 «Accesibilidad y uso en campo» matizado: tema oscuro por defecto y tema claro de alto contraste para pleno sol, elegible en Cuenta (el contraste, adelantado de H7). Sin requisitos nuevos ni cambios de alcance.

**1.3 (2026-11-02)**
- D-34: el rescatista ve nombre y localidad de todos los equipos de su organización (construcción en H5). Nueva Q-36 (alias de coordinadores y rescatistas), aplazada. Backlog tras el MVP en `docs/backlog-post-mvp.md`.
- H4 (cierra el MVP): RF-508 (no disponible), RF-513 (añadir ruta a la misión, por la biblioteca, generando o importando), RF-518 (aviso de versión nueva, que nunca cambia sola), RF-601 a RF-604 (el rescatista ve las rutas validadas y fijadas, las descarga y comparte la ubicación del objetivo) y RF-805 (equipo por ruta: el servidor lo admite y la interfaz lo muestra; el selector llega con los equipos en H5) quedan construidos. Resuelta Q-17. RF-603: el rescatista solo descarga validadas, fijadas y disponibles, y solo con la misión activa; el coordinador, la versión fijada de todas (las no disponibles solo si las pide).

**1.2 (2026-11-01)**
- H3: RF-304 (la ruta cruza la frontera en la misma red y sin cortes), RF-501 (generar, con puntos intermedios), RF-503 (composición real de lo generado y de lo dibujado pegado a caminos) y RF-507 (zonas a evitar) quedan construidos. Resuelta Q-05: las zonas pertenecen a la organización, con misión opcional, y no las ve el rescatista. R-01 anota la regresión sobre datos reales.

**1.1 (2026-11-01)**
- Prueba técnica del motor cerrada: R-01 anota el resultado sobre la red (GraphHopper 11.1 cumple los criterios del documento 04, §7.3; el campo a través sigue sin medirse). Sin cambios de requisitos.

**1.0 (2026-10-31)**
- H2: RF-503 aclara que lo que no pasa por el motor es «sin clasificar» (decisión P1) y RF-511 recoge `exportRoutes` (P3). Los GPX de demostración y de pruebas son inventados (P2).

**0.9 (2026-10-31)**
- Resuelta Q-14: el administrador no escribe misiones (H1-T6). Su barra de navegación pierde «Crear misión» (documento 02, §2 y §6). Cambiarlo ya no es una sola constante: el servidor (`MISSION_WRITERS`) y la base de datos (migración 0011, documento 05) lo repiten.

**0.8 (2026-10-30)**
- Alcance por versión reorganizado en hitos (D-33, documento 07): MVP en H0–H4, primera entrega hasta H7, segunda entrega H8–H9, v2 y v3 en bloques. Documento 07 y `CLAUDE.md` escritos.

**0.7 (2026-10-29)**
- Cerradas Q-33 (recuperar contraseña por correo), Q-34 (solicitudes sin equipo ni datos completos) y Q-35 (90 días).

**0.6 (2026-10-29)**
- RF-106: la solicitud de alta muestra correo y nombre, no «datos completos» (Q-34). Nuevas Q-33 a Q-35. Documento 06 escrito.

**0.5 (2026-10-29)**
- El producto pasa a llamarse **OnWay** (D-31).
- Resueltas Q-22, Q-23, Q-24 y Q-25 (D-24 a D-27). Equipo y agrupación son lo mismo. Registro con aprobación del administrador (RF-104, RF-106, RN-25). Participación confirmada al cerrar (RF-208, RN-19).
- Datos de contacto: teléfono y correo obligatorios, visibles para coordinador y administrador (D-28, RN-23). El historial deja de verlo el coordinador.
- Certificado de curso opcional (D-29, RN-24).
- Meteorología del inicio por ubicación del dispositivo o por objetivo elegido (D-30, RF-704, RF-708, RN-26).
- Biblioteca de rutas con lista y mapa como Wikiloc (RF-512). La búsqueda de dirección se lanza al pulsar (RF-401).
- Nuevas RF-106, RF-208, RF-708 y RF-813. Nuevas Q-31 y Q-32.
- Stack y despliegue en el documento 04 (D-32). Presupuesto de hasta 20 €/mes.

**0.4 (2026-10-29)**
- Resueltas Q-07, Q-18, Q-19 y Q-20. El proyecto es didáctico y sin ánimo comercial (D-20).
- Alcance en dos entregas: la búsqueda por punto y la adaptación pasan a la segunda (D-21, RF-514, RF-515, RF-811).
- La lista de voluntarios muestra nombre, equipo y localidad del equipo (D-22, RF-803, RN-21). Los equipos llevan localidad (RF-801).
- Nuevo alta de rescatista con datos personales, cursos y habilidades, e historial de misiones (D-23, RF-806 a RF-809).
- Protección de datos sensibles: documento de identidad y dirección (D-24, RF-810, RF-812, RN-18, RN-22, R-10).
- Meteorología: Open-Meteo pasa a proveedor principal y Meteoblue a alternativa, por el cupo gratuito (D-18, R-09).
- Nuevas preguntas Q-22 a Q-25.

**0.3 (2026-10-29)**
- Resueltas Q-08, Q-09 y Q-11. Estado *En planificación*. Biblioteca permanente de rutas con versionado y derivación. Versión fijada en la misión. Voluntariado con aceptación. Inicio con meteorología, luz solar y fase lunar. Nuevas reglas RN-12 a RN-17, riesgos R-08 y R-09, y preguntas Q-16 a Q-21.

**0.2 (2026-10-29)**
- Resuelta Q-03 (D-08). Añadidos importar y exportar rutas (D-09), creación mínima de misión (D-10), flujo de entrada (D-11), equipos y rescatistas (D-12). Unificados los términos "objetivo" y "origen".

**0.1 (2026-10-29)** Primera versión.

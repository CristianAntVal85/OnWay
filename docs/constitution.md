# Constitución del proyecto — OnWay

Principios innegociables. Cualquier plan o código que los contradiga se corrige antes de continuar. El detalle vive en los documentos 01–07; aquí solo lo que no se negocia.

## Método

1. **Los documentos mandan.** El *qué* está en 01–03 y el *cómo* en 04–06; si se contradicen, gana el de número más bajo para el qué y el más alto para el cómo. Si falta una decisión, se pregunta; nunca se inventa.
2. **Hitos pequeños y en orden** (doc 07). Se trabaja un hito por vez, con alcance por identificadores (RF, INV, operaciones `x-milestone`). No se adelanta trabajo de hitos posteriores sin aprobación explícita.
3. **Contrato primero.** Todo cambio de API empieza en `packages/contracts`, y en el mismo cambio se regeneran el OpenAPI y el documento 06.
4. **Una prueba por invariante** (INV-xx) tocada, contra base real. Nada se da por cumplido por revisión de código.
5. **Un commit y un push por tarea**, con todo en verde, en la rama `hito/Hn-nombre`; `main` solo recibe hitos validados.
6. **Terminado = definición de la sección 4 del doc 07.** Incluye la demostración del hito ejecutable y los documentos al día.

## Seguridad y datos

7. **Aislamiento por organización**: seguridad por filas en la base de datos como defensa real y filtro en la aplicación como segunda. Recurso de otra organización → 404. La aplicación no usa superusuario ni `BYPASSRLS`.
8. **Los permisos los decide el servidor.** El rescatista nunca escribe en misiones, rutas ni equipos.
9. **Datos personales mínimos.** Ningún listado los devuelve; documento y dirección cifrados y solo por la función auditada; la ubicación del dispositivo no se guarda.
10. **Versiones de ruta inmutables**; las rutas se archivan. Solo se elimina del todo una ruta **ya archivada y sin misión**, por decisión expresa del coordinador y con confirmación (issue #17; antes: «no se borran»). El servidor calcula elevación y métricas; nunca se fía del cliente ni de un GPX.
11. **Solo datos ficticios** y cero secretos en el repositorio, las pruebas o las demostraciones. Orientación civil: ningún texto ni decisión adopta un encuadre militar.

## Arquitectura

12. **Stack fijo**: TypeScript, NestJS, React + Vite, PostgreSQL 16 + PostGIS, MapLibre, pnpm. Una dependencia nueva o un cambio de stack requiere aprobación explícita.
13. **Lo externo detrás de puertos** (`FileStorage`, `GeocodingProvider`, `WeatherProvider`, `ElevationProvider`, `RoutingProvider`, `Mailer`, `Clock`). Nada de lógica de rutas o geometría en componentes de React: vive en `packages/geo` o en el servidor.
14. **Migraciones SQL aditivas y numeradas**; no se edita una ya aplicada.

## Idioma y calidad

15. **Documentos y textos de interfaz en español; código, identificadores y commits en inglés.** Textos de interfaz solo por `packages/i18n` (es, fr). Comentarios solo cuando el motivo no es obvio.
16. **Cada vista** tiene estados de carga, vacío y error, funciona en móvil y se maneja con teclado.
17. **Cambiar una decisión** de los documentos implica editar el documento y anotarlo en su registro de cambios.

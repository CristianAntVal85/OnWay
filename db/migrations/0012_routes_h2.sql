-- 0012 · H2 (biblioteca de rutas sin motor): tipo de vía «sin clasificar» y subida de GPX/KML solo del coordinador
--
-- 1. road_type + 'unknown'. Una ruta importada, dibujada o editada a mano no sabe por qué tipo de camino va: el
--    clasificador es el motor de rutas (H3, RF-503). Antes de añadir este valor cualquier tipo habría sido un dato
--    inventado. En H2 toda ruta tiene un único tramo 'unknown'. El valor nuevo no puede usarse en la misma
--    transacción que lo crea; esta migración solo lo añade.
-- 2. files_insert. La 0008 dejaba al personal insertar archivos de importación de rutas. Con Q-14 = no (0011) solo el
--    coordinador escribe rutas: aquí la base de datos lo repite para los archivos de importación (defensa en
--    profundidad, regla 2). El administrador sigue leyendo los archivos de su organización (files_select).

ALTER TYPE road_type ADD VALUE IF NOT EXISTS 'unknown';

DROP POLICY IF EXISTS files_insert ON files;
CREATE POLICY files_insert ON files FOR INSERT TO onway_app WITH CHECK (
  (owner_user_id = app_user_id() AND purpose = 'certificate') OR (app_is_coordinator() AND purpose = 'route_import'));

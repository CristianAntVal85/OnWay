// Piezas comunes: identificadores, fechas, geografía, paginación, selección en bloque.
import { z } from 'zod';

export const Id = z.uuid();
export const Timestamp = z.iso.datetime({ offset: true });
export const DateOnly = z.iso.date();
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alfa-2 en mayúsculas');

/** Referencia mínima a una persona. Solo nombre: nunca contacto. */
export const PersonRef = z.strictObject({ id: Id, displayName: z.string() });
/** Referencia a un equipo tal como se enseña en listas (RN-21: nombre y localidad). */
export const TeamRef = z.strictObject({ id: Id, name: z.string(), locality: z.string() });

// ---------- Geografía ----------
// En la API los puntos son objetos {lat, lon} (sin ambigüedad de orden). Las geometrías de línea usan GeoJSON, [lon, lat, altitud].
export const Lat = z.number().min(-90).max(90);
export const Lon = z.number().min(-180).max(180);
export const Elevation = z.number().min(-500).max(9000);

/** Lat/lon en cadena de consulta llegan como texto: se convierten antes de validar el rango. */
export const QueryLat = z.coerce.number().min(-90).max(90);
export const QueryLon = z.coerce.number().min(-180).max(180);

export const LatLon = z.strictObject({ lat: Lat, lon: Lon });
/** Punto con altitud. La altitud la calcula siempre el servidor (RN-07): el cliente nunca la envía. */
export const GeoPoint = z.strictObject({ lat: Lat, lon: Lon, elevationM: Elevation });

const Position2D = z.tuple([Lon, Lat]);
const Position3D = z.tuple([Lon, Lat, Elevation]);

/** Trazado enviado por el cliente (dibujo, edición). Las altitudes que traiga se ignoran y se recalculan. */
export const LineStringInput = z.strictObject({
  type: z.literal('LineString'),
  coordinates: z.array(z.union([Position3D, Position2D])).min(2).max(20000),
});
/** Trazado devuelto con altitud. */
export const LineString3D = z.strictObject({
  type: z.literal('LineString'),
  coordinates: z.array(Position3D).min(2),
});
/** Trazado simplificado (≈200 puntos, sin altitud) para pintar listas en el mapa. */
export const LineStringPreview = z.strictObject({
  type: z.literal('LineString'),
  coordinates: z.array(Position2D).min(2).max(400),
});
export const PolygonInput = z
  .strictObject({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(Position2D).min(4)).length(1),
  })
  .refine((p) => {
    const ring = p.coordinates[0]!;
    const a = ring[0]!, b = ring[ring.length - 1]!;
    return a[0] === b[0] && a[1] === b[1];
  }, 'El anillo del polígono debe cerrarse');

// ---------- Paginación ----------
export const PageQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type PageQuery = z.infer<typeof PageQuery>;

/** Respuesta paginada. `total` es el de los resultados filtrados, no el de la tabla. */
export const Paged = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  });

// ---------- Selección en bloque (bandeja de correo) ----------
/** "Seleccionados 25" (ids) o "Seleccionar los 134 resultados" (filtro + excepciones). */
export const Selection = <F extends z.ZodType>(filter: F) =>
  z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('ids'), ids: z.array(Id).min(1).max(500) }),
    z.strictObject({ mode: z.literal('filter'), filter, exceptIds: z.array(Id).max(500).default([]) }),
  ]);

/** Resultado de una acción en bloque. Las filas omitidas llevan su motivo (p. ej. la oferta ya se retiró). */
export const BulkResult = z.strictObject({
  affected: z.number().int().min(0),
  skipped: z.array(z.strictObject({ id: Id, reason: z.string() })),
});

export const Empty = z.strictObject({});
export const Ok = z.strictObject({ ok: z.literal(true) });

/** Booleano en cadena de consulta: z.coerce.boolean() convierte "false" en true, así que se evita. */
export const QueryBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

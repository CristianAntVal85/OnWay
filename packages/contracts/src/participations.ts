// Voluntarios y participantes (documento 02, §3.7). RN-21: la LISTA solo lleva nombre, equipo y localidad del equipo.
import { z } from 'zod';
import { BulkResult, Id, PageQuery, Paged, Selection, Timestamp, TeamRef } from './common.js';
import { ParticipationOrigin } from './enums.js';
import { Skill } from './profile.js';

/** Estados que aparecen en la bandeja (pestañas). Retirados y quitados no se listan: su ficha responde 404. */
export const ParticipationListStatus = z.enum(['pending', 'accepted', 'not_selected']);

/** Fila de la bandeja. No añadir campos personales aquí: hay una prueba que lo impide. */
export const ParticipationListItem = z.strictObject({
  id: Id,
  userId: Id,
  displayName: z.string(),
  teams: z.array(TeamRef), // [] = "Sin equipo"
  status: ParticipationListStatus,
  origin: ParticipationOrigin,
  offeredAt: Timestamp.nullable(),
  decidedAt: Timestamp.nullable(),
});


export const ParticipationFilter = z.strictObject({
  status: ParticipationListStatus.default('pending'),
  teamId: Id.optional(),
  locality: z.string().trim().max(120).optional(), // localidad del equipo
  q: z.string().trim().max(120).optional(),
});

export const ListParticipationsQuery = PageQuery.extend(ParticipationFilter.shape);

export const ParticipationsPage = Paged(ParticipationListItem).extend({
  /** Contadores de las pestañas. Se calculan sobre toda la misión, sin los filtros de equipo/búsqueda. */
  counts: z.strictObject({
    pending: z.number().int().min(0),
    accepted: z.number().int().min(0),
    notSelected: z.number().int().min(0),
  }),
});

/** Ficha del voluntario: consulta individual. Contacto solo si la participación está Pendiente o Aceptada (INV-28). Nunca documento, dirección ni historial. */
export const VolunteerCard = z.strictObject({
  participation: ParticipationListItem,
  skills: z.array(Skill),
  contact: z.strictObject({ phone: z.string(), email: z.string() }).nullable(),
});

export const BulkAction = z.enum(['accept', 'reject', 'reconsider', 'remove']);

export const BulkParticipationRequest = z
  .strictObject({
    action: BulkAction,
    selection: Selection(ParticipationFilter),
    /**
     * "Quitar" pide confirmar con el número de afectados (§3.7). Si la cifra no coincide con la real en ese momento
     * (alguien retiró su oferta), 409 STALE_RESOURCE y no se aplica nada.
     */
    expectedCount: z.number().int().min(1).max(5000).optional(),
  })
  .refine((v) => v.action !== 'remove' || v.expectedCount !== undefined, {
    path: ['expectedCount'],
    message: 'Quitar exige expectedCount',
  });
export const BulkParticipationResponse = BulkResult;

/** Añadir rescatistas sueltos (RF-804): entran como Aceptados. */
export const AddParticipantsRequest = z.strictObject({ userIds: z.array(Id).min(1).max(200) });
export const AddMissionTeamsRequest = z.strictObject({ teamIds: z.array(Id).min(1).max(50) });

/** Tras añadir equipos o rescatistas: cuántos entraron y cuántos ya estaban. */
export const AddParticipantsResponse = z.strictObject({ added: z.number().int().min(0), alreadyPresent: z.number().int().min(0) });

/** Diálogo "¿Quién participó?" del cierre: aceptados con su equipo, para pintar las casillas. */
export const AttendanceCandidate = z.strictObject({
  participationId: Id,
  displayName: z.string(),
  teams: z.array(TeamRef),
});
export const AttendanceCandidates = z.strictObject({ items: z.array(AttendanceCandidate) });

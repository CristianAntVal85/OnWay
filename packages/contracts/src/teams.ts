// Equipos (documento 02, §3.8) y selectores de personas. Nada de contacto aquí (RN-21).
import { z } from 'zod';
import { Id, PageQuery, Paged, PersonRef, QueryBool, TeamRef, Timestamp } from './common.js';
import { TeamStatus } from './enums.js';

export const TeamItem = z.strictObject({
  id: Id,
  name: z.string(),
  locality: z.string(),
  status: TeamStatus,
  memberCount: z.number().int().min(0),
});

export const TeamDetail = TeamItem.extend({
  members: z.array(PersonRef),
  createdAt: Timestamp,
});

export const ListTeamsQuery = PageQuery.extend({
  status: TeamStatus.optional(),
  q: z.string().trim().max(120).optional(),
});
export const TeamsPage = Paged(TeamItem);

export const CreateTeamRequest = z.strictObject({
  name: z.string().trim().min(1).max(120),
  locality: z.string().trim().min(1).max(120), // INV-23: obligatoria
});
export const UpdateTeamRequest = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    locality: z.string().trim().min(1).max(120).optional(),
    status: TeamStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un campo');

export const AddTeamMembersRequest = z.strictObject({ userIds: z.array(Id).min(1).max(200) });

// ----- Selectores (staff) -----
/** Fila del selector "Añadir rescatista" / "Rescatistas individuales". Solo rescatistas con el perfil completo. */
export const RescuerPickerItem = z.strictObject({
  userId: Id,
  displayName: z.string(),
  teams: z.array(TeamRef),
});
export const ListRescuersQuery = PageQuery.extend({
  q: z.string().trim().max(120).optional(),
  teamId: Id.optional(),
  profileComplete: QueryBool.default(true),
});
export const RescuersPage = Paged(RescuerPickerItem);

/** Selector "Coordinador responsable". */
export const CoordinatorOption = PersonRef;

// Hitos de construcción de v1 (documento 07). Cada hito es un incremento que el propietario puede ver funcionando.
// H0–H4 son el MVP; H5–H7 completan la primera entrega de v1; H8–H9 son la segunda entrega (D-21).
export const MILESTONES = ['H0', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9'] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Endpoint (id del registro) → hito en que se implementa. Una prueba exige que estén todos y solo los del registro. */
export const MILESTONE_OF: Record<string, Milestone> = {
  // H0 · Cimientos y acceso con cuentas de demostración
  getHealth: 'H0',
  login: 'H0',
  logout: 'H0',
  getMe: 'H0',
  getOrganization: 'H0',

  // H1 · Misiones y mapa
  listCoordinators: 'H1',
  geocode: 'H1',
  getElevation: 'H1',
  getEnvironment: 'H1',
  listMissions: 'H1',
  createMission: 'H1',
  getMission: 'H1',
  updateMission: 'H1',
  duplicateMission: 'H1',
  activateMission: 'H1',
  closeMission: 'H1',
  reopenMission: 'H1',
  listMissionHistory: 'H1',
  createMissionPoint: 'H1',
  updateMissionPoint: 'H1',
  deleteMissionPoint: 'H1',
  listMyMissions: 'H1',
  getMyMission: 'H1',

  // H2 · Biblioteca de rutas sin motor: importar, dibujar, versionar, validar, exportar
  uploadFile: 'H2',
  importMissionPoints: 'H2',
  listRoutes: 'H2',
  createRoute: 'H2',
  previewRouteImport: 'H2',
  getRoute: 'H2',
  archiveRoute: 'H2',
  deleteRoute: 'H2',
  updateRoute: 'H2',
  getRouteVersion: 'H2',
  createRouteVersion: 'H2',
  deriveRoute: 'H2',
  validateRouteVersion: 'H2',
  exportRoute: 'H2',
  exportRoutes: 'H2',

  // H3 · Generación automática con el motor de rutas
  generateRoutes: 'H3',
  snapRoute: 'H3',
  getJob: 'H3',
  listAvoidZones: 'H3',
  createAvoidZone: 'H3',
  deleteAvoidZone: 'H3',

  // H4 · Rutas en la misión y vista del rescatista (cierra el MVP)
  listMissionRoutes: 'H4',
  addMissionRoutes: 'H4',
  updateMissionRoute: 'H4',
  removeMissionRoute: 'H4',
  getMissionRouteGeometry: 'H4',
  exportMissionRoutes: 'H4',
  listMyMissionRoutes: 'H4',
  getMyMissionRouteGeometry: 'H4',
  exportMyMissionRoutes: 'H4',

  // H5 · Personas: registro, aprobación, perfil, habilidades y equipos
  register: 'H5',
  forgotPassword: 'H5',
  resetPassword: 'H5',
  changePassword: 'H5',
  updateMe: 'H5',
  listSignupRequests: 'H5',
  decideSignupRequests: 'H5',
  listUsers: 'H5',
  getUser: 'H5',
  updateUser: 'H5',
  getInviteCode: 'H5',
  rotateInviteCode: 'H5',
  getMyProfile: 'H5',
  updateMyProfile: 'H5',
  getMySensitive: 'H5',
  listMySkills: 'H5',
  createMySkill: 'H5',
  updateMySkill: 'H5',
  deleteMySkill: 'H5',
  getCertificateLink: 'H5',
  listTeams: 'H5',
  createTeam: 'H5',
  getTeam: 'H5',
  updateTeam: 'H5',
  addTeamMembers: 'H5',
  removeTeamMember: 'H5',

  // H6 · Voluntariado, cierre con asistencia, historial y privacidad
  listRescuers: 'H6',
  addMissionTeams: 'H6',
  removeMissionTeam: 'H6',
  listParticipations: 'H6',
  getParticipationCard: 'H6',
  addParticipants: 'H6',
  bulkParticipations: 'H6',
  listAttendanceCandidates: 'H6',
  offerToMission: 'H6',
  withdrawOffer: 'H6',
  listMyHistory: 'H6',
  listMyAccessLog: 'H6',
  deleteMyData: 'H6',
  exportMyData: 'H6',
  readUserSensitive: 'H6',
  listUserHistory: 'H6',
  listAuditLog: 'H6',

  // H7 · Cierre de la primera entrega (despliegue y endurecimiento): sin endpoints nuevos

  // H8 · Búsqueda de rutas por punto (segunda entrega)
  listNearRoutes: 'H8',
  // H9 · Adaptar rutas y filtro de voluntarios por habilidad (segunda entrega; RF-811 es un parámetro de listParticipations)
  adaptRoute: 'H9',
};

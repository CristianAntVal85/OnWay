// Genera las tablas Markdown del documento 06 desde el registro. Uso: tsx scripts/gen-endpoints-doc.ts <carpeta-salida>
import { mkdirSync, writeFileSync } from 'node:fs';
import { ENDPOINTS, MILESTONES, allErrors, implicitErrors, ERROR_HTTP, ERROR_CODES, type Endpoint, type Role } from '../src/index.js';
import { flatten, toJson } from './jsonschema.js';

const outDir = process.argv[2] ?? 'gen';
mkdirSync(outDir, { recursive: true });

const ROLE: Record<Role, string> = { public: 'Público', pending: 'Pendiente', rescuer: 'Rescatista', coordinator: 'Coordinador', admin: 'Admin' };
const roles = (r: readonly Role[]) =>
  r.length >= 4 && r.includes('rescuer') && r.includes('coordinator') && r.includes('admin')
    ? r.includes('pending')
      ? 'Todos con sesión'
      : 'Rescatista, coordinador, admin'
    : r.map((x) => ROLE[x]).join(', ');

function keys(schema: Endpoint['body'] | Endpoint['query'], io: 'input' | 'output'): string {
  if (!schema) return '—';
  const js = toJson(schema, io);
  const props = js.properties ?? (js.anyOf ? Object.assign({}, ...js.anyOf.map((a: any) => a.properties ?? {})) : undefined);
  if (!props) return '—';
  const req = new Set<string>(js.required ?? []);
  const names = Object.keys(props).map((k) => (req.has(k) ? k : `${k}?`));
  return names.length > 9 ? `${names.slice(0, 9).join(', ')}, …` : names.join(', ');
}

const methodPath = (e: Endpoint) => `\`${e.method} ${e.path}\``;
const delivery = (e: Endpoint) => `· **${e.milestone}**${e.delivery === 2 ? ' (2.ª entrega)' : ''}${e.delivery === 'pendiente' ? ' **pendiente**' : ''}`;

const tags = [...new Set(ENDPOINTS.map((e) => e.tag))];
let md = '';
for (const tag of tags) {
  md += `### ${tag}\n\n| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |\n|---|---|---|---|---|---|\n`;
  for (const e of ENDPOINTS.filter((x) => x.tag === tag)) {
    const input =
      [
        e.params ? `ruta: ${Object.keys(e.params.shape).join(', ')}` : '',
        e.query ? `consulta: ${keys(e.query, 'input')}` : '',
        e.body ? `cuerpo: ${keys(e.body, 'input')}` : '',
        e.multipart ? `formulario: ${keys(e.multipart, 'input')} + file` : '',
      ]
        .filter(Boolean)
        .join('<br>') || '—';
    const resp = e.response.status === 204 ? '204' : e.response.file ? `${e.response.status} archivo` : `${e.response.status}: ${keys(e.response.schema, 'output')}`;
    const errs = (e.errors ?? []).map((c) => `\`${c}\``).join(' ') || '—';
    md += `| \`${e.id}\` ${delivery(e)}<br>${e.summary}${e.audited ? ' *(auditado)*' : ''} | ${methodPath(e)} | ${roles(e.roles)} | ${input} | ${resp} | ${errs} |\n`;
  }
  md += '\n';
}
writeFileSync(`${outDir}/endpoints.md`, md);

// ---- Campos de las listas clave ----
const FIELD_VIEWS: { id: string; title: string; pick?: 'items' }[] = [
  { id: 'listMissions', title: 'Lista de misiones (personal)', pick: 'items' },
  { id: 'getMission', title: 'Detalle de misión (personal)' },
  { id: 'listParticipations', title: 'Bandeja de voluntarios y participantes', pick: 'items' },
  { id: 'getParticipationCard', title: 'Ficha del voluntario' },
  { id: 'listRescuers', title: 'Selector de rescatistas', pick: 'items' },
  { id: 'listTeams', title: 'Lista de equipos', pick: 'items' },
  { id: 'listRoutes', title: 'Biblioteca de rutas', pick: 'items' },
  { id: 'listMissionRoutes', title: 'Rutas de la misión (coordinador)', pick: 'items' },
  { id: 'listMyMissions', title: 'Mis misiones (rescatista)', pick: 'items' },
  { id: 'getMyMission', title: 'Detalle de misión (rescatista)' },
  { id: 'listMyMissionRoutes', title: 'Rutas de la misión (rescatista)', pick: 'items' },
  { id: 'getMyProfile', title: 'Mi perfil' },
  { id: 'listSignupRequests', title: 'Solicitudes de alta', pick: 'items' },
  { id: 'listUsers', title: 'Usuarios (administrador)', pick: 'items' },
];
let f = '';
for (const v of FIELD_VIEWS) {
  const e = ENDPOINTS.find((x) => x.id === v.id)!;
  let js = toJson(e.response.schema!, 'output');
  if (v.pick === 'items') js = js.properties.items.items;
  const rows = flatten(js, '', 2);
  f += `#### ${v.title}\n\n\`${e.method} ${e.path}\` · ${roles(e.roles)}\n\n| Campo | Tipo | Notas |\n|---|---|---|\n`;
  for (const r of rows) f += `| \`${r.path}\` | ${r.type}${r.required ? '' : ' (opcional)'} | ${r.note} |\n`;
  f += '\n';
}
writeFileSync(`${outDir}/fields.md`, f);

// ---- Errores ----
const byStatus = new Map<number, string[]>();
for (const c of ERROR_CODES) byStatus.set(ERROR_HTTP[c], [...(byStatus.get(ERROR_HTTP[c]) ?? []), c]);
let er = '| HTTP | Código |\n|---|---|\n';
for (const [s, cs] of [...byStatus].sort((a, b) => a[0] - b[0])) er += `| ${s} | ${cs.map((c) => `\`${c}\``).join(' ')} |\n`;
writeFileSync(`${outDir}/errors.md`, er);

const n = ENDPOINTS.length;
console.log(
  `porHito=${MILESTONES.map((m) => `${m}:${ENDPOINTS.filter((e) => e.milestone === m).length}`).join(' ')}\nendpoints=${n} primera=${ENDPOINTS.filter((e) => e.delivery === 1).length} segunda=${ENDPOINTS.filter((e) => e.delivery === 2).length} pendiente=${ENDPOINTS.filter((e) => e.delivery === 'pendiente').length}`,
);
console.log(`implícitos ejemplo (login): ${implicitErrors(ENDPOINTS.find((e) => e.id === 'login')!).join(' ')}`);
void allErrors;

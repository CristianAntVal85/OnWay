// Formulario del alta y de «Corregir mis datos» (RF-807). Sin reglas propias: cada campo se comprueba con el esquema del contrato que
// aplica el servidor (`Phone`, `DocumentInput`, `Address`, `UpdateMyProfileRequest`). Módulo puro: sin React ni red.
import { ApiError } from '@onway/contracts/client';
import { Address, DocumentInput, Phone, UpdateMyProfileRequest, isValidDocument, type DocumentTypeValue } from '@onway/contracts';

export const PROFILE_FIELDS = ['fullName', 'phone', 'documentType', 'documentNumber', 'street', 'number', 'floor', 'postalCode', 'locality', 'province', 'country'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileValues = Record<ProfileField, string>;

export type ProfileProblem = 'required' | 'invalid' | 'tooLong' | 'invalidDocument' | 'documentTaken' | 'phone';
export type ProfileProblems = Partial<Record<ProfileField, ProfileProblem>>;

export const DOCUMENT_TYPES: readonly DocumentTypeValue[] = ['dni', 'nie', 'passport', 'other'];
/** Países que se ofrecen en la dirección: zona fronteriza del Pirineo (doc 01, RF-807). */
export const COUNTRIES = ['ES', 'FR', 'AD', 'PT'] as const;

export const EMPTY_PROFILE: ProfileValues = {
  fullName: '',
  phone: '',
  documentType: 'dni',
  documentNumber: '',
  street: '',
  number: '',
  floor: '',
  postalCode: '',
  locality: '',
  province: '',
  country: 'ES',
};

const ADDRESS_FIELDS: Record<'street' | 'number' | 'floor' | 'postalCode' | 'locality' | 'province' | 'country', keyof AddressValue> = {
  street: 'street',
  number: 'number',
  floor: 'floor',
  postalCode: 'postalCode',
  locality: 'locality',
  province: 'province',
  country: 'country',
};
type AddressValue = { street: string; number: string; floor?: string; postalCode: string; locality: string; province: string; country: string };

function issue(code: string | undefined): ProfileProblem {
  return code === 'too_big' ? 'tooLong' : 'invalid';
}

export function profileProblems(v: ProfileValues): ProfileProblems {
  const out: ProfileProblems = {};
  const name = UpdateMyProfileRequest.safeParse({ fullName: v.fullName });
  if (!v.fullName.trim()) out.fullName = 'required';
  else if (!name.success) out.fullName = issue(name.error.issues[0]?.code);

  if (!v.phone.trim()) out.phone = 'required';
  else if (!Phone.safeParse(v.phone).success) out.phone = 'phone';

  if (!v.documentNumber.trim()) out.documentNumber = 'required';
  else if (!isValidDocument(v.documentType as DocumentTypeValue, v.documentNumber) || !DocumentInput.safeParse(documentOf(v)).success) out.documentNumber = 'invalidDocument';

  const address = Address.safeParse(addressOf(v));
  if (!address.success) {
    for (const problem of address.error.issues) {
      const field = (Object.keys(ADDRESS_FIELDS) as (keyof typeof ADDRESS_FIELDS)[]).find((f) => ADDRESS_FIELDS[f] === problem.path[0]);
      if (field && !out[field]) out[field] = v[field].trim() ? issue(problem.code) : 'required';
    }
  }
  return out;
}

export const documentOf = (v: ProfileValues) => ({ type: v.documentType as DocumentTypeValue, number: v.documentNumber.trim() });

export function addressOf(v: ProfileValues): AddressValue {
  return {
    street: v.street.trim(),
    number: v.number.trim(),
    ...(v.floor.trim() ? { floor: v.floor.trim() } : {}),
    postalCode: v.postalCode.trim(),
    locality: v.locality.trim(),
    province: v.province.trim(),
    country: v.country,
  };
}

/** Valores del formulario a partir de lo guardado (al corregir): el nombre del perfil y los datos sensibles pedidos en claro. */
export function valuesFrom(
  profile: { fullName: string; phone: string | null },
  sensitive: { document: { type: DocumentTypeValue; number: string } | null; address: AddressValue | null } | null,
): ProfileValues {
  const address = sensitive?.address;
  return {
    ...EMPTY_PROFILE,
    fullName: profile.fullName,
    phone: profile.phone ?? '',
    documentType: sensitive?.document?.type ?? 'dni',
    documentNumber: sensitive?.document?.number ?? '',
    street: address?.street ?? '',
    number: address?.number ?? '',
    floor: address?.floor ?? '',
    postalCode: address?.postalCode ?? '',
    locality: address?.locality ?? '',
    province: address?.province ?? '',
    country: address?.country ?? 'ES',
  };
}

/**
 * Cuerpo de `updateMyProfile`: solo los bloques que cambiaron respecto a lo guardado (la auditoría dice qué bloques se tocaron, D-P4). En
 * el alta, `initial` es el formulario vacío y van todos.
 */
export function changesOf(v: ProfileValues, initial: ProfileValues) {
  const changed = (fields: readonly ProfileField[]) => fields.some((f) => v[f].trim() !== initial[f].trim());
  return {
    ...(changed(['fullName']) ? { fullName: v.fullName.trim() } : {}),
    ...(changed(['phone']) ? { phone: v.phone.trim() } : {}),
    ...(changed(['documentType', 'documentNumber']) ? { document: documentOf(v) } : {}),
    ...(changed(['street', 'number', 'floor', 'postalCode', 'locality', 'province', 'country']) ? { address: addressOf(v) } : {}),
  };
}

const SERVER_FIELDS: Readonly<Record<string, ProfileField>> = {
  fullName: 'fullName',
  phone: 'phone',
  'document.type': 'documentType',
  'document.number': 'documentNumber',
  document: 'documentNumber',
  'address.street': 'street',
  'address.number': 'number',
  'address.floor': 'floor',
  'address.postalCode': 'postalCode',
  'address.locality': 'locality',
  'address.province': 'province',
  'address.country': 'country',
  address: 'street',
};

/** Errores del servidor en su campo: documento no válido o ya registrado (sin decir de quién, INV-24) y los de `VALIDATION_FAILED`. */
export function serverProfileProblems(error: unknown): ProfileProblems {
  if (!(error instanceof ApiError)) return {};
  if (error.code === 'DOCUMENT_ALREADY_REGISTERED') return { documentNumber: 'documentTaken' };
  if (error.code === 'INVALID_DOCUMENT') return { documentNumber: 'invalidDocument' };
  if (error.code !== 'VALIDATION_FAILED') return {};
  const issues = error.details?.['issues'];
  if (!Array.isArray(issues)) return {};
  const out: ProfileProblems = {};
  for (const item of issues as { path?: unknown; code?: unknown }[]) {
    const field = typeof item.path === 'string' ? SERVER_FIELDS[item.path] : undefined;
    if (field && !out[field]) out[field] = item.code === 'required' ? 'required' : issue(typeof item.code === 'string' ? item.code : undefined);
  }
  return out;
}

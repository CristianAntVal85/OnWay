import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import { SkillInput } from '@onway/contracts';
import { Dialog } from '../components/dialog';
import { TextField } from '../components/text-field';
import { errorMessage } from '../i18n/error-message';
import { fileFailureMessage, MAX_UPLOAD_BYTES } from '../library/upload';
import { uploadCertificate, useCreateSkill, useUpdateSkill, type SkillChanges, type SkillCreate } from './skills';
import { useApi } from '../session/api-context';

type Skill = OperationOutput<'listMySkills'>['items'][number];
type Field = 'name' | 'issuer' | 'issuedOn' | 'expiresOn' | 'certificate';
type Problems = Partial<Record<Field, string>>;

interface Props {
  /** La entrada que se edita; sin ella, se añade una nueva. */
  skill?: Skill;
  /** Abrir desde «Adjuntar»: el foco empieza en el campo del archivo. */
  focusFile?: boolean;
  onClose: () => void;
  /** Guardada la entrada (con el certificado que lleva ahora). */
  onSaved: (skill: Skill) => void;
}

const FIELD_ORDER: Field[] = ['name', 'issuer', 'issuedOn', 'expiresOn', 'certificate'];

/**
 * Diálogo para añadir o editar un curso o una habilidad (RF-808, D-29). Se valida con `SkillInput`, el esquema del contrato. El certificado solo
 * se ofrece en un curso: primero se sube el archivo y, si sale bien, se guarda la entrada con su id; un error del archivo se ve en su campo y
 * la entrada no se guarda. En una edición se puede conservar, cambiar o quitar el certificado. El foco vuelve al botón que lo abrió (`Dialog`).
 */
export function SkillDialog({ skill, focusFile = false, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const [values, setValues] = useState({
    name: skill?.name ?? '',
    kind: skill?.kind ?? 'course',
    issuer: skill?.issuer ?? '',
    issuedOn: skill?.issuedOn ?? '',
    expiresOn: skill?.expiresOn ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeCertificate, setRemoveCertificate] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);
  // Un archivo ya subido cuya entrada no se pudo guardar: al reintentar se reutiliza en vez de subirlo otra vez.
  const uploaded = useRef<{ file: File; id: string } | null>(null);

  const editing = skill !== undefined;
  const isCourse = values.kind === 'course';
  const hadCertificate = Boolean(skill?.hasCertificate) && !removeCertificate;
  const set = (field: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };
  const ref = (field: Field) => (element: HTMLInputElement | null) => {
    refs.current[field] = element;
  };
  const focusFirst = (found: Problems) => {
    const field = FIELD_ORDER.find((name) => found[name]);
    if (field) refs.current[field]?.focus();
    else alert.current?.focus();
  };

  const fromClient = (): Problems => {
    const found: Problems = {};
    const parsed = SkillInput.safeParse({
      name: values.name,
      kind: values.kind,
      ...(values.issuer.trim() ? { issuer: values.issuer } : {}),
      ...(values.issuedOn ? { issuedOn: values.issuedOn } : {}),
      ...(values.expiresOn ? { expiresOn: values.expiresOn } : {}),
    });
    if (!parsed.success) {
      for (const item of parsed.error.issues) {
        const path = item.path[0];
        if (path === 'name' && !found.name) found.name = t('profile.skills.errors.name');
        else if (path === 'issuer' && !found.issuer) found.issuer = t('profile.skills.errors.issuer');
        else if ((path === 'issuedOn' || path === 'expiresOn') && !found[path]) {
          found[path] = item.code === 'custom' ? t('profile.skills.errors.expiresBeforeIssued') : t('profile.skills.errors.date');
        }
      }
    }
    if (file && file.size > MAX_UPLOAD_BYTES) found.certificate = t('errors.FILE_TOO_LARGE');
    return found;
  };

  const fromServer = (error: unknown): Problems => {
    if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return {};
    const issues = error.details?.['issues'];
    if (!Array.isArray(issues)) return {};
    const found: Problems = {};
    for (const item of issues as { path?: unknown }[]) {
      const path = item.path;
      const field: Field | undefined = path === 'certificateFileId' ? 'certificate' : path === 'name' || path === 'issuer' || path === 'issuedOn' || path === 'expiresOn' ? path : undefined;
      if (field && !found[field]) found[field] = errorMessage(t, error);
    }
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    const found = fromClient();
    setProblems(found);
    if (Object.keys(found).length > 0) return focusFirst(found);
    setBusy(true);
    try {
      let certificateFileId: string | undefined;
      if (isCourse && file) {
        if (uploaded.current?.file === file) certificateFileId = uploaded.current.id;
        else {
          try {
            certificateFileId = (await uploadCertificate(api, file)).id;
            uploaded.current = { file, id: certificateFileId };
          } catch (error) {
            const next = { certificate: fileFailureMessage(t, error) };
            setProblems(next);
            return focusFirst(next);
          }
        }
      }
      try {
        const saved = editing ? await update.mutateAsync({ skillId: skill.id, body: changesOf(certificateFileId) }) : await create.mutateAsync(createBody(certificateFileId));
        onSaved(saved);
      } catch (error) {
        const next = fromServer(error);
        setProblems(next);
        if (Object.keys(next).length > 0) focusFirst(next);
        else {
          setFailure(errorMessage(t, error));
          alert.current?.focus();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const createBody = (certificateFileId: string | undefined): SkillCreate => ({
    name: values.name,
    kind: values.kind,
    ...(values.issuer.trim() ? { issuer: values.issuer } : {}),
    ...(values.issuedOn ? { issuedOn: values.issuedOn } : {}),
    ...(values.expiresOn ? { expiresOn: values.expiresOn } : {}),
    ...(certificateFileId ? { certificateFileId } : {}),
  });

  /** Solo lo que cambió. Una fecha ya guardada no se puede vaciar (el contrato no admite `null`); el resto, sí. */
  const changesOf = (certificateFileId: string | undefined): SkillChanges => {
    const body: SkillChanges = {};
    if (values.name !== skill?.name) body.name = values.name;
    if (values.issuer.trim() !== (skill?.issuer ?? '')) body.issuer = values.issuer;
    if (values.issuedOn && values.issuedOn !== skill?.issuedOn) body.issuedOn = values.issuedOn;
    if (values.expiresOn && values.expiresOn !== skill?.expiresOn) body.expiresOn = values.expiresOn;
    if (certificateFileId) body.certificateFileId = certificateFileId;
    else if (removeCertificate) body.certificateFileId = null;
    return body;
  };

  const certificateError = problems.certificate;
  return (
    <Dialog title={t(editing ? 'profile.skills.editTitle' : 'profile.skills.addTitle')} onClose={() => !busy && onClose()}>
      <form className="skill-form" onSubmit={(event) => void submit(event)} noValidate>
        <TextField
          id="skill-name"
          name="name"
          type="text"
          label={t('profile.skills.fields.name')}
          inputRef={ref('name')}
          value={values.name}
          onChange={set('name')}
          error={problems.name}
          aria-required="true"
          data-autofocus={focusFile ? undefined : ''}
          autoComplete="off"
        />
        <div className="field">
          <div className="field-label">
            <label htmlFor="skill-kind">{t('profile.skills.fields.kind')}</label>
          </div>
          <select id="skill-kind" name="kind" value={values.kind} disabled={editing} onChange={set('kind')}>
            <option value="course">{t('profile.skills.kind.course')}</option>
            <option value="skill">{t('profile.skills.kind.skill')}</option>
          </select>
        </div>
        <TextField
          id="skill-issuer"
          name="issuer"
          type="text"
          label={t('profile.skills.fields.issuer')}
          inputRef={ref('issuer')}
          value={values.issuer}
          onChange={set('issuer')}
          error={problems.issuer}
          autoComplete="off"
        />
        <div className="field-row">
          <TextField
            id="skill-issued-on"
            name="issuedOn"
            type="date"
            label={t('profile.skills.fields.issuedOn')}
            inputRef={ref('issuedOn')}
            value={values.issuedOn}
            onChange={set('issuedOn')}
            error={problems.issuedOn}
          />
          <TextField
            id="skill-expires-on"
            name="expiresOn"
            type="date"
            label={t('profile.skills.fields.expiresOn')}
            inputRef={ref('expiresOn')}
            value={values.expiresOn}
            onChange={set('expiresOn')}
            error={problems.expiresOn}
          />
        </div>
        {isCourse && (
          <div className="field">
            <div className="field-label">
              <label htmlFor="skill-certificate">{t(hadCertificate ? 'profile.skills.fields.certificateReplace' : 'profile.skills.fields.certificate')}</label>
            </div>
            <input
              id="skill-certificate"
              ref={ref('certificate')}
              data-autofocus={focusFile ? '' : undefined}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              aria-invalid={Boolean(certificateError)}
              aria-describedby={certificateError ? 'skill-certificate-error' : undefined}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setProblems((current) => ({ ...current, certificate: undefined }));
              }}
            />
            {certificateError && (
              <p id="skill-certificate-error" className="field-error">
                {certificateError}
              </p>
            )}
            {skill?.hasCertificate && (
              <div className="skill-certificate-current">
                <p className="form-note">{removeCertificate ? t('profile.skills.certificateWillRemove') : t('profile.skills.certificateCurrent')}</p>
                <button type="button" className="button button-secondary" onClick={() => setRemoveCertificate((current) => !current)}>
                  {t(removeCertificate ? 'profile.skills.keepCertificate' : 'profile.skills.removeCertificate')}
                </button>
              </div>
            )}
          </div>
        )}
        <div role="alert" className="form-alert" ref={alert} tabIndex={-1}>
          {failure && <p>{failure}</p>}
        </div>
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" aria-disabled={busy}>
            {busy ? t('profile.skills.saving') : t('profile.skills.save')}
          </button>
          <button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>
            {t('profile.skills.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

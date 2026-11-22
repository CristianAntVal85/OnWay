import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { SectionCard } from '../components/section-card';
import { ErrorState, LoadingState } from '../components/states';
import { errorMessage } from '../i18n/error-message';
import { formatDate } from '../missions/format';
import { SkillDialog } from './skill-dialog';
import { PopupBlockedError, useDeleteSkill, useMySkills, useOpenCertificate } from './skills';

type Skill = OperationOutput<'listMySkills'>['items'][number];

/** Una fecha sin hora («2026-03-01») se escribe como la del idioma, sin pasarla por la zona horaria. */
const dateOnly = (value: string, locale: string) => formatDate(`${value}T12:00:00Z`, locale);

/**
 * «Cursos y habilidades» de Mi perfil (RF-808, doc 02 §3.9): la lista con su estado de carga, vacío y error, y la columna del certificado.
 * Un curso con certificado lleva «adjunto»; una habilidad no lo admite y un curso sin certificado lo dice. Eliminar pide confirmación y,
 * hecho, el foco vuelve a la sección (el botón que lo abrió ya no existe).
 */
export function SkillsSection() {
  const { t } = useTranslation();
  const skills = useMySkills();
  const remove = useDeleteSkill();
  const open = useOpenCertificate();
  const [removing, setRemoving] = useState<Skill | null>(null);
  const [editing, setEditing] = useState<{ skill?: Skill; focusFile: boolean } | null>(null);
  const [notice, setNotice] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const section = useRef<HTMLDivElement>(null);
  // Cuando quien abrió un diálogo desaparece (la entrada eliminada, el botón «Adjuntar» ya sin sentido), el foco pasa a la sección.
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    if (focusTick > 0) section.current?.focus();
  }, [focusTick]);

  const openCertificate = (skill: Skill) => {
    setNotice('');
    setOpeningId(skill.id);
    open.mutate(skill.id, {
      onError: (error) => setNotice(error instanceof PopupBlockedError ? t('profile.skills.popupBlocked') : t('profile.skills.openFailed')),
      onSettled: () => setOpeningId(null),
    });
  };

  const close = () => {
    if (remove.isPending) return;
    remove.reset();
    setRemoving(null);
  };

  const confirm = () => {
    if (!removing || remove.isPending) return;
    remove.mutate(removing.id, {
      onSuccess: () => {
        setNotice(t('profile.skills.removed'));
        setRemoving(null);
        setFocusTick((tick) => tick + 1);
      },
    });
  };

  return (
    <SectionCard
      title={t('profile.skills.title')}
      icon="document"
      actions={
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setNotice('');
            setEditing({ focusFile: false });
          }}
        >
          {t('profile.skills.add')}
        </button>
      }
    >
      <div ref={section} className="skills-section" tabIndex={-1}>
        <div role="status" className="notice-slot">
          {notice && <p className="notice">{notice}</p>}
        </div>
        {skills.isPending && <LoadingState />}
        {skills.isError && <ErrorState error={skills.error} onRetry={() => void skills.refetch()} />}
        {skills.data && skills.data.items.length === 0 && <p className="form-note">{t('profile.skills.empty')}</p>}
        {skills.data && skills.data.items.length > 0 && (
          <ul className="skill-list">
            {skills.data.items.map((skill) => (
              <SkillItem
                key={skill.id}
                skill={skill}
                opening={openingId === skill.id}
                onOpen={() => openCertificate(skill)}
                onEdit={(focusFile) => {
                  setNotice('');
                  setEditing({ skill, focusFile });
                }}
                onRemove={() => {
                  setNotice('');
                  setRemoving(skill);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <SkillDialog
          skill={editing.skill}
          focusFile={editing.focusFile}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setNotice(t('profile.skills.saved'));
            setEditing(null);
            // «Adjuntar» desaparece al guardar el certificado: el foco no puede volver a ese botón.
            if (editing.focusFile) setFocusTick((tick) => tick + 1);
          }}
        />
      )}
      {removing && (
        <Dialog
          title={t('profile.skills.removeTitle', { name: removing.name })}
          description={<p>{removing.hasCertificate ? t('profile.skills.removeWithCertificate') : t('profile.skills.removeWithoutCertificate')}</p>}
          onClose={close}
        >
          {remove.isError && (
            <p className="field-error" role="alert">
              {errorMessage(t, remove.error)}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button button-primary" disabled={remove.isPending} onClick={confirm}>
              {remove.isPending ? t('profile.skills.removing') : t('profile.skills.removeConfirm')}
            </button>
            <button type="button" className="button button-secondary" data-autofocus disabled={remove.isPending} onClick={close}>
              {t('profile.skills.removeCancel')}
            </button>
          </div>
        </Dialog>
      )}
    </SectionCard>
  );
}

function SkillItem({ skill, opening, onOpen, onEdit, onRemove }: { skill: Skill; opening: boolean; onOpen: () => void; onEdit: (focusFile: boolean) => void; onRemove: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  return (
    <li className="skill-item">
      <div className="skill-main">
        <p className="skill-name">{skill.name}</p>
        <p className="skill-meta">
          <span className="skill-kind">{t(`profile.skills.kind.${skill.kind}`)}</span>
          {skill.issuer && <span>{t('profile.skills.issuer', { issuer: skill.issuer })}</span>}
          {skill.issuedOn && <span>{t('profile.skills.issuedOn', { date: dateOnly(skill.issuedOn, locale) })}</span>}
          {skill.expiresOn && <span>{t('profile.skills.expiresOn', { date: dateOnly(skill.expiresOn, locale) })}</span>}
        </p>
        {skill.kind === 'course' && (
          <p className="skill-certificate">
            {skill.hasCertificate ? (
              <>
                <span aria-hidden="true">📎 </span>
                {t('profile.skills.attached')}
              </>
            ) : (
              <button type="button" className="button button-secondary" aria-label={t('profile.skills.attachFor', { name: skill.name })} onClick={() => onEdit(true)}>
                {t('profile.skills.attach')}
              </button>
            )}
          </p>
        )}
      </div>
      <div className="point-row-actions">
        {skill.hasCertificate && (
          <button type="button" className="button button-secondary" aria-label={t('profile.skills.openFor', { name: skill.name })} disabled={opening} onClick={onOpen}>
            {t('profile.skills.openCertificate')}
          </button>
        )}
        <button type="button" className="button button-secondary" aria-label={t('profile.skills.editFor', { name: skill.name })} onClick={() => onEdit(false)}>
          {t('profile.skills.edit')}
        </button>
        <button type="button" className="button button-secondary" aria-label={t('profile.skills.removeFor', { name: skill.name })} onClick={onRemove}>
          {t('profile.skills.remove')}
        </button>
      </div>
    </li>
  );
}

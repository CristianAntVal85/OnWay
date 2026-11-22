import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import { PageHeader } from '../components/page-header';
import { SectionCard } from '../components/section-card';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { formatDate, formatDateTime } from '../missions/format';
import { PATHS } from '../nav/navigation';
import { PopupBlockedError, useOpenCertificate } from '../profile/skills';
import { useUser } from './queries';
import { ChangeRoleDialog, DisableDialog, ReactivateDialog, type Role } from './user-dialogs';
import { ROLE_LABEL } from './users-section';

type Skill = OperationOutput<'getUser'>['skills'][number];

/** Una fecha sin hora («2026-03-01») se escribe como la del idioma, sin pasarla por la zona horaria. */
const dateOnly = (value: string, locale: string) => formatDate(`${value}T12:00:00Z`, locale);

/**
 * Ficha de una persona de la organización (RF-813, RF-808, D-U7, doc 06 §7.1): contacto, rol y estado, cursos y habilidades con su
 * certificado, y equipos en solo lectura. No hay documento ni dirección: esos datos solo salen por la lectura auditada (H6). «Abrir
 * certificado» queda registrado en la auditoría (INV-26). La vuelta a la lista conserva sus filtros (`state.from`, la búsqueda de la dirección).
 */
export function UserPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const { userId = '' } = useParams();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '';
  const back = { to: `${PATHS.admin}${from}`, label: t('admin.user.back') };
  const person = useUser(userId);
  const open = useOpenCertificate();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<'role' | 'disable' | 'reactivate' | null>(null);
  const [done, setDone] = useState('');
  const [focusDone, setFocusDone] = useState(0);
  const doneRef = useRef<HTMLParagraphElement>(null);
  usePageTitle(person.data?.displayName ?? t('admin.users.title'));

  // Desactivar o reactivar cambia el botón que abrió el diálogo y ya no existe: el foco pasa al aviso del resultado.
  useEffect(() => {
    if (focusDone > 0) doneRef.current?.focus();
  }, [focusDone]);

  if (person.isPending) return <LoadingState label={t('admin.user.loading')} />;
  if (person.isError) {
    const notFound = person.error instanceof ApiError && person.error.code === 'NOT_FOUND';
    return (
      <>
        <p>
          <Link className="page-back" to={back.to}>
            {back.label}
          </Link>
        </p>
        {notFound ? (
          <section className="state state-empty" role="alert">
            <h1>{t('admin.user.notFound')}</h1>
          </section>
        ) : (
          <ErrorState error={person.error} onRetry={() => void person.refetch()} />
        )}
      </>
    );
  }
  const data = person.data;
  const target = { id: data.userId, name: data.displayName, role: data.role, openMissions: data.hasMissionsAsResponsible };

  const openCertificate = (skill: Skill) => {
    setNotice('');
    setOpeningId(skill.id);
    open.mutate(skill.id, {
      onError: (error) => setNotice(error instanceof PopupBlockedError ? t('profile.skills.popupBlocked') : t('profile.skills.openFailed')),
      onSettled: () => setOpeningId(null),
    });
  };

  return (
    <>
      <PageHeader
        title={data.displayName}
        icon="user"
        back={back}
        badges={
          <>
            <span className="status-badge">{t(ROLE_LABEL[data.role])}</span>
            <span className="status-badge" data-signup={data.accountStatus === 'disabled' ? 'rejected' : 'approved'}>
              {t(`admin.users.status.${data.accountStatus}`)}
            </span>
          </>
        }
      />
      <div className="user-sections">
        <SectionCard title={t('admin.user.contact')} icon="user">
          <dl className="facts-grid">
            <div>
              <dt>{t('admin.user.email')}</dt>
              <dd>{data.email}</dd>
            </div>
            <div>
              <dt>{t('admin.user.phone')}</dt>
              <dd>{data.phone ?? t('admin.user.noPhone')}</dd>
            </div>
            <div>
              <dt>{t('admin.user.role')}</dt>
              <dd>{t(ROLE_LABEL[data.role])}</dd>
            </div>
            <div>
              <dt>{t('admin.user.status')}</dt>
              <dd>{t(`admin.users.status.${data.accountStatus}`)}</dd>
            </div>
            <div>
              <dt>{t('admin.user.lastLogin')}</dt>
              <dd>{data.lastLoginAt ? formatDateTime(data.lastLoginAt, locale) : t('admin.user.neverLoggedIn')}</dd>
            </div>
            <div>
              <dt>{t('admin.user.createdAt')}</dt>
              <dd>{formatDateTime(data.createdAt, locale)}</dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard title={t('admin.user.manage')} icon="shield">
          <p ref={doneRef} className="notice" role="status" tabIndex={-1} hidden={!done}>
            {done}
          </p>
          <div className="point-row-actions">
            <button type="button" className="button button-secondary" onClick={() => setDialog('role')}>
              {t('admin.user.changeRole')}
            </button>
            {data.accountStatus === 'active' ? (
              <button type="button" className="button button-secondary" onClick={() => setDialog('disable')}>
                {t('admin.user.disable')}
              </button>
            ) : (
              <button type="button" className="button button-secondary" onClick={() => setDialog('reactivate')}>
                {t('admin.user.reactivate')}
              </button>
            )}
          </div>
        </SectionCard>

        <SectionCard title={t('admin.user.skills')} icon="document">
          <div role="status" className="notice-slot">
            {notice && <p className="notice">{notice}</p>}
          </div>
          {data.skills.length === 0 ? (
            <p className="form-note">{t('admin.user.noSkills')}</p>
          ) : (
            <>
              <p className="form-note">{t('admin.user.certificateNotice')}</p>
              <ul className="skill-list">
                {data.skills.map((skill) => (
                  <li key={skill.id} className="skill-item">
                    <div className="skill-main">
                      <p className="skill-name">{skill.name}</p>
                      <p className="skill-meta">
                        <span className="skill-kind">{t(`profile.skills.kind.${skill.kind}`)}</span>
                        {skill.issuer && <span>{t('profile.skills.issuer', { issuer: skill.issuer })}</span>}
                        {skill.issuedOn && <span>{t('profile.skills.issuedOn', { date: dateOnly(skill.issuedOn, locale) })}</span>}
                        {skill.expiresOn && <span>{t('profile.skills.expiresOn', { date: dateOnly(skill.expiresOn, locale) })}</span>}
                      </p>
                    </div>
                    {skill.hasCertificate && (
                      <div className="point-row-actions">
                        <button
                          type="button"
                          className="button button-secondary"
                          aria-label={t('profile.skills.openFor', { name: skill.name })}
                          disabled={openingId === skill.id}
                          onClick={() => openCertificate(skill)}
                        >
                          {t('profile.skills.openCertificate')}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard title={t('admin.user.teams')} icon="team">
          {data.teams.length === 0 ? (
            <p className="form-note">{t('admin.user.noTeams')}</p>
          ) : (
            <ul className="user-teams">
              {data.teams.map((team) => (
                <li key={team.id}>{t('admin.user.locality', { name: team.name, locality: team.locality })}</li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {dialog === 'role' && (
        <ChangeRoleDialog
          target={target}
          onClose={() => setDialog(null)}
          onDone={(role: Role) => {
            setDialog(null);
            setDone(t('admin.user.done.roleChanged', { role: t(ROLE_LABEL[role]) }));
          }}
        />
      )}
      {dialog === 'disable' && (
        <DisableDialog
          target={target}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setDone(t('admin.user.done.disabled'));
            setFocusDone((n) => n + 1);
          }}
        />
      )}
      {dialog === 'reactivate' && (
        <ReactivateDialog
          target={target}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setDone(t('admin.user.done.reactivated'));
            setFocusDone((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

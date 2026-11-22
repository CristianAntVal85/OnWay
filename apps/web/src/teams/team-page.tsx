import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { ApiError } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { PageHeader } from '../components/page-header';
import { SectionCard } from '../components/section-card';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { errorMessage } from '../i18n/error-message';
import { formatDateTime } from '../missions/format';
import { PATHS } from '../nav/navigation';
import { AddMembersDialog } from './add-members-dialog';
import { useRemoveMember, useTeam, useUpdateTeam } from './queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Dialogs = { kind: 'add' } | { kind: 'archive' } | { kind: 'remove'; id: string; name: string };

/**
 * Detalle del equipo (RF-801, doc 02 §3.8): nombre, localidad y código, y los miembros (solo nombres: RN-21) con «Quitar» y «Añadir miembros»,
 * y archivar o reactivar, cada acción con su confirmación. Un equipo archivado conserva sus miembros pero no admite nuevos (D-E5). El foco vuelve
 * al botón que abrió el diálogo; tras quitar a alguien, ese botón ya no existe y pasa al título de los miembros.
 */
export function TeamPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const { teamId = '' } = useParams();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '';
  const validId = UUID.test(teamId);
  const team = useTeam(teamId, validId);
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [done, setDone] = useState('');
  const [focusMembers, setFocusMembers] = useState(0);
  const membersRef = useRef<HTMLDivElement>(null);
  usePageTitle(team.data?.name ?? t('teams.title'));

  useEffect(() => {
    if (focusMembers === 0) return;
    const heading = membersRef.current?.querySelector('h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }, [focusMembers]);

  const back = { to: `${PATHS.teams}${from}`, label: t('teams.detail.back') };

  if (validId && team.isPending) return <LoadingState label={t('teams.detail.loading')} />;
  if (!validId || team.isError) {
    const notFound = !validId || (team.error instanceof ApiError && team.error.code === 'NOT_FOUND');
    return (
      <>
        <p>
          <Link className="page-back" to={back.to}>
            {back.label}
          </Link>
        </p>
        {notFound ? (
          <section className="state state-empty" role="alert">
            <h1>{t('teams.detail.notFound')}</h1>
          </section>
        ) : (
          <ErrorState error={team.error!} onRetry={() => void team.refetch()} />
        )}
      </>
    );
  }
  const data = team.data!;
  const archived = data.status === 'archived';
  const memberIds = new Set(data.members.map((member) => member.id));

  return (
    <>
      <PageHeader
        title={data.name}
        icon="team"
        back={back}
        subtitle={t('teams.row.locality', { locality: data.locality, code: data.code })}
        badges={
          <span className="status-badge" data-signup={archived ? 'rejected' : 'approved'}>
            {t(`teams.status.${data.status}`)}
          </span>
        }
      />
      <div className="user-sections">
        <div ref={membersRef}>
          <SectionCard
            title={t('teams.detail.members')}
            icon="team"
            actions={
              !archived && (
                <button type="button" className="button button-primary" onClick={() => setDialog({ kind: 'add' })}>
                  {t('teams.detail.addMembers')}
                </button>
              )
            }
          >
            <div role="status" className="notice-slot">
              {done && <p className="notice">{done}</p>}
            </div>
            {archived && <p className="form-note">{t('teams.detail.archivedNote')}</p>}
            {data.members.length === 0 ? (
              <p className="form-note">{t('teams.detail.noMembers')}</p>
            ) : (
              <ul className="signup-list">
                {data.members.map((member) => (
                  <li key={member.id} className="signup-row">
                    <div className="signup-info">
                      <span className="signup-name">{member.displayName}</span>
                    </div>
                    <div className="user-badges">
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-label={t('teams.detail.removeLabel', { name: member.displayName })}
                        onClick={() => {
                          setDone('');
                          setDialog({ kind: 'remove', id: member.id, name: member.displayName });
                        }}
                      >
                        {t('teams.detail.remove')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <SectionCard title={t('teams.detail.manage')} icon="shield">
          <dl className="facts-grid">
            <div>
              <dt>{t('teams.detail.createdAt')}</dt>
              <dd>{formatDateTime(data.createdAt, locale)}</dd>
            </div>
          </dl>
          <div className="point-row-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setDone('');
                setDialog({ kind: 'archive' });
              }}
            >
              {archived ? t('teams.detail.reactivate') : t('teams.detail.archive')}
            </button>
          </div>
        </SectionCard>
      </div>

      {dialog?.kind === 'add' && (
        <AddMembersDialog
          teamId={teamId}
          teamName={data.name}
          memberIds={memberIds}
          onClose={() => setDialog(null)}
          onDone={(count) => {
            setDialog(null);
            setDone(t('teams.detail.done.added', { count }));
          }}
        />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveDialog
          teamId={teamId}
          person={dialog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setDone(t('teams.detail.done.removed', { name: dialog.name }));
            setFocusMembers((n) => n + 1);
          }}
        />
      )}
      {dialog?.kind === 'archive' && (
        <ArchiveDialog
          teamId={teamId}
          name={data.name}
          archived={archived}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setDone(t(archived ? 'teams.detail.done.reactivated' : 'teams.detail.done.archived'));
          }}
        />
      )}
    </>
  );
}

function Actions({ pending, confirmLabel, onConfirm, onClose }: { pending: boolean; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="dialog-actions">
      <button type="button" className="button button-primary" disabled={pending} onClick={onConfirm}>
        {pending ? t('teams.detail.working') : confirmLabel}
      </button>
      {/* El foco empieza en «Cancelar»: un Intro sin pensar no quita ni archiva nada. */}
      <button type="button" className="button button-secondary" data-autofocus="" disabled={pending} onClick={onClose}>
        {t('teams.detail.cancel')}
      </button>
    </div>
  );
}

function RemoveDialog({ teamId, person, onClose, onDone }: { teamId: string; person: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const remove = useRemoveMember(teamId);
  return (
    <Dialog title={t('teams.detail.removeDialog.title', { name: person.name })} description={<p>{t('teams.detail.removeDialog.description')}</p>} onClose={() => !remove.isPending && onClose()}>
      {remove.isError && (
        <p className="field-error" role="alert">
          {errorMessage(t, remove.error)}
        </p>
      )}
      <Actions
        pending={remove.isPending}
        confirmLabel={t('teams.detail.removeDialog.confirm')}
        onConfirm={() => !remove.isPending && remove.mutate(person.id, { onSuccess: onDone })}
        onClose={onClose}
      />
    </Dialog>
  );
}

function ArchiveDialog({ teamId, name, archived, onClose, onDone }: { teamId: string; name: string; archived: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateTeam(teamId);
  const T = archived ? 'teams.detail.reactivateDialog' : 'teams.detail.archiveDialog';
  return (
    <Dialog title={t(`${T}.title`, { name })} description={<p>{t(`${T}.description`)}</p>} onClose={() => !update.isPending && onClose()}>
      {update.isError && (
        <p className="field-error" role="alert">
          {errorMessage(t, update.error)}
        </p>
      )}
      <Actions
        pending={update.isPending}
        confirmLabel={t(`${T}.confirm`)}
        onConfirm={() => !update.isPending && update.mutate({ status: archived ? 'active' : 'archived' }, { onSuccess: onDone })}
        onClose={onClose}
      />
    </Dialog>
  );
}

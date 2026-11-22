import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { PageHeader } from '../components/page-header';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { PATHS } from '../nav/navigation';
import { valuesFrom } from '../profile/form';
import { ProfileForm } from '../profile/profile-form';
import { ProfileView } from '../profile/profile-view';
import { useMyProfile, useMySensitive } from '../profile/queries';

/**
 * Alta y Mi perfil del rescatista (RF-806, RF-807, RF-810, doc 02 §3.9). Con el perfil incompleto es el formulario de alta obligatorio
 * (el resto de la app lleva aquí, P1); completo, sus datos con los sensibles ocultos, sus equipos y «Corregir mis datos».
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useMyProfile();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const incomplete = profile.data?.status === 'incomplete';
  usePageTitle(incomplete ? t('profile.completeTitle') : t('profile.title'));

  if (profile.isPending) return <LoadingState />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  const data = profile.data;

  if (incomplete)
    return (
      <>
        <PageHeader icon="user" title={t('profile.completeTitle')} subtitle={t('profile.completeBody')} />
        <ProfileForm
          initial={valuesFrom(data, null)}
          email={data.email}
          // El alta queda completa: la sesión ya se volvió a leer y se abre el resto de la app (Mis misiones).
          onSaved={() => navigate(PATHS.missions, { replace: true })}
        />
      </>
    );

  return (
    <>
      <PageHeader
        icon="user"
        title={editing ? t('profile.editTitle') : t('profile.title')}
        actions={
          !editing && (
            <button type="button" className="button button-secondary" onClick={() => setEditing(true)}>
              {t('profile.edit')}
            </button>
          )
        }
      />
      <div role="status" className="notice-slot">
        {saved && !editing && <p className="notice">{t('profile.saved')}</p>}
      </div>
      {editing ? (
        <EditProfile
          profile={data}
          onDone={(didSave) => {
            setEditing(false);
            setSaved(didSave);
          }}
        />
      ) : (
        <ProfileView profile={data} />
      )}
    </>
  );
}

/** «Corregir mis datos»: el formulario con lo guardado, para lo que se piden documento y dirección en claro (solo la propia persona). */
function EditProfile({ profile, onDone }: { profile: NonNullable<ReturnType<typeof useMyProfile>['data']>; onDone: (saved: boolean) => void }) {
  const sensitive = useMySensitive(true);
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => first.current?.querySelector('input')?.focus(), [sensitive.isSuccess]);
  if (sensitive.isPending) return <LoadingState />;
  if (sensitive.isError) return <ErrorState error={sensitive.error} onRetry={() => void sensitive.refetch()} />;
  return (
    <div ref={first}>
      <ProfileForm initial={valuesFrom(profile, sensitive.data)} email={profile.email} onSaved={() => onDone(true)} onCancel={() => onDone(false)} />
    </div>
  );
}

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
import { SkillsSection } from '../profile/skills-section';

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
  // Al cerrar «Corregir mis datos» el formulario desaparece: el foco vuelve al botón que lo abrió, no al principio de la página.
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);
  const incomplete = profile.data?.status === 'incomplete';
  usePageTitle(incomplete ? t('profile.completeTitle') : t('profile.title'));

  // El alta se acaba de completar: se abre el resto de la app (Mis misiones). Se decide aquí, al ver el cambio, y no en el `onSuccess` del
  // envío: el formulario de alta deja de existir en cuanto el perfil está completo y su callback ya no llegaría.
  const wasIncomplete = useRef(false);
  useEffect(() => {
    if (incomplete) wasIncomplete.current = true;
    else if (wasIncomplete.current && profile.data?.status === 'complete') {
      wasIncomplete.current = false;
      navigate(PATHS.missions, { replace: true });
    }
  }, [incomplete, profile.data?.status, navigate]);

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
          // Al completarse, la vista lleva a Mis misiones por sí misma (arriba).
          onSaved={() => undefined}
        />
        {/* «Se puede completar después» (doc 02 §3.9), pero se puede ya: cursos y habilidades no son obligatorios en el alta. */}
        <SkillsSection />
      </>
    );

  return (
    <>
      <PageHeader
        icon="user"
        title={editing ? t('profile.editTitle') : t('profile.title')}
        actions={
          !editing && (
            <button ref={editButton} type="button" className="button button-secondary" onClick={() => setEditing(true)}>
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
            returnFocus.current = true;
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

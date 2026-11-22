import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { SectionCard } from '../components/section-card';
import { ErrorState, LoadingState } from '../components/states';
import { countryName } from '../i18n/country-name';
import { useMySensitive } from './queries';

type MyProfile = OperationOutput<'getMyProfile'>;

/**
 * Mi perfil tras el alta (boceto 15): contacto y datos sensibles en bloques separados a propósito, los sensibles ocultos hasta que la
 * persona pulsa «Mostrar» (doc 02 §3.9), y sus equipos en solo lectura.
 */
export function ProfileView({ profile }: { profile: MyProfile }) {
  const { t } = useTranslation();
  return (
    <>
      <SectionCard title={t('profile.blocks.contact')} icon="info">
        <dl className="facts">
          <div>
            <dt>{t('profile.fields.fullName')}</dt>
            <dd>{profile.fullName}</dd>
          </div>
          <div>
            <dt>{t('profile.fields.phone')}</dt>
            <dd>{profile.phone}</dd>
          </div>
          <div>
            <dt>{t('profile.fields.email')}</dt>
            <dd>{profile.email}</dd>
          </div>
        </dl>
      </SectionCard>
      <SensitiveBlock profile={profile} />
      <SectionCard title={t('profile.blocks.teams')} icon="team">
        {profile.teams.length === 0 ? (
          <p className="form-note">{t('profile.view.noTeams')}</p>
        ) : (
          <ul className="plain-list">
            {profile.teams.map((team) => (
              <li key={team.id}>{t('profile.view.teamLine', { name: team.name, locality: team.locality })}</li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function SensitiveBlock({ profile }: { profile: MyProfile }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const [shown, setShown] = useState(false);
  const sensitive = useMySensitive(shown);
  const clear = shown && sensitive.data;
  const address = clear ? sensitive.data.address : null;

  const toggle = (
    <button type="button" className="button button-secondary" aria-pressed={shown} onClick={() => setShown(!shown)}>
      {shown ? t('profile.view.hide') : t('profile.view.show')}
    </button>
  );

  return (
    <SectionCard title={t('profile.blocks.sensitive')} icon="shield" actions={toggle}>
      <div role="status" className="visually-hidden">
        {clear ? t('profile.view.showing') : ''}
      </div>
      {shown && sensitive.isPending && <LoadingState />}
      {shown && sensitive.isError && <ErrorState error={sensitive.error} onRetry={() => void sensitive.refetch()} />}
      <dl className="facts">
        <div>
          <dt>{t('profile.view.document')}</dt>
          <dd>
            {profile.document && `${t(`profile.documentTypes.${profile.document.type}`)} · `}
            <span className="sensitive-value">{clear ? sensitive.data.document?.number : profile.document?.masked}</span>
          </dd>
        </div>
        <div>
          <dt>{t('profile.view.address')}</dt>
          <dd className="sensitive-value">
            {address
              ? `${address.street} ${address.number}${address.floor ? `, ${address.floor}` : ''}, ${address.postalCode} ${address.locality}, ${address.province} (${countryName(address.country, locale)})`
              : profile.addressSummary}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

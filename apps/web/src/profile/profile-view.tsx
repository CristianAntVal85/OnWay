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

/** Un dato oculto: se ven los puntos, y el lector de pantalla oye una frase en lugar de «punto, punto, punto». */
function Masked({ shown, spoken }: { shown: string; spoken: string }) {
  return (
    <>
      <span className="sensitive-value" aria-hidden="true">
        {shown}
      </span>
      <span className="visually-hidden">{spoken}</span>
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
    // La etiqueta ya dice qué hará («Mostrar» u «Ocultar»): sin `aria-pressed`, que haría leer «Ocultar, pulsado».
    <button type="button" className="button button-secondary" onClick={() => setShown(!shown)}>
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
            {clear ? (
              <span className="sensitive-value">{sensitive.data.document?.number}</span>
            ) : (
              profile.document && <Masked shown={profile.document.masked} spoken={t('profile.view.maskedDocument', { end: profile.document.masked.replace(/•/g, '') })} />
            )}
          </dd>
        </div>
        <div>
          <dt>{t('profile.view.address')}</dt>
          <dd className="sensitive-value">
            {address
              ? `${address.street} ${address.number}${address.floor ? `, ${address.floor}` : ''}, ${address.postalCode} ${address.locality}, ${address.province} (${countryName(address.country, locale)})`
              : profile.addressSummary && <Masked shown={profile.addressSummary} spoken={t('profile.view.maskedAddress', { rest: profile.addressSummary.replace(/^•+,\s*/, '') })} />}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

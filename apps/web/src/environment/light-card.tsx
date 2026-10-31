import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { clock, decimal, longDay } from './format';

type Environment = OperationOutput<'getEnvironment'>;

/**
 * Luz y luna del mismo punto (RF-705). Se calculan en el servidor con `@onway/geo`; aquí solo se muestran. Un instante `null` es
 * un hecho que ese día no ocurre en esa latitud (sol de medianoche, noche polar…).
 */
export function LightCard({ sun, moon, locale }: { sun: Environment['sun']; moon: Environment['moon']; locale: string }) {
  const { t } = useTranslation();
  const titleId = useId();
  const at = (iso: string | null): ReactNode => (iso === null ? t('environment.light.none') : clock(iso, locale));
  const twilight = (dawn: string | null, dusk: string | null): ReactNode =>
    dawn === null && dusk === null
      ? t('environment.light.none')
      : t('environment.light.twilightValue', { dawn: dawn === null ? '–' : clock(dawn, locale), dusk: dusk === null ? '–' : clock(dusk, locale) });

  return (
    <section className="env-card" aria-labelledby={titleId}>
      <h3 id={titleId}>{t('environment.light.title')}</h3>
      <p className="field-help">{t('environment.light.forDay', { date: longDay(sun.date, locale) })}</p>
      <h4>{t('environment.light.sun')}</h4>
      <dl className="facts-grid">
        <div>
          <dt>{t('environment.light.sunrise')}</dt>
          <dd>{at(sun.sunrise)}</dd>
        </div>
        <div>
          <dt>{t('environment.light.sunset')}</dt>
          <dd>{at(sun.sunset)}</dd>
        </div>
        <div>
          <dt>{t('environment.light.civil')}</dt>
          <dd>{twilight(sun.civilDawn, sun.civilDusk)}</dd>
        </div>
        <div>
          <dt>{t('environment.light.nautical')}</dt>
          <dd>{twilight(sun.nauticalDawn, sun.nauticalDusk)}</dd>
        </div>
      </dl>
      <h4>{t('environment.light.moon')}</h4>
      <dl className="facts-grid">
        <div>
          <dt>{t(`environment.light.phases.${moon.phaseName}`)}</dt>
          <dd>{t('environment.light.illumination', { pct: decimal(moon.illuminationPct, locale) })}</dd>
        </div>
        <div>
          <dt>{t('environment.light.moonrise')}</dt>
          <dd>{at(moon.moonrise)}</dd>
        </div>
        <div>
          <dt>{t('environment.light.moonset')}</dt>
          <dd>{at(moon.moonset)}</dd>
        </div>
      </dl>
    </section>
  );
}

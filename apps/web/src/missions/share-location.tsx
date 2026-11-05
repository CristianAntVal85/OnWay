import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCoordinate } from '@onway/geo';

/**
 * Compartir la ubicación del objetivo (RF-604, P4): las coordenadas a la vista, un botón que las copia (con un aviso que lee el lector de pantalla)
 * y un enlace `geo:` que el móvil abre con la aplicación de mapas que tenga. Ningún servicio de terceros y nada de la ubicación del dispositivo.
 */
export function ShareLocation({ target }: { target: { lat: number; lon: number } }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const value = formatCoordinate(target, 'decimal');

  const copy = async () => {
    setMessage('');
    setFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setMessage(t('myMissions.share.copied', { value }));
    } catch {
      // Sin permiso o sin conexión segura el navegador no deja copiar: las coordenadas siguen a la vista para copiarlas a mano.
      setFailed(true);
    }
  };

  return (
    <section className="share-location" aria-labelledby="share-title">
      <h2 id="share-title">{t('myMissions.share.title')}</h2>
      <p className="field-help">{t('myMissions.share.help')}</p>
      <p className="share-coordinates">
        <span className="visually-hidden">{t('myMissions.share.coordinates')}: </span>
        <code>{value}</code>
      </p>
      <div className="point-row-actions">
        <button type="button" className="button button-secondary" onClick={() => void copy()}>
          {t('myMissions.share.copy')}
        </button>
        <a className="button button-secondary" href={`geo:${target.lat},${target.lon}`}>
          {t('myMissions.share.open')}
        </a>
      </div>
      <div role="status">{message}</div>
      {failed && (
        <p className="field-error" role="alert">
          {t('myMissions.share.copyFailed')}
        </p>
      )}
    </section>
  );
}

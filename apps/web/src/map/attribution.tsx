import { useTranslation } from 'react-i18next';
import type { MapLayerId } from './types.js';

type AttributionKey = 'osm' | 'ignEs' | 'ignEsSatellite' | 'ignFr' | 'copernicus';

/** Qué se cita con cada capa (doc 04 §8.5). Copernicus DEM se cita cuando hay altitud derivada del modelo. */
export function attributionKeys(layer: MapLayerId, withElevation: boolean): AttributionKey[] {
  const keys: AttributionKey[] = layer === 'roads' ? ['osm'] : layer === 'satellite' ? ['ignEsSatellite', 'ignFr'] : ['ignEs', 'ignFr'];
  return withElevation ? [...keys, 'copernicus'] : keys;
}

/** Atribuciones siempre visibles, a la vista bajo el mapa también a 375 px (D-H1-17): nada plegado tras un botón. */
export function Attribution({ layer, withElevation }: { layer: MapLayerId; withElevation: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="map-attribution" aria-label={t('map.attribution.label')}>
      {attributionKeys(layer, withElevation).map((key) => (
        <li key={key}>{t(`map.attribution.${key}`)}</li>
      ))}
    </ul>
  );
}

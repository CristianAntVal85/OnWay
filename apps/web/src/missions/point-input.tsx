import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import { formatCoordinate, parseCoordinates, type CoordinateError } from '@onway/geo';
import { Segmented } from '../components/segmented';
import { countryName } from '../i18n/country-name';
import { errorMessage } from '../i18n/error-message';
import type { ElevationLookup } from '../map';
import { useApi } from '../session/api-context';
import type { PickedPoint } from './point';

type Method = 'map' | 'coordinates' | 'address';
type Candidate = OperationOutput<'geocode'>['items'][number];
type Search = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'done'; items: Candidate[] };

const METHODS: readonly Method[] = ['map', 'coordinates', 'address'];
const METHOD_LABEL = { map: 'point.byMap', coordinates: 'point.byCoordinates', address: 'point.byAddress' } as const;
const METHOD_ICON = { map: 'map', coordinates: 'target', address: 'search' } as const;
const MIN_QUERY = 3;

interface Props {
  /** Prefijo de los identificadores de los campos (único en la página). */
  id: string;
  value: PickedPoint | null;
  onChange: (value: PickedPoint | null) => void;
  /** ¿Este punto está esperando un clic en el mapa? */
  picking: boolean;
  /** Pide a la página que los clics del mapa vayan a este punto (true) o a ninguno (false). */
  onPicking: (on: boolean) => void;
  organizationCountry?: string | undefined;
  elevationLookup: ElevationLookup;
  /** Mensaje de «falta el punto» cuando se intentó enviar sin él. */
  error?: string | null;
}

/**
 * Las tres formas de dar un punto (RF-401): mapa, coordenadas (decimal, GMS, UTM) o dirección. La búsqueda de dirección solo
 * se lanza al pulsar «Buscar» o con Intro en su campo, nunca al teclear (D-H1-16: la política de Nominatim prohíbe el autocompletado).
 */
export function PointInput({ id, value, onChange, picking, onPicking, organizationCountry, elevationLookup, error }: Props) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const locale = i18n.resolvedLanguage ?? 'es';
  const [method, setMethod] = useState<Method>('map');
  const [coordinatesText, setCoordinatesText] = useState('');
  const [coordinatesError, setCoordinatesError] = useState<CoordinateError | null>(null);
  const [query, setQuery] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const [search, setSearch] = useState<Search>({ status: 'idle' });
  const [pending, setPending] = useState<Candidate | null>(null);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const searchSeq = useRef(0);
  const uid = useId();
  const field = (name: string) => `${id}-${uid}-${name}`;

  const elevation = useQuery({
    queryKey: ['elevation-preview', value?.lat, value?.lon],
    queryFn: () => elevationLookup({ lat: value!.lat, lon: value!.lon }),
    enabled: value !== null,
  });

  const choose = (next: Method) => {
    setMethod(next);
    onPicking(next === 'map');
  };

  const applyCoordinates = () => {
    const parsed = parseCoordinates(coordinatesText);
    if (!parsed.ok) {
      setCoordinatesError(parsed.error);
      return;
    }
    setCoordinatesError(null);
    onChange({ lat: parsed.point.lat, lon: parsed.point.lon, source: 'coordinates' });
  };

  const runSearch = async () => {
    const text = query.trim();
    if (text.length < MIN_QUERY) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setPending(null);
    setChosen(null);
    const seq = ++searchSeq.current;
    setSearch({ status: 'loading' });
    try {
      const { items } = await api.geocode({ query: { q: text } });
      if (seq === searchSeq.current) setSearch({ status: 'done', items });
    } catch (failure) {
      if (seq === searchSeq.current) setSearch({ status: 'error', error: failure });
    }
  };

  const accept = (candidate: Candidate) => {
    setPending(null);
    setChosen(candidate);
    onChange({ lat: candidate.lat, lon: candidate.lon, source: 'address', label: candidate.label, ...(candidate.country ? { country: candidate.country } : {}) });
  };

  const pick = (candidate: Candidate) => {
    setChosen(candidate);
    // En zona fronteriza el nombre puede ser de los dos lados: si el país no es el de la organización, se pide confirmar (doc 02 §3.4).
    if (candidate.country && organizationCountry && candidate.country !== organizationCountry) setPending(candidate);
    else accept(candidate);
  };

  const submitOnEnter = (action: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault(); // Intro en estos campos no envía el formulario
    action();
  };

  const searchFailure =
    search.status === 'error' ? (search.error instanceof ApiError && search.error.code === 'UPSTREAM_UNAVAILABLE' ? t('point.searchUnavailable') : errorMessage(t, search.error)) : null;

  return (
    <div className="point-input">
      <Segmented
        className="method-switch"
        legend={t('point.methodLabel')}
        hideLegend
        block
        name={field('method')}
        value={method}
        onChange={choose}
        options={METHODS.map((option) => ({ value: option, label: t(METHOD_LABEL[option]), icon: METHOD_ICON[option] }))}
      />

      {method === 'map' && (
        <div className="method-body">
          {picking && <p className="form-note">{t('point.mapPicking')}</p>}
          {!picking && (
            <button type="button" className="button button-secondary" onClick={() => onPicking(true)}>
              {t('point.pickOnMap')}
            </button>
          )}
        </div>
      )}

      {method === 'coordinates' && (
        <div className="method-body">
          <div className="field">
            <label htmlFor={field('coordinates')}>{t('point.coordinates')}</label>
            <div className="field-row">
              <input
                id={field('coordinates')}
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('point.coordinatesPlaceholder')}
                value={coordinatesText}
                aria-invalid={coordinatesError !== null}
                aria-describedby={coordinatesError ? field('coordinates-error') : undefined}
                onChange={(event) => {
                  setCoordinatesText(event.target.value);
                  setCoordinatesError(null);
                }}
                onKeyDown={submitOnEnter(applyCoordinates)}
              />
              <button type="button" className="button button-secondary" onClick={applyCoordinates}>
                {t('point.useCoordinates')}
              </button>
            </div>
            {coordinatesError && (
              <p id={field('coordinates-error')} className="field-error" role="alert">
                {t(`coordinates.${coordinatesError}`)}
              </p>
            )}
          </div>
        </div>
      )}

      {method === 'address' && (
        <div className="method-body">
          <div className="field">
            <label htmlFor={field('address')}>{t('point.address')}</label>
            <div className="field-row">
              <input
                id={field('address')}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={query}
                aria-describedby={tooShort ? field('address-error') : undefined}
                aria-invalid={tooShort}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setTooShort(false);
                }}
                onKeyDown={submitOnEnter(() => void runSearch())}
              />
              <button type="button" className="button button-secondary" aria-disabled={search.status === 'loading'} onClick={() => search.status !== 'loading' && void runSearch()}>
                {search.status === 'loading' ? t('point.searching') : t('point.search')}
              </button>
            </div>
            {tooShort && (
              <p id={field('address-error')} className="field-error" role="alert">
                {t('point.searchTooShort')}
              </p>
            )}
          </div>

          <div aria-live="polite">
            {search.status === 'loading' && (
              <p className="state-inline" role="status">
                {t('point.searching')}
              </p>
            )}
            {searchFailure && (
              <p className="notice" role="alert">
                {searchFailure}
              </p>
            )}
            {search.status === 'done' && search.items.length === 0 && <p className="notice">{t('point.noResults')}</p>}
          </div>

          {search.status === 'done' && search.items.length > 0 && (
            <fieldset className="candidates">
              <legend>{t('point.candidates')}</legend>
              <ul>
                {search.items.map((candidate, index) => (
                  <li key={`${candidate.lat},${candidate.lon},${index}`}>
                    <label className="candidate">
                      <input type="radio" name={field('candidate')} checked={chosen === candidate} onChange={() => pick(candidate)} />
                      <span>
                        <span className="candidate-label">{candidate.label}</span>
                        {candidate.country && <span className="candidate-country">{t('point.countryOf', { country: countryName(candidate.country, locale) })}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          {pending && (
            <div className="notice" role="alert">
              <p>{t('point.otherCountry', { country: countryName(pending.country ?? '', locale), orgCountry: countryName(organizationCountry ?? '', locale) })}</p>
              <button type="button" className="button button-secondary" onClick={() => accept(pending)}>
                {t('point.confirmOtherCountry')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="point-summary" aria-live="polite">
        {value ? (
          <>
            <p className="point-summary-position">{t('point.selected', { position: formatCoordinate(value, 'decimal') })}</p>
            {value.label && <p className="point-summary-label">{value.label}</p>}
            <p className="point-summary-elevation">
              {elevation.isPending && t('point.elevationLoading')}
              {elevation.isError && t('point.elevationUnavailable')}
              {elevation.isSuccess &&
                (elevation.data === null ? t('point.elevationUnavailable') : t('point.elevation', { meters: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(elevation.data) }))}
            </p>
            <button type="button" className="button-link" onClick={() => onChange(null)}>
              {t('point.clear')}
            </button>
          </>
        ) : (
          <p className="point-summary-empty">{t('point.notSelected')}</p>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Vertex } from '../map';

interface Props {
  vertices: readonly Vertex[];
  selected: number | null;
  onSelect: (index: number | null) => void;
  onMove: (index: number, point: Vertex) => void;
  onRemove: (index: number) => void;
  /** Etiquetas de los campos de cada vértice, de la sección de la página que lo usa. */
  labels: { lat: (n: number) => string; lon: (n: number) => string; remove: (n: number) => string; invalid: string };
}

/**
 * Los vértices de una línea o de una zona como tabla de coordenadas editable: la alternativa al mapa para quien no usa ratón ni toque
 * (doc 02 §9, manejable con teclado). Un valor se aplica al salir del campo o con Intro; si no es válido, se avisa y se deja el anterior.
 */
export function VertexTable({ vertices, selected, onSelect, onMove, onRemove, labels }: Props) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<number | null>(null);

  const commit = (index: number, axis: 0 | 1, text: string) => {
    const value = Number(text.replace(',', '.'));
    const limit = axis === 0 ? 180 : 90;
    if (text.trim() === '' || !Number.isFinite(value) || Math.abs(value) > limit) {
      setInvalid(index);
      return;
    }
    setInvalid(null);
    const current = vertices[index]!;
    if (current[axis] !== value) onMove(index, axis === 0 ? [value, current[1]] : [current[0], value]);
  };
  const field = (index: number, axis: 0 | 1, value: number, label: string) => {
    const key = `${index}:${axis}`;
    return (
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid === index || undefined}
        value={drafts[key] ?? String(value)}
        onChange={(event) => setDrafts((previous) => ({ ...previous, [key]: event.target.value }))}
        onBlur={(event) => {
          commit(index, axis, event.target.value);
          setDrafts((previous) => Object.fromEntries(Object.entries(previous).filter(([name]) => name !== key)));
        }}
        onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), event.currentTarget.blur())}
      />
    );
  };

  return (
    <>
      <div className="vertex-scroll">
        <table className="vertex-table">
          <tbody>
            {vertices.map(([lon, lat], index) => (
              <tr key={`${index}-${lon}-${lat}`} data-selected={selected === index || undefined}>
                <th scope="row">
                  <button type="button" className="button-link" aria-pressed={selected === index} onClick={() => onSelect(selected === index ? null : index)}>
                    {index + 1}
                  </button>
                </th>
                <td>{field(index, 1, lat, labels.lat(index + 1))}</td>
                <td>{field(index, 0, lon, labels.lon(index + 1))}</td>
                <td>
                  <button type="button" className="button button-secondary" aria-label={labels.remove(index + 1)} onClick={() => onRemove(index)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invalid !== null && (
        <p className="field-error" role="alert">
          {labels.invalid || t('routeEditor.invalidCoordinates')}
        </p>
      )}
    </>
  );
}

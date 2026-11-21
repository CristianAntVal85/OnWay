import { useState, type Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditAction, Vertex } from '../map';

/**
 * La lista de vértices del editor (RF-505): la alternativa sin ratón al mapa. Cada vértice se elige, se escribe (latitud y longitud,
 * con validación del rango) y se borra. La usan dibujar, editar y continuar a mano.
 */
export function VertexList({
  vertices,
  selected,
  dispatch,
  headingLevel = 2,
}: {
  vertices: readonly Vertex[];
  selected: number | null;
  dispatch: Dispatch<EditAction>;
  /** Dentro de otra sección con su título (continuar a mano), la lista baja un nivel. */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const { t } = useTranslation();
  const [coordinateError, setCoordinateError] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const commit = (index: number, axis: 0 | 1, text: string) => {
    const value = Number(text.replace(',', '.'));
    const limit = axis === 0 ? 180 : 90;
    if (text.trim() === '' || !Number.isFinite(value) || Math.abs(value) > limit) {
      setCoordinateError(index);
      return;
    }
    setCoordinateError(null);
    const current = vertices[index]!;
    if (current[axis] === value) return;
    dispatch({ type: 'move', index, point: axis === 0 ? [value, current[1]] : [current[0], value] });
  };

  if (vertices.length === 0) return null;
  return (
    <section aria-labelledby="vertices-title">
      <Heading id="vertices-title">{t('routeEditor.verticesTitle')}</Heading>
      <div className="vertex-scroll">
        <table className="vertex-table">
          <tbody>
            {vertices.map(([lon, lat], index) => (
              <tr key={`${index}-${lon}-${lat}`} data-selected={selected === index || undefined}>
                <th scope="row">
                  <button type="button" className="button-link" aria-pressed={selected === index} onClick={() => dispatch({ type: 'select', index: selected === index ? null : index })}>
                    {index + 1}
                  </button>
                </th>
                {([1, 0] as const).map((axis) => (
                  <td key={axis}>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={t(axis === 1 ? 'routeEditor.latLabel' : 'routeEditor.lonLabel', { n: index + 1 })}
                      aria-invalid={coordinateError === index || undefined}
                      value={drafts[`${index}:${axis}`] ?? String(axis === 1 ? lat : lon)}
                      onChange={(event) => setDrafts((previous) => ({ ...previous, [`${index}:${axis}`]: event.target.value }))}
                      onBlur={(event) => {
                        commit(index, axis, event.target.value);
                        setDrafts((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== `${index}:${axis}`)));
                      }}
                      onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), event.currentTarget.blur())}
                    />
                  </td>
                ))}
                <td>
                  <button type="button" className="button button-secondary" aria-label={t('routeEditor.removeVertex', { n: index + 1 })} onClick={() => dispatch({ type: 'remove', index })}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {coordinateError !== null && (
        <p className="field-error" role="alert">
          {t('routeEditor.invalidCoordinates')}
        </p>
      )}
    </section>
  );
}

// Piezas comunes de las listas de misiones (personal y rescatista): la pestaña, la búsqueda y la página viven en la dirección,
// así «atrás» y los enlaces funcionan.
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

const SEARCH_DELAY_MS = 300;

/** Número de página de la dirección; cualquier cosa que no sea un entero positivo es la página 1. */
const pageNumber = (raw: string | null) => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
};

export function useListState<Tab extends string>(tabs: readonly Tab[], defaultTab: Tab) {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab = tabs.find((id) => id === rawTab) ?? defaultTab;
  const q = params.get('q') ?? '';
  const page = pageNumber(params.get('page'));

  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const update = (changes: Record<string, string | null>) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  };

  // La búsqueda se aplica al dejar de teclear (o al pulsar Buscar); cambiarla vuelve a la página 1.
  useEffect(() => {
    const text = draft.trim();
    if (text === q) return;
    const timer = setTimeout(() => update({ q: text, page: null }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // `update` cambia en cada render; solo importa lo que se ha escrito.
  }, [draft, q]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ q: draft.trim(), page: null });
  };

  return { tab, q, page, draft, setDraft, update, submit };
}

interface TabsProps<Tab extends string> {
  tabs: readonly Tab[];
  tab: Tab;
  label: string;
  tabLabel: (id: Tab) => string;
  onSelect: (id: Tab) => void;
}

/** Pestañas con el patrón de flechas (Izquierda y Derecha cambian de pestaña y mueven el foco). */
export function MissionTabs<Tab extends string>({ tabs, tab, label, tabLabel, onSelect }: TabsProps<Tab>) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((id) => (
        <button
          key={id}
          id={`missions-tab-${id}`}
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === id}
          aria-controls="missions-panel"
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onSelect(id)}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            const next = tabs[(tabs.indexOf(id) + step + tabs.length) % tabs.length]!;
            onSelect(next);
            document.getElementById(`missions-tab-${next}`)?.focus();
          }}
        >
          {tabLabel(id)}
        </button>
      ))}
    </div>
  );
}

export function MissionSearch({ draft, onDraft, onSubmit }: { draft: string; onDraft: (value: string) => void; onSubmit: (event: FormEvent) => void }) {
  const { t } = useTranslation();
  return (
    <form className="search-bar" role="search" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="missions-search">{t('missions.searchLabel')}</label>
        <div className="field-row">
          <input id="missions-search" type="search" autoComplete="off" spellCheck={false} maxLength={120} value={draft} onChange={(event) => onDraft(event.target.value)} />
          <button type="submit" className="button button-secondary">
            {t('missions.searchSubmit')}
          </button>
        </div>
      </div>
    </form>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const { t } = useTranslation();
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label={t('missions.pagination.label')}>
      <button type="button" className="button button-secondary" aria-disabled={page <= 1} onClick={() => page > 1 && onPage(page - 1)}>
        {t('missions.pagination.previous')}
      </button>
      <span>{t('missions.pagination.page', { page, pages })}</span>
      <button type="button" className="button button-secondary" aria-disabled={page >= pages} onClick={() => page < pages && onPage(page + 1)}>
        {t('missions.pagination.next')}
      </button>
    </nav>
  );
}

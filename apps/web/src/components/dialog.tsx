import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  /** Texto que explica el efecto: se enlaza con `aria-describedby` y se lee al abrir. */
  description?: ReactNode;
  /** Escape o el botón de cancelar: cierra sin hacer nada. */
  onClose: () => void;
  children: ReactNode;
}

/**
 * Diálogo modal accesible: sale del flujo con un portal, deja el resto de la página inerte, mueve el foco dentro (al elemento con
 * `data-autofocus` o, si no hay, al primero), lo mantiene dentro con Tab, se cierra con Escape y devuelve el foco a quien lo abrió.
 */
export function Dialog({ title, description, onClose, children }: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Todo lo demás de la página queda inerte (sin foco ni lectura) mientras el diálogo está abierto.
    const made: Element[] = [];
    for (const element of Array.from(document.body.children)) {
      if (element === backdrop.current || element.hasAttribute('inert')) continue;
      element.setAttribute('inert', '');
      made.push(element);
    }
    document.body.classList.add('dialog-open');
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current;
    first?.focus();
    return () => {
      for (const element of made) element.removeAttribute('inert');
      document.body.classList.remove('dialog-open');
      // Si quien lo abrió ya no está (p. ej. su botón desapareció al cambiar el estado), la página decide dónde poner el foco.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((item) => item.getAttribute('aria-hidden') !== 'true');
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const firstItem = items[0]!;
    const lastItem = items[items.length - 1]!;
    const current = document.activeElement;
    if (event.shiftKey && (current === firstItem || current === panel.current)) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && current === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  };

  return createPortal(
    <div ref={backdrop} className="dialog-backdrop" onKeyDown={onKeyDown}>
      <div ref={panel} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        {description && (
          <div id={descriptionId} className="dialog-description">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

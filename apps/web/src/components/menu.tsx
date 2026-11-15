import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from './icon';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Acción al elegir la opción. */
  onSelect?: () => void;
  /** Si es una navegación, la ruta de destino (la opción es un enlace). */
  to?: string;
  disabled?: boolean;
  /** Acción destructiva: se pinta con el color de error. */
  danger?: boolean;
  /** Solo en menús de elección (`selection`): la opción vigente. */
  checked?: boolean;
}

interface MenuProps {
  /** Texto del botón; con `iconOnly`, su nombre accesible. */
  label: string;
  items: MenuItem[];
  icon?: IconName;
  /** Botón de solo icono (el `label` pasa a `aria-label`). */
  iconOnly?: boolean;
  variant?: 'primary' | 'secondary' | 'plain';
  /** Las opciones son excluyentes y una está elegida (`menuitemradio`), como las capas del mapa. */
  selection?: boolean;
  /** Borde del botón con el que se alinea la lista. Si no cabe en la ventana, se alinea con el otro. */
  align?: 'start' | 'end';
  disabled?: boolean;
  className?: string;
  /** `id` del botón, para devolverle el foco desde fuera (al cerrar un formulario que abrió una de sus opciones). */
  buttonId?: string;
}

type Focus = 'first' | 'last' | 'checked';

/**
 * Menú desplegable de acciones (UI-simplificacion, D-S4 y D-S5): un botón que abre una lista `role="menu"`.
 * Teclado: Enter, Espacio o flecha abajo abren en la primera opción (flecha arriba, en la última); las flechas recorren en círculo,
 * Inicio y Fin saltan a los extremos, Escape cierra y devuelve el foco al botón, Tab cierra y sigue. Se cierra al pulsar fuera.
 */
export function Menu({ label, items, icon, iconOnly = false, variant = 'secondary', selection = false, align = 'start', disabled = false, className, buttonId }: MenuProps) {
  const [open, setOpen] = useState<Focus | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  const entries = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) button.current?.focus();
  };

  // Al abrir: la lista se coloca respecto a la ventana (así no la recorta una tabla o un panel con desplazamiento), alineada con el borde
  // del botón que tenga sitio y hacia arriba si debajo no cabe; el foco entra en la opción que toca.
  useLayoutEffect(() => {
    if (!open) return;
    const box = list.current?.getBoundingClientRect();
    const anchor = button.current?.getBoundingClientRect();
    if (box && anchor && box.width > 0) {
      const gap = 4;
      const fitsStart = anchor.left + box.width <= window.innerWidth;
      const fitsEnd = anchor.right - box.width >= 0;
      const start = align === 'start' ? fitsStart || !fitsEnd : !(fitsEnd || !fitsStart);
      const below = anchor.bottom + gap + box.height <= window.innerHeight || anchor.top - gap - box.height < 0;
      setPlace({
        top: below ? anchor.bottom + gap : anchor.top - gap - box.height,
        left: start ? Math.max(0, Math.min(anchor.left, window.innerWidth - box.width)) : Math.max(0, anchor.right - box.width),
      });
    }
    const all = entries();
    const target = open === 'last' ? all.at(-1) : (open === 'checked' && all.find((entry) => entry.getAttribute('aria-checked') === 'true')) || all[0];
    target?.focus();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    // La lista va fija a la ventana: si la página se desplaza o cambia de tamaño dejaría de estar junto al botón, así que se cierra.
    const onMove = (event: Event) => {
      if (!(event.target instanceof Node) || !list.current?.contains(event.target)) setOpen(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const onButtonKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(event.key === 'ArrowUp' ? 'last' : selection ? 'checked' : 'first');
    }
  };

  const onListKeyDown = (event: KeyboardEvent) => {
    const all = entries();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') setOpen(null);
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect?.();
  };

  const role = selection ? 'menuitemradio' : 'menuitem';

  return (
    <div ref={root} className={className ? `menu ${className}` : 'menu'}>
      <button
        ref={button}
        id={buttonId}
        type="button"
        className={`button button-${variant}${iconOnly ? ' button-icon' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open ? listId : undefined}
        aria-label={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => (value ? null : selection ? 'checked' : 'first'))}
        onKeyDown={onButtonKeyDown}
      >
        {icon && <Icon name={icon} />}
        {!iconOnly && <span>{label}</span>}
        {!iconOnly && <Icon name="chevron-down" className="menu-caret" />}
      </button>
      {open && (
        <ul ref={list} id={listId} className="menu-list" role="menu" aria-label={label} style={place} onKeyDown={onListKeyDown}>
          {items.map((item) => {
            const content = (
              <>
                {selection ? <Icon name="check" className="menu-check" /> : item.icon && <Icon name={item.icon} />}
                <span>{item.label}</span>
              </>
            );
            const common = {
              role,
              tabIndex: -1,
              className: 'menu-item',
              'data-danger': item.danger ? 'true' : undefined,
              'aria-disabled': item.disabled ? true : undefined,
              'aria-checked': selection ? Boolean(item.checked) : undefined,
            } as const;
            return (
              <li key={item.id} role="none">
                {item.to && !item.disabled ? (
                  <Link {...common} to={item.to} onClick={() => select(item)}>
                    {content}
                  </Link>
                ) : (
                  <button {...common} type="button" onClick={() => select(item)}>
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

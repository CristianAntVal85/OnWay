import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { landingPath, navItemsFor } from '../nav/navigation';
import { useCurrentUser } from '../session/session';
import { Blaze } from './blaze';
import { Icon } from './icon';
import { ThemeToggle } from './theme-switch';
import { MAIN_ID } from './skip-link';

const NAV_ID = 'primary-nav';

/** Marco de las vistas con sesión: cabecera, barra por rol (RF-702) y contenido. */
export function Shell() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const { pathname, key } = useLocation();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const lastPath = useRef<string | null>(null);

  // Al llegar a una vista dentro de la aplicación (tras iniciar sesión o al navegar) se cierra el menú y el foco pasa al contenido,
  // para que el teclado y los lectores de pantalla empiecen ahí. Al recargar (clave `default`) se respeta el orden normal, con «saltar al contenido».
  useEffect(() => {
    setOpen(false);
    const arrived = lastPath.current === null ? key !== 'default' : lastPath.current !== pathname;
    if (arrived) main.current?.focus();
    lastPath.current = pathname;
  }, [pathname, key]);

  const items = user.role ? navItemsFor(user.role) : [];

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      menuButton.current?.focus();
    }
  };

  return (
    <div className="shell">
      <header className="app-header" onKeyDown={onKeyDown}>
        <div className="app-header-bar">
          <Link to={landingPath(user)} className="brand">
            <Blaze />
            <span className="brand-name">{t('app.name')}</span>
          </Link>
          {user.organization && <p className="org-name">{user.organization.name}</p>}
          <button ref={menuButton} type="button" className="menu-button" aria-expanded={open} aria-controls={NAV_ID} onClick={() => setOpen((value) => !value)}>
            <Icon name={open ? 'close' : 'menu'} />
            <span>{open ? t('nav.closeMenu') : t('nav.menu')}</span>
          </button>
        </div>
        <nav id={NAV_ID} className="main-nav" aria-label={t('nav.label')} data-open={open}>
          <ul>
            {items.map((item) => (
              <li key={item.id} data-item={item.id}>
                <NavLink to={item.path} end>
                  <Icon name={item.icon} />
                  <span className="nav-label">{t(item.labelKey)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <ThemeToggle />
      </header>
      <main id={MAIN_ID} tabIndex={-1} ref={main} className="content">
        <Outlet />
      </main>
    </div>
  );
}

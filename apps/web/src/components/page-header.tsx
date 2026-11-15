import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from './icon';

interface PageHeaderProps {
  title: string;
  icon?: IconName;
  subtitle?: ReactNode;
  /** Enlace de vuelta, encima del título. */
  back?: { to: string; label: string };
  /** Junto al título: insignias de estado. */
  badges?: ReactNode;
  /** A la derecha: como mucho una acción principal, dos secundarias y los menús (D-S4). */
  actions?: ReactNode;
}

/** Cabecera de página (UI-simplificacion): vuelta, icono, título, subtítulo opcional y las acciones de la vista en una sola fila. */
export function PageHeader({ title, icon, subtitle, back, badges, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      {back && (
        <Link className="page-back" to={back.to}>
          <Icon name="arrow-left" />
          <span>{back.label}</span>
        </Link>
      )}
      <div className="page-header-row">
        {icon && <Icon name={icon} className="page-header-icon" />}
        <div className="page-header-text">
          <div className="page-header-title">
            <h1>{title}</h1>
            {badges}
          </div>
          {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}

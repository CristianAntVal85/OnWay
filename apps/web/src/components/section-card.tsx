import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from './icon';

interface SectionCardProps {
  title: string;
  icon?: IconName;
  /** Controles a la derecha del título (una acción o un menú). */
  actions?: ReactNode;
  /** Sin fondo ni borde: una sección de formulario dentro de una columna. */
  plain?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
  children: ReactNode;
}

/** Sección con cabecera de icono y título (UI-simplificacion, D-S10): la unidad con la que se ordenan páginas y formularios. */
export function SectionCard({ title, icon, actions, plain = false, headingLevel = 2, className, children }: SectionCardProps) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={['section-card', plain && 'section-card-plain', className].filter(Boolean).join(' ')} aria-labelledby={titleId}>
      <header className="section-card-header">
        {icon && <Icon name={icon} className="section-card-icon" />}
        <Heading id={titleId} className="section-card-title">
          {title}
        </Heading>
        {actions && <div className="section-card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

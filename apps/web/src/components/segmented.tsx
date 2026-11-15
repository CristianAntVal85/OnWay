import { Icon, type IconName } from './icon';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

interface SegmentedProps<T extends string> {
  /** Nombre del grupo: su leyenda (visible o no) y el `name` de los botones de opción. */
  legend: string;
  name: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  hideLegend?: boolean;
  /** Ocupa el ancho del contenedor y reparte las opciones por igual. */
  block?: boolean;
  className?: string;
}

/** Elección excluyente entre pocas opciones, a la vista (UI-simplificacion): botones de opción nativos, con flechas y foco de serie. */
export function Segmented<T extends string>({ legend, name, options, value, onChange, hideLegend = false, block = false, className }: SegmentedProps<T>) {
  return (
    <fieldset className={['segmented-group', className].filter(Boolean).join(' ')}>
      <legend className={hideLegend ? 'visually-hidden' : undefined}>{legend}</legend>
      <div className="segmented" data-block={block ? 'true' : undefined}>
        {options.map((option) => (
          <label key={option.value} className="segment">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>
              {option.icon && <Icon name={option.icon} />}
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

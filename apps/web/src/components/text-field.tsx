import type { InputHTMLAttributes, Ref } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  /** Texto del error del campo; si lo hay, el campo queda marcado como no válido y el texto asociado. */
  error?: string | null;
  help?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** Campo de formulario con su etiqueta, su ayuda y su error asociados por `aria-describedby`. */
export function TextField({ id, label, error, help, inputRef, ...input }: TextFieldProps) {
  const describedBy = [error ? `${id}-error` : null, help ? `${id}-help` : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} ref={inputRef} aria-invalid={Boolean(error)} aria-describedby={describedBy || undefined} {...input} />
      {help && (
        <p id={`${id}-help`} className="field-help">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

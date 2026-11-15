import type { InputHTMLAttributes, Ref } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  /** Texto del error del campo; si lo hay, el campo queda marcado como no válido y el texto asociado. */
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Campo de formulario con su etiqueta encima y su error asociado por `aria-describedby` (UI-simplificacion, D-S3 y D-S10).
 * Sin texto de ayuda: la regla del campo sale como error cuando se incumple. Un campo obligatorio (`required` o `aria-required`) lleva asterisco.
 */
export function TextField({ id, label, error, inputRef, ...input }: TextFieldProps) {
  const required = Boolean(input.required) || input['aria-required'] === true || input['aria-required'] === 'true';
  return (
    <div className="field">
      {/* El asterisco va fuera de la etiqueta: no forma parte del nombre del campo (lo anuncia `aria-required`). */}
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        {required && (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        )}
      </div>
      <input id={id} ref={inputRef} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...input} aria-required={required || undefined} />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

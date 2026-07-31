import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Form field structures.
 *
 * §6 requires inline validation with field-level recovery and forbids relying
 * only on toast notifications, so the error belongs to the field, is wired to
 * the control with aria-describedby / aria-invalid, and is announced.
 */

let autoId = 0;
function useFieldId(provided?: string) {
  // Deterministic per render tree without useId, so these stay server-safe.
  const ref = React.useRef<string | undefined>(provided);
  if (!ref.current) {
    autoId += 1;
    ref.current = `cr-field-${autoId}`;
  }
  return ref.current;
}

export type FieldProps = {
  id?: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  optionalLabel?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
    "aria-required": boolean | undefined;
  }) => React.ReactNode;
};

export function Field({
  id,
  label,
  hint,
  error,
  required,
  optionalLabel = "optional",
  children,
}: FieldProps) {
  const fieldId = useFieldId(id);
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="cr-field">
      <label className="cr-label" htmlFor={fieldId}>
        {label}
        {required ? (
          <span className="cr-label__required" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="cr-label__optional"> ({optionalLabel})</span>
        )}
      </label>

      {children({
        id: fieldId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })}

      {hint ? (
        <p className="cr-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {error ? (
        <p className="cr-field__error" id={errorId} role="alert">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn("cr-input", className)} {...rest} />;
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn("cr-textarea", className)} {...rest} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn("cr-select", className)} {...rest}>
      {children}
    </select>
  );
});

export function CheckboxRow({
  id,
  label,
  hint,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
}) {
  const fieldId = useFieldId(id);
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="cr-checkbox-row">
      <input
        type="checkbox"
        id={fieldId}
        className="cr-checkbox"
        aria-describedby={hintId}
        {...rest}
      />
      <div>
        <label className="cr-label" htmlFor={fieldId}>
          {label}
        </label>
        {hint ? (
          <p className="cr-field__hint" id={hintId}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// A single auth-form field styled like the prototype: the visible text is the
// placeholder, while a visually-hidden <label> keeps the accessible name (Principle IV).
// The error message is tied to the input via aria-describedby and conveyed as text (not
// by color alone), and aria-invalid marks the field for assistive tech (FR-015).
function AuthField({ id, label, type, value, autoComplete, error, onChange, onBlur }: {
  id: string;
  label: string;
  type: string;
  value: string;
  autoComplete: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="auth-field">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={label}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? (
        <span id={errorId} className="auth-field__error" role="alert">{error}</span>
      ) : null}
    </div>
  );
}

export default AuthField;

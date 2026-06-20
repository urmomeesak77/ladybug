// A single labeled auth-form field with accessible error association: the message is
// programmatically tied to the input via aria-describedby and conveyed as text (not by
// color alone), and aria-invalid marks the field for assistive tech (FR-015).
function AuthField({ id, label, type, value, autoComplete, error, onChange }: {
  id: string;
  label: string;
  type: string;
  value: string;
  autoComplete: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <span id={errorId} className="auth-field__error" role="alert">{error}</span>
      ) : null}
    </div>
  );
}

export default AuthField;

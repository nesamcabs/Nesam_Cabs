import { useId, useState, type FormEvent } from "react";
import { signInAdmin, describeAuthError } from "../services/authService";
import AuthShell from "../components/shell/AuthShell";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";

export default function Login({ onSignUp }: { onSignUp?: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await signInAdmin(email.trim(), password);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Admin sign-in"
      subtitle="Sign in with your staff account."
      footer="Official NESAM Tours & Travels admin portal"
    >
      <form onSubmit={handleSubmit} className="ds-auth-form" noValidate>
        {error && (
          <div id={errorId} role="alert" className="ds-error" style={{ margin: 0 }}>
            <Icon name="circle-alert" />
            <span>{error}</span>
          </div>
        )}
        <div className="ds-field">
          <label htmlFor={emailId}>Username or email address</label>
          <input
            id={emailId}
            type="text"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Staff username or admin email"
            className="ds-input"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            required
          />
        </div>
        <div className="ds-field">
          <label htmlFor={passwordId}>Password</label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="ds-input"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            required
          />
        </div>
        <Button type="submit" variant="primary" loading={submitting} disabled={!email || !password}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {onSignUp && (
        <div className="ds-auth-links">
          <span>Need an account?</span>
          <button type="button" className="ds-link" onClick={onSignUp}>
            Request access
          </button>
        </div>
      )}
    </AuthShell>
  );
}

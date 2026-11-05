import { useId, useState, type FormEvent } from "react";
import { signUpAdmin, describeAuthError } from "../services/authService";
import AuthShell from "../components/shell/AuthShell";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";

export default function Signup({
  onBackToLogin,
}: {
  onBackToLogin: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const ids = { name: useId(), email: useId(), password: useId(), confirm: useId(), error: useId() };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) return;
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signUpAdmin(name.trim(), email.trim(), password);
      setDone(true);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const invalid = error ? true : undefined;
  const described = error ? ids.error : undefined;

  if (done) {
    return (
      <AuthShell icon="circle-check" title="Request received" subtitle="Your account is pending approval." footer="Official NESAM Tours & Travels admin portal">
        <p className="text-[13px] text-muted" style={{ lineHeight: 1.7, marginBottom: 22 }}>
          Your request is pending approval. A super admin will assign a role to <strong className="text-ink">{email}</strong>. You can sign in once it is approved.
        </p>
        <Button variant="primary" onClick={onBackToLogin}>
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell icon="user-plus" title="Request access" subtitle="Create a staff account. A super admin approves it and assigns your role." footer="Official NESAM Tours & Travels admin portal">
      <form onSubmit={handleSubmit} className="ds-auth-form" noValidate>
        {error && (
          <div id={ids.error} role="alert" className="ds-error" style={{ margin: 0 }}>
            <Icon name="circle-alert" />
            <span>{error}</span>
          </div>
        )}
        <div className="ds-field">
          <label htmlFor={ids.name}>Full name</label>
          <input id={ids.name} type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="ds-input" required />
        </div>
        <div className="ds-field">
          <label htmlFor={ids.email}>Email address</label>
          <input id={ids.email} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@nesam.in" className="ds-input" required />
        </div>
        <div className="ds-field">
          <label htmlFor={ids.password}>Password</label>
          <input id={ids.password} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="ds-input" aria-invalid={invalid} aria-describedby={described} required />
        </div>
        <div className="ds-field">
          <label htmlFor={ids.confirm}>Confirm password</label>
          <input id={ids.confirm} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="ds-input" aria-invalid={invalid} aria-describedby={described} required />
        </div>
        <Button type="submit" variant="primary" loading={submitting} disabled={!name || !email || !password}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <div className="ds-auth-links">
        <span>Already have an account?</span>
        <button type="button" className="ds-link" onClick={onBackToLogin}>
          Sign in
        </button>
      </div>
    </AuthShell>
  );
}

import { useState } from 'react';
import { isApiError, useAuth } from '../../lib/useAuth';

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [signupName, setSignupName] = useState('');
  const [portalName, setPortalName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');

  async function submitSignup() {
    setError(null);
    setSubmitting(true);
    try {
      const [firstName, ...rest] = signupName.trim().split(' ');
      await register({
        organizationName: portalName,
        email: signupEmail,
        password: signupPassword,
        firstName: firstName || signupName,
        lastName: rest.join(' ') || '—',
      });
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSignin() {
    setError(null);
    setSubmitting(true);
    try {
      await login({ email: signinEmail, password: signinPassword });
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-[#2E97A6] via-[#1E7A8C] to-[#12566A] px-4">
      <svg
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%] w-full"
        viewBox="0 0 400 200"
        preserveAspectRatio="none"
      >
        <path
          d="M0 42 C 90 15, 150 65, 240 40 C 310 20, 360 50, 400 32 L 400 200 L 0 200 Z"
          fill="#F3E3C4"
        />
      </svg>
      <div className="absolute left-6 top-6 text-white sm:left-8 sm:top-8">
        <div className="text-base font-bold tracking-wide">Kinvo</div>
        <div className="mt-1 max-w-[180px] text-xs text-white/80">
          Calm, precise port coordination.
        </div>
      </div>

      <div className="relative z-10 w-full max-w-sm rounded-[20px] bg-[rgba(255,253,248,0.96)] p-8 shadow-2xl backdrop-blur">
        {mode === 'signup' ? (
          <>
            <h1 className="text-xl font-bold text-[#0F2A38]">Create your portal</h1>
            <p className="mt-1.5 text-sm text-[#8B9AA3]">
              Set up Kinvo for your port operation. You can invite drivers once you're in.
            </p>

            <div className="mt-6 flex flex-col gap-3.5">
              <Field
                label="Your name"
                value={signupName}
                onChange={setSignupName}
                placeholder="e.g. Sara Al-Farsi"
              />
              <Field
                label="Portal name"
                value={portalName}
                onChange={setPortalName}
                placeholder="e.g. Jebel Ali Dispatch"
              />
              <Field
                label="Work email"
                value={signupEmail}
                onChange={setSignupEmail}
                placeholder="you@company.com"
                type="email"
              />
              <Field
                label="Password"
                value={signupPassword}
                onChange={setSignupPassword}
                placeholder="Create a password"
                type="password"
              />
            </div>

            {error && <p className="mt-3 text-xs text-[#C1503B]">{error}</p>}

            <button
              onClick={submitSignup}
              disabled={submitting}
              className="mt-5 w-full rounded-full bg-[#1E7A8C] py-3 text-sm font-semibold text-white transition hover:bg-[#175F6E] disabled:opacity-60"
            >
              {submitting ? 'Creating…' : 'Create Portal'}
            </button>
            <p className="mt-4 text-center text-xs text-[#8B9AA3]">
              Already have a portal?{' '}
              <button
                onClick={() => setMode('signin')}
                className="font-semibold text-[#1E7A8C] hover:text-[#F2A65A]"
              >
                Sign in
              </button>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-[#0F2A38]">Sign in to Kinvo</h1>
            <p className="mt-1.5 text-sm text-[#8B9AA3]">
              Enter your credentials to reach the dispatch desk.
            </p>

            <div className="mt-6 flex flex-col gap-3.5">
              <Field
                label="Work email"
                value={signinEmail}
                onChange={setSigninEmail}
                placeholder="you@company.com"
                type="email"
              />
              <Field
                label="Password"
                value={signinPassword}
                onChange={setSigninPassword}
                placeholder="Your password"
                type="password"
              />
            </div>

            {error && <p className="mt-3 text-xs text-[#C1503B]">{error}</p>}

            <button
              onClick={submitSignin}
              disabled={submitting}
              className="mt-5 w-full rounded-full bg-[#1E7A8C] py-3 text-sm font-semibold text-white transition hover:bg-[#175F6E] disabled:opacity-60"
            >
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
            <p className="mt-4 text-center text-xs text-[#8B9AA3]">
              New to Kinvo?{' '}
              <button
                onClick={() => setMode('signup')}
                className="font-semibold text-[#1E7A8C] hover:text-[#F2A65A]"
              >
                Create a portal
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] text-[#8B9AA3]">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className="w-full rounded-xl border border-[#ECE1CC] px-3.5 py-2.5 text-sm text-[#0F2A38] outline-none placeholder:text-[#B3A98F] focus:border-[#1E7A8C]"
      />
    </div>
  );
}

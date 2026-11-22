import { useState, type FormEvent } from 'react';
import { X, Lock, Mail, User as UserIcon, ArrowRight } from 'lucide-react';
import {
  loginWithEmail,
  registerWithEmail,
  signInWithGoogle,
} from '../services/libraryService';
import { BLUEPRINT_LIMITS } from '../types';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated?: () => void;
}

function formatAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // Fall through to standard formatting
    }
  }
  if (raw.includes('auth/operation-not-allowed')) {
    return 'Email/Password weli lagama daarin Firebase Console (Authentication -> Sign-in method). Fadlan daar Email/Password ama ku gal Google.';
  }
  if (raw.includes('auth/email-already-in-use')) {
    return 'Email-kan hore ayaa loo diiwaangeliyay. Fadlan dooro "Soo Gal".';
  }
  if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password') || raw.includes('auth/user-not-found')) {
    return 'Email-ka ama furaha sirta ah (password) waa khalad.';
  }
  if (raw.includes('auth/weak-password')) {
    return 'Password-ku waa inuu ka koobnaado ugu yaraan 6 xaraf.';
  }
  if (raw.includes('auth/unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'domain-kan';
    return `Domain-kan (${host}) weli loogama oggolaan Firebase Authentication. Ku dar "${host}" gudaha Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (raw.includes('auth/popup-closed-by-user')) {
    return 'Daaqadda gelitaanka Google waa la xiray ka hor intaan la dhammaystirin.';
  }
  return raw;
}

export function AuthModal({ open, onClose, onAuthenticated }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (!name.trim()) {
          setErrorMsg('Fadlan qor magacaaga buuxa.');
          setBusy(false);
          return;
        }
        await registerWithEmail(name, email, password);
      } else {
        await loginWithEmail(email, password);
      }
      onClose();
      onAuthenticated?.();
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setErrorMsg('');
    setBusy(true);
    try {
      await signInWithGoogle();
      onClose();
      onAuthenticated?.();
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md bg-[#F8F6F1] dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-6 sm:p-8 shadow-xl relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Xir daaqadda gelitaanka"
          className="absolute top-5 right-5 p-2 text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-6">
          <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E] mb-1">
            maktabada.so
          </p>
          <h2 id="auth-modal-title" className="font-serif text-2xl font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
            {mode === 'login' ? 'Ku Soo Gal Akoonkaaga' : 'Sameyso Akoon Akhriste'}
          </h2>
          <p className="text-sm text-[#57534E] dark:text-[#A8A29E] mt-1">
            {mode === 'login'
              ? 'Kaydso buugagga aad jeceshahay oo ka akhriso meel kasta.'
              : 'Akoon kasta oo cusub wuxuu ku bilaabmaa doorka Akhriste (user).'}
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-[#EFECE5] dark:bg-[#141312] rounded-lg mb-6">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg('');
            }}
            className={`py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'login'
                ? 'bg-white dark:bg-[#292724] text-[#1C1917] dark:text-[#F5F2EB] shadow-xs'
                : 'text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
            }`}
          >
            Soo Gal (Log In)
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setErrorMsg('');
            }}
            className={`py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'signup'
                ? 'bg-white dark:bg-[#292724] text-[#1C1917] dark:text-[#F5F2EB] shadow-xs'
                : 'text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
            }`}
          >
            Is-diiwaangeli (Sign Up)
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-[#FEF2F2] dark:bg-[#451A1A]/40 border border-[#FECACA] dark:border-[#7F1D1D] text-xs text-[#991B1B] dark:text-[#FCA5A5] leading-relaxed">
            {errorMsg}
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={handleGoogle}
          className="w-full py-2.5 px-4 bg-white dark:bg-[#242320] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB] hover:bg-[#EFECE5]/60 dark:hover:bg-[#2E2C29] transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50 whitespace-nowrap"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
          Ku gal Akoonka Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <div className="flex-1 h-px bg-[#E5E0D5] dark:bg-[#2E2C29]" />
          <span>ama isticmaal Email</span>
          <div className="flex-1 h-px bg-[#E5E0D5] dark:bg-[#2E2C29]" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label htmlFor="auth-name" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
                Magaca Buuxa
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-name"
                  type="text"
                  required
                  maxLength={BLUEPRINT_LIMITS.user.nameMax}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tusaale: Axmed Cali"
                  className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
              Cinwaanka Email-ka
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-email"
                type="email"
                required
                maxLength={BLUEPRINT_LIMITS.user.emailMax}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="magac@example.com"
                className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
              Furaha Sirta ah (Password)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ugu yaraan 6 xaraf"
                className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 px-4 bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg text-sm font-medium hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
          >
            <span>
              {busy
                ? 'Sug...'
                : mode === 'login'
                ? 'Soo Gal Maktabadda'
                : 'Diiwaangeli Akoonka'}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

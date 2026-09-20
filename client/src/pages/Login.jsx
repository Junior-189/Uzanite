import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import UzerLogo from '../components/UzerLogo';
import { getUser as getStoredUser } from '../utils/tokenStore';
import { resolveApiUrl } from '../utils/apiRouting';

function GoogleSignIn({ onCredential, t }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const [ready, setReady] = useState(false);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;

  useEffect(() => {
    if (!clientId) return;
    const init = () => {
      if (!window.google?.accounts?.id) return;
      // Sign in with Google (id-token) flow — callback returns response.credential (a JWT id_token)
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response?.credential) cbRef.current(response.credential);
        },
      });
      setReady(true);
    };
    if (window.google?.accounts?.id) { init(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = init;
    document.head.appendChild(script);
  }, [clientId]);

  if (!clientId || !ready) return null;

  const handleClick = () => {
    if (!window.google?.accounts?.id) return;
    window.google.accounts.id.prompt();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center justify-center gap-3 py-3 rounded-xl bg-white border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 shadow-sm shadow-gray-200/40 transition-all duration-200"
    >
      <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      {t('login.continue_google')}
    </button>
  );
}

export default function Login() {
  const [tab, setTab] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState(false);
  const [registeredName, setRegisteredName] = useState('');
  const [pendingLogin, setPendingLogin] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const { login, googleLogin, staffLogin } = useAuth();
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (lockoutUntil > Date.now()) {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }
  }, [lockoutUntil]);
  const lockRemaining = lockoutUntil > Date.now() ? Math.ceil((lockoutUntil - Date.now()) / 1000) : 0;
  const fmtLock = (s) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}`;
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
    return `${pad(m)}:${pad(sec)}`;
  };
  const { lang, toggleLanguage, t } = useLang();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isSw = lang === 'sw';

  const resetForm = () => { setEmail(''); setPassword(''); setConfirmPassword(''); setShowPassword(false); setShowConfirm(false); setName(''); setError(''); };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const json = await login(email, password);
      if (json.pending) {
        setPendingName(json.user?.name || '');
        setPendingLogin(true);
      } else {
        const u = getStoredUser();
        const isAdminLike = u.role === 'super_admin' || u.role === 'sub_admin';
        navigate(isAdminLike ? '/admin/adminPanel' : '/admin/dashboard');
      }
    } catch {
      try {
        await staffLogin(email, password);
        const u = getStoredUser();
        const isAdminLike = u.role === 'super_admin' || u.role === 'sub_admin';
        navigate(isAdminLike && !u.impersonating ? '/admin/adminPanel' : '/admin/dashboard');
    } catch (staffErr) {
      if (staffErr.retryAfter) {
        setLockoutUntil(Date.now() + staffErr.retryAfter * 1000);
        setError('');
      } else {
        setError(staffErr.error || staffErr.message || t('login.error_login_failed'));
      }
    }
    } finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(t('login.password_mismatch'));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(resolveApiUrl('/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const json = await res.json();
      if (json.success) {
        setRegisteredName(name);
        setRegistered(true);
        resetForm();
      } else {
        setError(json.error || t('login.error_register_failed'));
      }
    } catch {
      setError(t('login.error_connection'));
    } finally { setLoading(false); }
  };

  const switchTab = (newTab) => { setTab(newTab); resetForm(); setRegistered(false); setPendingLogin(false); };

  const handleForgot = async () => {
    setError('');
    if (!email) {
      setError(t('login.forgot_need_email') || 'Enter your email address first.');
      return;
    }
    try {
      await fetch(resolveApiUrl('/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      showToast(t('login.forgot_sent') || 'If that email exists, a reset link has been sent.', 'success');
    } catch {
      showToast(t('login.error_connection'), 'error');
    }
  };

  const handleGoogleCredential = useCallback(async (credential) => {
    setError('');
    setLoading(true);
    try {
      const json = await googleLogin(credential);
      if (json.pending) {
        setPendingName(json.user?.name || '');
        setPendingLogin(true);
      } else {
        const u = getStoredUser();
        const isAdminLike = u.role === 'super_admin' || u.role === 'sub_admin';
        navigate(isAdminLike && !u.impersonating ? '/admin/adminPanel' : '/admin/dashboard');
      }
    } catch (err) {
      setError(err.message || t('login.error_google'));
    } finally {
      setLoading(false);
    }
  }, [googleLogin, navigate, t]);

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-900 via-slate-800 to-primary-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-72 h-72 bg-primary-500 rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-primary-400 rounded-full blur-3xl"></div>
        </div>
        <div className="relative z-10 flex flex-col justify-center items-center text-center px-16 max-w-xl">
          <UzerLogo size={120} className="mb-10" />
          <p className="text-2xl text-slate-200 leading-relaxed font-medium">
            {isSw
              ? 'Simamia biashara yako, wateja, na mauzo yote kupitia WhatsApp kwa urahisi.'
              : 'Manage your business, customers, and sales seamlessly through WhatsApp.'}
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-10">
        <div className="w-full max-w-md animate-slide-in-up">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-primary-600 transition-colors font-medium"
            >
              <i className="fas fa-arrow-left text-xs"></i> {t('login.back_to_home')}
            </button>
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors"
            >
              <i className="fas fa-globe"></i> {isSw ? 'English' : 'Kiswahili'}
            </button>
          </div>

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <UzerLogo size={40} />
            <span className="text-xl font-bold text-gray-900">UZANITE</span>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 sm:p-8">

            <div className="text-center mb-6">
              <UzerLogo size={56} className="mx-auto mb-4 lg:hidden" />
              <h1 className="text-xl font-bold text-gray-900">
                {registered || pendingLogin
                  ? t('login.title_register')
                  : t('login.title_welcome')}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {registered || pendingLogin
                  ? t('login.subtitle_register')
                  : t('login.subtitle')}
              </p>
            </div>

            {/* Tab bar */}
            {!registered && !pendingLogin && (
            <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
              {[
                { key: 'signin', label: t('login.signin_tab') },
                { key: 'register', label: t('login.register_tab') },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => switchTab(item.key)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    tab === item.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-danger-50 text-danger-700 border border-danger-200 px-4 py-3 rounded-xl text-sm mb-4 animate-slide-in-up">
                {error}
              </div>
            )}

            {/* Lockout countdown */}
            {lockRemaining > 0 && (
              <div className="bg-danger-50 text-danger-700 border border-danger-200 px-4 py-3 rounded-xl text-sm mb-4 text-center font-medium">
                {t('login.lockout_message', { time: fmtLock(lockRemaining) })}
              </div>
            )}

            {/* Pending Approval Screen - from Registration */}
            {registered && (
              <div className="text-center py-6 animate-fade-in">
                <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-5">
                  <svg className="w-8 h-8 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  {t('login.title_register')}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {t('login.pending_after_register', { name: registeredName || 'user' })}
                </p>
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3 mb-6">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {t('login.pending_notice')}
                  </p>
                </div>
                <button
                  onClick={() => { setRegistered(false); setTab('signin'); }}
                  className="w-full py-3 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-700 shadow-sm shadow-primary-600/25 transition-all duration-200"
                >
                  {t('login.sign_in_after_approval')}
                </button>
              </div>
            )}

            {/* Pending Approval Screen - from Login attempt */}
            {pendingLogin && (
              <div className="text-center py-6 animate-fade-in">
                <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-5">
                  <svg className="w-8 h-8 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                  {t('login.title_pending')}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {t('login.pending_login_greeting', { name: pendingName || 'user' })}
                </p>
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl px-4 py-3 mb-6">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {t('login.pending_login_notice')}
                  </p>
                </div>
                <button
                  onClick={() => { setPendingLogin(false); setTab('signin'); }}
                  className="w-full py-3 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-700 shadow-sm shadow-primary-600/25 transition-all duration-200"
                >
                  {t('login.ok_got_it')}
                </button>
              </div>
            )}

            {/* Sign In */}
            {!registered && !pendingLogin && tab === 'signin' && (
              <form onSubmit={handleLogin} className="space-y-4 animate-fade-in">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.email')}</label>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.email_placeholder')} required
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.password')}</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('login.password_placeholder')} required
                      className="w-full px-4 py-2.5 pr-11 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showPassword ? t('login.hide_password') : t('login.show_password')}
                    >
                      <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>
                <div className="text-right -mt-1">
                  <button type="button" onClick={handleForgot} className="text-xs font-medium text-primary-600 hover:underline">
                    {t('login.forgot_password') || 'Forgot password?'}
                  </button>
                </div>
                <button
                  type="submit" disabled={loading || lockRemaining > 0}
                  className="w-full py-3 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-700 shadow-sm shadow-primary-600/25 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      {t('login.signing_in')}
                    </span>
                  ) : t('login.signin_tab')}
                </button>
              </form>
            )}

            {/* Register */}
            {!registered && !pendingLogin && tab === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4 animate-fade-in">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('login.business_name')}</label>
                  <input
                    type="text" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder={t('login.business_name_placeholder')} required
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.email')}</label>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.email_placeholder')} required
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.password')}</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('login.create_password')} required
                      className="w-full px-4 py-2.5 pr-11 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                    />
                    <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showPassword ? t('login.hide_password') : t('login.show_password')}
                    >
                      <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('login.confirm_password')}</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t('login.confirm_password')} required
                      className="w-full px-4 py-2.5 pr-11 rounded-xl border border-gray-300 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                    />
                    <button type="button" onClick={() => setShowConfirm(v => !v)} tabIndex={-1}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showConfirm ? t('login.hide_password') : t('login.show_password')}
                    >
                      <i className={`fas ${showConfirm ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>
                <button
                  type="submit" disabled={loading}
                  className="w-full py-3 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-700 shadow-sm shadow-primary-600/25 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      {t('login.creating')}
                    </span>
                  ) : (isSw ? 'Unda Akaunti' : 'Create Account')}
                </button>
              </form>
            )}

            {/* Google Sign In — below the input fields */}
            {!registered && !pendingLogin && (
              <div className="mt-6">
                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-white text-gray-400">{t('login.or')}</span>
                  </div>
                </div>
                <GoogleSignIn onCredential={handleGoogleCredential} t={t} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

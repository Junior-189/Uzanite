import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import UzerLogo from '../components/UzerLogo';

// Completes the tenant self-service password reset flow.
export default function ResetPassword() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!token) {
      setError(t('reset_password.invalid') || 'This reset link is invalid or has expired.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('change_password.mismatch') || 'Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${apiUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Reset failed');
      navigate('/admin/login.html');
    } catch (err) {
      setError(err.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="text-center mb-6">
          <UzerLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900">{t('reset_password.title') || 'Reset your password'}</h1>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 px-4 py-3 rounded-xl text-sm mb-4">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('change_password.new') || 'New password'}
            required
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('change_password.confirm') || 'Confirm new password'}
            required
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
          <p className="text-xs text-gray-400">
            {t('change_password.rules') ||
              'At least 8 characters with uppercase, lowercase, number and special character.'}
          </p>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? '…' : t('reset_password.submit') || 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import UzerLogo from '../components/UzerLogo';
import { setUser as setStoredUser } from '../utils/tokenStore';
import { resolveApiUrl } from '../utils/apiRouting';

// Forced password change for accounts flagged `mustChangePassword`
// (e.g. the securely-bootstrapped super admin). Closes audit finding V4.
export default function ChangePassword() {
  const { user, token } = useAuth();
  const { t } = useLang();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!token) {
    return <Navigate to="/admin/login.html" replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError(t('change_password.mismatch') || 'Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(resolveApiUrl('/auth/change-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to change password');
      }
      // Update stored user then hard-navigate so AuthContext re-hydrates with
      // mustChangePassword=false (prevents an AuthGuard redirect loop).
      const updated = { ...user, mustChangePassword: false };
      setStoredUser(updated);
      const isAdminLike = updated.role === 'super_admin' || updated.role === 'sub_admin';
      window.location.href = isAdminLike ? '/admin/adminPanel' : '/admin/dashboard';
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
        <div className="text-center mb-6">
          <UzerLogo size={48} className="mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900">
            {t('change_password.title') || 'Set a new password'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('change_password.subtitle') || 'You must change your password before continuing.'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 px-4 py-3 rounded-xl text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t('change_password.current') || 'Current password'}
            required
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          />
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
            {loading ? '…' : t('change_password.submit') || 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}

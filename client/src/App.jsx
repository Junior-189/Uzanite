import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { LangProvider } from './context/LangContext';
import { ThemeProvider } from './components/landing/ThemeContext';
import AuthGuard from './components/AuthGuard';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import UpdateBanner from './components/UpdateBanner';
import FeatureDisabled from './components/FeatureDisabled';
import { useFeatureFlags } from './features/featureFlags';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/Orders'));
const Products = lazy(() => import('./pages/Products'));
const Business = lazy(() => import('./pages/Business'));
const WhatsApp = lazy(() => import('./pages/WhatsApp'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Debts = lazy(() => import('./pages/Debts'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Broadcast = lazy(() => import('./pages/Broadcast'));

const Staff = lazy(() => import('./pages/Staff'));
const Notifications = lazy(() => import('./pages/Notifications'));
const RecycleBin = lazy(() => import('./pages/RecycleBin'));
const Reports = lazy(() => import('./pages/Reports'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

function PageLoader() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-primary-500/25 animate-pulse">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m7.5 4.27 9 5.15" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          </svg>
        </div>
        <div className="flex items-center gap-1.5 justify-center">
          <div className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

function AdminIndex() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'sub_admin';
  if (isAdmin && !user?.impersonating) {
    return <Navigate to="/admin/adminPanel" replace />;
  }
  return <Navigate to="/admin/dashboard" replace />;
}

// Wraps a tenant page: if the admin has disabled that feature, render the
// FeatureDisabled screen with the admin-written message instead of the page.
function FeatureGuard({ pageKey, children }) {
  const { getFlag } = useFeatureFlags();
  const flag = getFlag(pageKey);
  if (!flag.enabled) {
    return <FeatureDisabled featureKey={pageKey} message={flag.message} />;
  }
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LangProvider>
          <ToastProvider>
            <ErrorBoundary>
              <AppRoutes />
              <UpdateBanner />
            </ErrorBoundary>
          </ToastProvider>
        </LangProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function AppRoutes() {
  const { hydrated } = useAuth();

  if (!hydrated) {
    return <PageLoader />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<ThemeProvider><Landing /></ThemeProvider>} />
        <Route path="/admin/login.html" element={<Login />} />
        <Route path="/admin/change-password.html" element={<ChangePassword />} />
        <Route path="/admin/reset-password.html" element={<ResetPassword />} />
        <Route path="/admin/waiting-approval.html" element={<div className="text-center py-16"><h2>Waiting for approval</h2><p>Please wait for admin to approve your account.</p></div>} />
        <Route path="/admin/whatsapp-verification.html" element={<div className="text-center py-16"><h2>WhatsApp Verification</h2><p>Connect your WhatsApp to continue.</p></div>} />
        <Route path="/admin" element={<AuthGuard><Layout /></AuthGuard>}>
          <Route index element={<AdminIndex />} />
          <Route path="dashboard" element={<FeatureGuard pageKey="dashboard"><Dashboard /></FeatureGuard>} />
          <Route path="orders" element={<FeatureGuard pageKey="orders"><Orders /></FeatureGuard>} />
          <Route path="products" element={<FeatureGuard pageKey="products"><Products /></FeatureGuard>} />
          <Route path="business" element={<FeatureGuard pageKey="business"><Business /></FeatureGuard>} />
          <Route path="settings" element={<Navigate to="/admin/business" replace />} />
          <Route path="whatsapp" element={<FeatureGuard pageKey="whatsapp"><WhatsApp /></FeatureGuard>} />
          <Route path="broadcast" element={<FeatureGuard pageKey="broadcast"><Broadcast /></FeatureGuard>} />
          <Route path="expenses" element={<FeatureGuard pageKey="expenses"><Expenses /></FeatureGuard>} />
          <Route path="debts" element={<FeatureGuard pageKey="debts"><Debts /></FeatureGuard>} />
          <Route path="purchases" element={<FeatureGuard pageKey="purchases"><Purchases /></FeatureGuard>} />

          <Route path="staff" element={<FeatureGuard pageKey="staff"><Staff /></FeatureGuard>} />
          <Route path="notifications" element={<FeatureGuard pageKey="notifications"><Notifications /></FeatureGuard>} />
          <Route path="reports" element={<FeatureGuard pageKey="reports"><Reports /></FeatureGuard>} />
          <Route path="recycleBin" element={<FeatureGuard pageKey="recycleBin"><RecycleBin /></FeatureGuard>} />
          <Route path="adminPanel" element={<AdminPanel />} />
          <Route path="activityLog" element={<ActivityLog />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

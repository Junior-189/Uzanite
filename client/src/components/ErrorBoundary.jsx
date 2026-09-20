import { Component } from 'react';
import { useLang } from '../context/LangContext';

function ErrorBoundaryInner({ t, children }) {
  return <ErrorBoundaryClass t={t}>{children}</ErrorBoundaryClass>;
}

class ErrorBoundaryClass extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      const { t } = this.props;
      return (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('error_boundary.title')}</h2>
          <p className="text-gray-400 mb-5">{this.state.error?.message || t('error_boundary.message')}</p>
          <button
            className="bg-primary-600 text-white hover:bg-primary-700 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
          >
            {t('error_boundary.reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ErrorBoundary({ children }) {
  const { t } = useLang();
  return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>;
}

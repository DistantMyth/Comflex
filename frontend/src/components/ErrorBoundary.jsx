import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--color-bg-primary)]">
          <div className="glass-card max-w-md w-full p-8 text-center border border-[var(--color-border)] shadow-xl">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--color-warning)]/15 border border-[var(--color-warning)]/30 text-[var(--color-warning)] flex items-center justify-center">
              <AlertTriangle size={28} />
            </div>
            <h2 className="text-xl font-bold font-display mb-2 text-[var(--color-text-primary)]">
              Something went wrong
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">
              An unexpected error occurred while rendering this component.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
                className="btn btn-primary px-5 py-2.5 text-sm"
              >
                <RefreshCw size={15} /> Reload
              </button>
              <a
                href="/groups"
                className="btn btn-secondary px-5 py-2.5 text-sm"
              >
                <Home size={15} /> Dashboard
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

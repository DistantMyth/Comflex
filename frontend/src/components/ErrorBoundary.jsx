import React from 'react';

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
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 flex items-center justify-center text-3xl">
              ⚠️
            </div>
            <h2 className="text-xl font-bold font-display mb-2 text-[var(--color-text-primary)]">
              Something went wrong
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
              An unexpected error occurred while displaying this page.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
                className="btn btn-primary px-5 py-2.5 text-sm"
              >
                Reload Page
              </button>
              <a
                href="/groups"
                className="btn btn-secondary px-5 py-2.5 text-sm"
              >
                Go to Groups
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

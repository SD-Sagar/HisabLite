import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { tr } from '../i18n';

/**
 * A screen that breaks shows a way back instead of a blank white page. Without this, one bad row
 * anywhere took the whole app down, bottom menu and all.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('screen failed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const t = tr().crash;
    return (
      <div className="page crash">
        <section className="card crash-card">
          <h2>{t.title}</h2>
          <p className="muted">{t.help}</p>
          <button type="button" className="btn primary big block" onClick={() => window.location.reload()}>
            <RefreshCw size={20} /> {t.reload}
          </button>
          <button
            type="button"
            className="btn ghost block"
            onClick={() => {
              window.location.hash = '#/';
              window.location.reload();
            }}
          >
            {t.home}
          </button>
        </section>
      </div>
    );
  }
}

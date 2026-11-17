import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  isPermissionError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
    isPermissionError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    let parsedMessage = error.message || 'An unexpected application error occurred.';
    let isPermissionError = false;

    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error && parsed.operationType) {
        isPermissionError = parsed.error.toLowerCase().includes('permission');
        parsedMessage = `${parsed.operationType.toUpperCase()} on "${parsed.path ?? 'unknown'}" failed: ${parsed.error}`;
      }
    } catch {
      // Standard non-JSON Error
    }

    return {
      hasError: true,
      errorMessage: parsedMessage,
      isPermissionError,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('SnackFactory ErrorBoundary caught error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#D5E1E2] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#DCE6E6] rounded-[24px] p-8 shadow-sm">
            <div className="flex items-center gap-3 text-red-700 mb-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-lg font-semibold text-[#3B4F4E]">
                {this.state.isPermissionError ? 'Access Verification Required' : 'Application Error'}
              </h1>
            </div>
            <p className="text-sm text-[#6C7E7D] leading-relaxed mb-4">
              SnackFactory ERP encountered an error while communicating with the database service.
            </p>
            <div className="bg-[#EEF3F3] border border-[#DCE6E6] rounded-2xl p-3.5 mb-6">
              <p className="font-mono text-xs text-[#3B4F4E] break-words">{this.state.errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-full transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

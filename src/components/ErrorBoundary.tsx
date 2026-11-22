import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Khalad aan la filayn ayaa dhacay.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('maktabada.so ErrorBoundary caught error:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      let friendly = this.state.errorMessage;
      try {
        const parsed = JSON.parse(this.state.errorMessage) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed.error) {
          friendly = `${parsed.error} (${parsed.operationType || 'read'} · ${parsed.path || 'firestore'})`;
        }
      } catch {
        // Plain error string
      }

      return (
        <div className="min-h-screen bg-[#F8F6F1] text-[#1C1917] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#E5E0D5] rounded-xl p-8">
            <div className="flex items-center gap-3 text-[#991B1B] mb-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="font-serif text-xl font-semibold">Khalad Nidaamka Xogta ah</h2>
            </div>
            <p className="text-sm text-[#57534E] leading-relaxed mb-4">
              Waxaa dhacay cilad markii lala xiriirayay kaydka xogta Firebase. Fadlan dib u cusboonaysii ama hubi rukhsadda akoonkaaga.
            </p>
            <pre className="text-xs font-mono bg-[#F4F1EA] border border-[#E5E0D5] rounded-lg p-3 overflow-x-auto text-[#44403C] mb-6">
              {friendly}
            </pre>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#0F3F22] transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
              Isku day mar kale
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

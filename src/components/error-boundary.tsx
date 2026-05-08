import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("Page render failed", error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <div className="font-semibold text-destructive">This page failed to render.</div>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs">
          {this.state.error.stack || this.state.error.message}
        </pre>
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </Button>
      </div>
    );
  }
}

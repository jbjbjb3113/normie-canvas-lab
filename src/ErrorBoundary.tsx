import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ fontSize: "1.1rem" }}>Something broke</h1>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.85rem",
              background: "#f3f4f6",
              padding: "0.75rem",
              borderRadius: 6,
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

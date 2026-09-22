import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught Error caught by ErrorBoundary:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.error("Failed to clear storage:", e);
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          background: "#0a0e14",
          color: "#e8f0f8",
          fontFamily: "'Sora', sans-serif"
        }}>
          <div style={{
            maxWidth: "480px",
            width: "100%",
            background: "#161d28",
            border: "1px solid #2a3a50",
            borderRadius: "16px",
            padding: "28px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            textAlign: "center"
          }}>
            <div style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "rgba(240, 80, 96, 0.15)",
              color: "#f05060",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: "24px",
              fontWeight: "bold"
            }}>
              ⚠️
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px", color: "#ffffff" }}>
              Wystąpił nieoczekiwany błąd
            </h2>
            <p style={{ fontSize: "13px", color: "#8a9bb0", lineHeight: 1.6, marginBottom: "20px" }}>
              Aplikacja napotkała problem podczas ładowania danych. Możesz spróbować odświeżyć stronę lub zrestartować lokalną pamięć.
            </p>

            {this.state.error?.message && (
              <div style={{
                background: "#0d131c",
                border: "1px solid #1e2a38",
                borderRadius: "8px",
                padding: "10px 12px",
                fontSize: "11px",
                fontFamily: "'DM Mono', monospace",
                color: "#f05060",
                textAlign: "left",
                marginBottom: "20px",
                wordBreak: "break-word",
                maxHeight: "100px",
                overflowY: "auto"
              }}>
                {this.state.error.message}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                onClick={this.handleReload}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  background: "#00c896",
                  color: "#0a0e14",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor: "pointer",
                  fontFamily: "'Sora', sans-serif"
                }}>
                Odśwież stronę
              </button>

              <button
                onClick={this.handleClearAndReload}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  background: "transparent",
                  border: "1px solid #2a3a50",
                  color: "#8a9bb0",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontFamily: "'Sora', sans-serif"
                }}>
                Wyczyść pamięć podręczną i odśwież
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

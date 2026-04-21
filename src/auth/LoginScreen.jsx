import { useState } from "react";
import { supabase } from "../supabaseClient";

const cardStyle = {
  maxWidth: 420,
  width: "100%",
  background: "#0d1520",
  border: "1px solid #1e2a38",
  borderRadius: 16,
  padding: "32px 28px",
  boxShadow: "0 20px 60px rgba(0,0,0,.4)",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  background: "#0a1018",
  border: "1px solid #1e2a38",
  color: "#e8edf3",
  fontSize: 14,
  fontFamily: "'DM Mono', monospace",
  boxSizing: "border-box",
};

const primaryBtn = {
  width: "100%",
  padding: "11px 16px",
  borderRadius: 8,
  background: "#00c896",
  color: "#000",
  fontWeight: 700,
  fontSize: 13,
  border: "none",
  cursor: "pointer",
  fontFamily: "'Sora', sans-serif",
  letterSpacing: ".04em",
};

const linkBtn = {
  background: "none",
  border: "none",
  color: "#6b7f96",
  cursor: "pointer",
  fontSize: 12,
  textDecoration: "underline",
  padding: 0,
  fontFamily: "'DM Mono', monospace",
};

const tabBtn = (active) => ({
  flex: 1,
  padding: "10px 12px",
  background: "none",
  border: "none",
  borderBottom: active ? "2px solid #00c896" : "2px solid transparent",
  color: active ? "#e8edf3" : "#6b7f96",
  fontSize: 12,
  letterSpacing: ".1em",
  fontFamily: "'DM Mono', monospace",
  cursor: "pointer",
  textTransform: "uppercase",
});

export default function LoginScreen() {
  const [mode, setMode] = useState("password"); // "password" | "magic"
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  function resetStatus() {
    setMessage(null);
    setError(null);
  }

  async function handleGoogle() {
    resetStatus();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function handlePassword(e) {
    e.preventDefault();
    resetStatus();
    setBusy(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMessage("Wysłaliśmy link weryfikacyjny na twój email. Sprawdź skrzynkę.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message || "Coś poszło nie tak. Spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMagic(e) {
    e.preventDefault();
    resetStatus();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setMessage("Link do logowania został wysłany na twój email.");
    } catch (err) {
      setError(err.message || "Nie udało się wysłać linku. Spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!email) {
      setError("Podaj email, na który ma zostać wysłany reset hasła.");
      return;
    }
    resetStatus();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setMessage("Link do resetu hasła został wysłany na email.");
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      background: "#0a0f17",
    }}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: ".18em", color: "#4a5a6e", fontFamily: "'DM Mono', monospace" }}>
            PORTFOLIO TRACKER
          </div>
          <div style={{ fontSize: 18, color: "#e8edf3", marginTop: 8, fontFamily: "'Sora', sans-serif", fontWeight: 600 }}>
            {isSignup ? "Stwórz konto" : "Zaloguj się"}
          </div>
          <div style={{ fontSize: 12, color: "#6b7f96", marginTop: 4 }}>
            Twoje dane synchronizowane między urządzeniami.
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          style={{
            width: "100%",
            padding: "11px 16px",
            borderRadius: 8,
            background: "#e8edf3",
            color: "#0a0f17",
            fontWeight: 600,
            fontSize: 13,
            border: "none",
            cursor: busy ? "wait" : "pointer",
            fontFamily: "'Sora', sans-serif",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Kontynuuj z Google
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#1e2a38" }} />
          <div style={{ fontSize: 10, color: "#4a5a6e", letterSpacing: ".15em", fontFamily: "'DM Mono', monospace" }}>LUB</div>
          <div style={{ flex: 1, height: 1, background: "#1e2a38" }} />
        </div>

        <div style={{ display: "flex", marginBottom: 16 }}>
          <button type="button" onClick={() => { setMode("password"); resetStatus(); }} style={tabBtn(mode === "password")}>
            Hasło
          </button>
          <button type="button" onClick={() => { setMode("magic"); resetStatus(); }} style={tabBtn(mode === "magic")}>
            Magic link
          </button>
        </div>

        {mode === "password" ? (
          <form onSubmit={handlePassword}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@przyklad.pl"
                required
                autoComplete="email"
                style={inputStyle}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="hasło"
                required
                minLength={6}
                autoComplete={isSignup ? "new-password" : "current-password"}
                style={inputStyle}
              />
              <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
                {busy ? "..." : isSignup ? "Zarejestruj się" : "Zaloguj się"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => { setIsSignup(v => !v); resetStatus(); }} style={linkBtn}>
                {isSignup ? "Mam już konto" : "Nie mam konta — rejestracja"}
              </button>
              {!isSignup && (
                <button type="button" onClick={handleReset} style={linkBtn}>
                  Zapomniałem hasła
                </button>
              )}
            </div>
          </form>
        ) : (
          <form onSubmit={handleMagic}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@przyklad.pl"
                required
                autoComplete="email"
                style={inputStyle}
              />
              <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}>
                {busy ? "..." : "Wyślij link logowania"}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#5a6a7e", marginTop: 12, lineHeight: 1.5 }}>
              Klikniesz w link w mailu i zalogujesz się bez hasła.
            </div>
          </form>
        )}

        {error && (
          <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 8, background: "#2a0a0a", border: "1px solid #5a1a1a", color: "#e05555", fontSize: 12 }}>
            {error}
          </div>
        )}
        {message && (
          <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 8, background: "#0d3a28", border: "1px solid #1a5a40", color: "#00c896", fontSize: 12 }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { useAuth } from "./AuthProvider";

export default function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!user) return null;
  const email = user.email || "użytkownik";
  const initial = email[0]?.toUpperCase() || "?";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={email}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "#1e2a38",
          border: "1px solid #2a3a50",
          color: "#e8edf3",
          fontWeight: 700,
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "'Sora', sans-serif",
        }}
      >
        {initial}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 40,
            right: 0,
            minWidth: 220,
            background: "#0d1520",
            border: "1px solid #1e2a38",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,.5)",
            zIndex: 100,
          }}
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid #1e2a38", marginBottom: 4 }}>
            <div style={{ fontSize: 10, color: "#4a5a6e", letterSpacing: ".12em", fontFamily: "'DM Mono', monospace" }}>
              ZALOGOWANY JAKO
            </div>
            <div style={{ fontSize: 12, color: "#e8edf3", marginTop: 2, wordBreak: "break-all" }}>
              {email}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); signOut(); }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              background: "none",
              border: "none",
              color: "#e05555",
              cursor: "pointer",
              fontSize: 13,
              borderRadius: 6,
              fontFamily: "'Sora', sans-serif",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#1e2a38"}
            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
          >
            Wyloguj się
          </button>
        </div>
      )}
    </div>
  );
}

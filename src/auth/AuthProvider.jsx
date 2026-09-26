import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { AUTH_BYPASS, SANDBOX_USER } from "../devMode";

const AuthContext = createContext(null);

const SANDBOX_AUTH = { session: null, user: SANDBOX_USER, loading: false, signOut: () => {} };

export function AuthProvider({ children }) {
  if (AUTH_BYPASS) return <AuthContext.Provider value={SANDBOX_AUTH}>{children}</AuthContext.Provider>;
  return <SupabaseAuthProvider>{children}</SupabaseAuthProvider>;
}

function SupabaseAuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signOut: () => supabase.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth musi być użyty wewnątrz <AuthProvider>");
  return ctx;
}

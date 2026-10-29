import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabase, requireSupabase, supabase } from "./supabase";
interface AuthState {
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(isSupabase);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (alive) {
        setSession(error ? null : data.session);
        if (!data.session || error) setLoading(false);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) {
        setAdmin(false);
        setSession(next);
        setLoading(!!next);
      }
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!session || !supabase) {
      setAdmin(false);
      setLoading(false);
      return;
    }
    let alive = true;
    const checkRole = () => {
      void supabase!.rpc("is_admin").then(({ data, error }) => {
        if (alive) {
          setAdmin(!error && data === true);
          setLoading(false);
        }
      });
    };
    checkRole();
    const timer = setInterval(checkRole, 30000);
    window.addEventListener("focus", checkRole);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", checkRole);
    };
  }, [session]);
  const signIn = async (email: string, password: string) => {
    const client = requireSupabase();
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error)
      return "Не удалось войти. Проверьте email и пароль или обратитесь к владельцу салона.";
    const { data, error: roleError } = await client.rpc("is_admin");
    if (roleError || data !== true) {
      await client.auth.signOut({ scope: "local" });
      return "У этой учётной записи нет прав администратора. Права выдаёт владелец проекта.";
    }
    return null;
  };
  const signOut = async () => {
    setAdmin(false);
    setSession(null);
    await requireSupabase().auth.signOut({ scope: "local" });
  };
  return (
    <Context.Provider value={{ session, isAdmin, loading, signIn, signOut }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}

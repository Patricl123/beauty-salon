import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import type { AppData, Appointment, NotificationEvent, Status, CatalogKind, CatalogAction } from "../types";
import { applyDemoCatalogAction } from "./catalog";
import { createSeed } from "../data/seed";
import { isAvailable } from "./schedule";
import { makeNotifications } from "./notifications";
import { repository, STORAGE_KEY } from "./repository";
import { cloudRepository } from "./cloudRepository";
import { isSupabase } from "./supabase";
import { apiError } from "./apiErrors";
import { useAuth } from "./auth";
type Result =
  { ok: true; appointment: Appointment } | { ok: false; error: string };
interface Store {
  data: AppData;
  error: string;
  loading: boolean;
  saving: boolean;
  catalogAction: (kind: CatalogKind, id: string, action: CatalogAction, revision: number) => Promise<string | null>;
  update: (
    fn: (data: AppData) => AppData,
    allowConflicts?: boolean,
  ) => Promise<boolean>;
  book: (
    a: Appointment,
    consent?: boolean,
    captchaToken?: string,
  ) => Promise<Result>;
  setStatus: (id: string, status: Status) => Promise<boolean>;
  refresh: () => Promise<void>;
  reset: () => void;
}
const Context = createContext<Store | null>(null);
function emptyCloudData(): AppData {
  const seed = createSeed();
  return {
    ...seed,
    services: [],
    masters: [],
    appointments: [],
    blocks: [],
    notifications: [],
    clientNotes: {},
    revision: 0,
  };
}
export function StoreProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const adminScope =
    isSupabase && auth.isAdmin && location.pathname.startsWith("/admin");
  const scope = `${adminScope ? auth.session?.user.id : "public"}`;
  const [state, setState] = useState<{ scope: string; data: AppData }>(() => {
    if (isSupabase) return { scope, data: emptyCloudData() };
    try {
      return { scope, data: repository.read() };
    } catch {
      return { scope, data: createSeed() };
    }
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(isSupabase);
  const [saving, setSaving] = useState(false);
  const current = useRef(state.data);
  const writeLock = useRef(false);
  const generation = useRef(0);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const visibleData = state.scope === scope ? state.data : emptyCloudData();
  const commit = useCallback(
    (data: AppData, expectedScope = activeScope.current) => {
      if (activeScope.current !== expectedScope) return;
      current.current = data;
      setState({ scope: expectedScope, data });
    },
    [],
  );
  const refresh = useCallback(async () => {
    if (!isSupabase || activeScope.current !== scope) return;
    const ticket = ++generation.current;
    try {
      const data = await cloudRepository.read(adminScope);
      if (ticket === generation.current && activeScope.current === scope) {
        commit(data, scope);
        setError("");
      }
    } catch (e) {
      if (ticket === generation.current && activeScope.current === scope) {
        if (adminScope && (e as { code?: string })?.code === "42501")
          commit(emptyCloudData(), scope);
        setError(apiError(e));
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [adminScope, scope, commit]);
  useEffect(() => {
    if (isSupabase) {
      setLoading(true);
      void refresh();
      return () => {
        generation.current++;
      };
    }
    try {
      if (!localStorage.getItem(STORAGE_KEY)) repository.write(current.current);
    } catch {
      setError(
        "Браузер запретил localStorage. Данные демоверсии сохраняются только в памяти.",
      );
    }
    const sync = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        try {
          commit(repository.read());
        } catch {
          setError("Не удалось прочитать демоданные из другой вкладки.");
        }
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [refresh, commit]);
  useEffect(() => {
    if (!isSupabase) return;
    const sync = () => {
      if (!writeLock.current && document.visibilityState === "visible")
        void refresh();
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    const timer = setInterval(sync, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [refresh]);
  const saveDemo = (next: AppData) => {
    try {
      repository.write(next);
      setError("");
    } catch {
      setError(
        "Не удалось сохранить демоданные в браузере. Они доступны до перезагрузки.",
      );
    }
    commit(next);
  };
  const begin = () => {
    if (writeLock.current) return false;
    writeLock.current = true;
    generation.current++;
    setSaving(true);
    setError("");
    return true;
  };
  const end = () => {
    writeLock.current = false;
    setSaving(false);
  };
  const update: Store["update"] = async (fn, allowConflicts = false) => {
    if (!begin()) return false;
    try {
      const before = current.current,
        next = fn(before);
      if (isSupabase) {
        if (!adminScope) throw { message: "ADMIN_REQUIRED" };
        commit(
          await cloudRepository.update(before, next, allowConflicts),
          scope,
        );
      } else saveDemo(next);
      return true;
    } catch (e) {
      const message = apiError(e);
      await refresh();
      setError(message);
      return false;
    } finally {
      end();
    }
  };
  const book: Store["book"] = async (a, consent = false, captchaToken) => {
    if (!begin())
      return { ok: false, error: "Запрос уже выполняется. Дождитесь ответа." };
    try {
      const state = current.current,
        old = state.appointments.find((item) => item.id === a.id);
      if (isSupabase) {
        const saved = await cloudRepository.book(
          a,
          !!old,
          consent,
          captchaToken,
        );
        commit(
          {
            ...state,
            revision: (state.revision || 0) + 1,
            appointments: [
              ...state.appointments.filter((item) => item.id !== saved.id),
              saved,
            ],
          },
          scope,
        );
        await refresh();
        return { ok: true, appointment: saved };
      }
      const service = state.services.find((s) => s.id === a.serviceId),
        master = state.masters.find((m) => m.id === a.masterId);
      if (
        !service ||
        !master ||
        !isAvailable(
          state,
          { ...service, duration: a.duration },
          master,
          a.date,
          a.time,
          a.id,
        )
      )
        return {
          ok: false,
          error:
            "Это время уже недоступно. Пожалуйста, выберите другое окошко.",
        };
      const event: NotificationEvent = old ? "rescheduled" : "created";
      saveDemo({
        ...state,
        appointments: old
          ? state.appointments.map((item) => (item.id === a.id ? a : item))
          : [...state.appointments, a],
        notifications: [
          ...state.notifications.filter(
            (n) => !(n.appointmentId === a.id && n.planned),
          ),
          ...makeNotifications(state, a, event),
        ],
      });
      return { ok: true, appointment: a };
    } catch (e) {
      const message = apiError(e);
      await refresh();
      setError(message);
      return { ok: false, error: message };
    } finally {
      end();
    }
  };
  const setStatus: Store["setStatus"] = async (id, status) => {
    if (!begin()) return false;
    try {
      const state = current.current,
        a = state.appointments.find((item) => item.id === id);
      if (!a) return false;
      if (isSupabase) {
        const saved = await cloudRepository.setStatus(a, status);
        commit(
          {
            ...state,
            revision: (state.revision || 0) + 1,
            appointments: state.appointments.map((item) =>
              item.id === id ? saved : item,
            ),
          },
          scope,
        );
        await refresh();
        return true;
      }
      if (
        (a.status === "cancelled" || a.status === "noshow") &&
        status !== "cancelled" &&
        status !== "noshow"
      ) {
        const s = state.services.find((s) => s.id === a.serviceId),
          m = state.masters.find((m) => m.id === a.masterId);
        if (
          !s ||
          !m ||
          !isAvailable(
            state,
            { ...s, duration: a.duration },
            m,
            a.date,
            a.time,
            id,
          )
        )
          return false;
      }
      saveDemo({
        ...state,
        appointments: state.appointments.map((item) =>
          item.id === id ? { ...item, status } : item,
        ),
        notifications: [
          ...state.notifications.filter(
            (n) => !(n.appointmentId === id && n.planned),
          ),
          ...(status === "cancelled" || status === "confirmed"
            ? makeNotifications(state, a, status)
            : []),
        ],
      });
      return true;
    } catch (e) {
      const message = apiError(e);
      await refresh();
      setError(message);
      return false;
    } finally {
      end();
    }
  };
  const reset = () => {
    if (isSupabase) {
      setError("Сброс серверных данных через сайт запрещён.");
      return;
    }
    saveDemo(createSeed());
  };
  const catalogAction: Store["catalogAction"] = async (kind, id, action, revision) => {
    if (!begin()) return "Дождитесь завершения сохранения.";
    try {
      if (isSupabase) {
        if (!adminScope) throw { message: "ADMIN_REQUIRED" };
        commit(await cloudRepository.catalogAction(kind, id, action, revision), scope);
      } else saveDemo(applyDemoCatalogAction(current.current, kind, id, action, revision));
      return null;
    } catch (e) {
      const message = apiError(e);
      await refresh();
      setError(message);
      return message;
    } finally { end(); }
  };
  return (
    <Context.Provider
      value={{
        data: visibleData,
        error,
        loading: loading || state.scope !== scope,
        saving,
        catalogAction,
        update,
        book,
        setStatus,
        refresh,
        reset,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStore() {
  const context = useContext(Context);
  if (!context) throw new Error("StoreProvider is missing");
  return context;
}

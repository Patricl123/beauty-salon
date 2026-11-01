import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { StoreProvider, useStore } from "./lib/store";
import { Header } from "./components/Header";
import { Booking } from "./components/Booking";
import { Loading, Toast } from "./components/UI";
import { Home } from "./pages/Home";
import { MyBookings } from "./pages/MyBookings";
import { AuthProvider } from "./lib/auth";
import { isSupabase } from "./lib/supabase";
import { SiteContentProvider } from "./lib/siteContent";
import type { BookingPreset } from "./types";
const Admin = lazy(() =>
  import("./pages/Admin").then((m) => ({ default: m.Admin })),
);
function Site() {
  const [booking, setBooking] = useState<BookingPreset | null>(null);
  const [toast, setToast] = useState("");
  const location = useLocation();
  const { error, data, loading, refresh } = useStore();
  const onBook = (preset: BookingPreset = {}) => {
    if (!loading) setBooking(preset);
  };
  const closeToast = useCallback(() => setToast(""), []);
  useEffect(() => {
    document.title = `${data.settings.name} — ${location.pathname === "/admin" ? "Админ-панель" : location.pathname === "/bookings" ? "Мои записи" : data.settings.tagline}`;
    if (!location.hash) window.scrollTo({ top: 0 });
    else {
      const id = location.hash.slice(1);
      setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50);
    }
  }, [
    location.pathname,
    location.hash,
    data.settings.name,
    data.settings.tagline,
  ]);
  return (
    <>
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>
      {!location.pathname.startsWith("/admin") && (
        <Header onBook={() => onBook()} />
      )}{" "}
      {error && (
        <div role="alert" className="storage-error">
          {error}{" "}
          <button className="text-link" onClick={() => void refresh()}>
            Повторить загрузку
          </button>
        </div>
      )}
      <div id="main-content">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home onBook={onBook} />} />
            <Route
              path="/bookings"
              element={<MyBookings onBook={onBook} onMessage={setToast} />}
            />
            <Route
              path="/admin"
              element={<Admin onBook={onBook} onMessage={setToast} />}
            />
            <Route
              path="*"
              element={
                <main className="container empty">
                  <h1>Страница не найдена</h1>
                  <Link className="button button-dark" to="/">
                    Вернуться в VIAVERDE
                  </Link>
                </main>
              }
            />
          </Routes>
        </Suspense>
      </div>
      {booking && (
        <Booking
          preset={booking}
          onClose={() => setBooking(null)}
          onSuccess={setToast}
        />
      )}{" "}
      {toast && <Toast message={toast} onClose={closeToast} />}
    </>
  );
}
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }
  render() {
    if (this.state.failed)
      return (
        <main className="container empty">
          <h1>Не удалось открыть страницу</h1>
          <p>
            {isSupabase
              ? "Перезагрузите страницу. Если ошибка повторяется, обратитесь к администратору салона."
              : "Перезагрузите страницу. Если ошибка повторяется, восстановите демонстрационные данные."}
          </p>
          <button
            className="button button-dark"
            onClick={() => window.location.reload()}
          >
            Перезагрузить
          </button>
          {!isSupabase && (
            <button
              className="button button-light"
              onClick={() => {
                if (
                  window.confirm(
                    "Удалить сохранённые демоданные и восстановить начальные?",
                  )
                ) {
                  localStorage.removeItem("aura-beauty-demo-v1");
                  window.location.href = "/";
                }
              }}
            >
              Восстановить демоданные
            </button>
          )}
        </main>
      );
    return this.props.children;
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <StoreProvider>
            <SiteContentProvider>
              <Site />
            </SiteContentProvider>
          </StoreProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

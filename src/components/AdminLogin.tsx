import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LockKeyhole, ArrowUpRight } from "lucide-react";
import { Brand } from "./UI";
import { useAuth } from "../lib/auth";
export function AdminLogin() {
  const { signIn, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  return (
    <main className="admin-login">
      <div className="login-card">
        <Brand />
        <span className="login-icon">
          <LockKeyhole size={30} strokeWidth={1} />
        </span>
        <div className="eyebrow">ПРОСТРАНСТВО КОМАНДЫ</div>
        <h1>
          За кулисами
          <br />
          <em>красоты</em>
        </h1>
        <p>Вход для администратора салона.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (locked.current) return;
            locked.current = true;
            setBusy(true);
            setError("");
            try {
              const message = await signIn(email, password);
              if (message) setError(message);
            } catch {
              setError(
                "Не удалось подключиться. Проверьте соединение и повторите вход.",
              );
            } finally {
              setPassword("");
              setBusy(false);
              locked.current = false;
            }
          }}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="button button-dark booking-next"
            type="submit"
            disabled={busy || loading}
          >
            {busy || loading ? "Проверяем доступ…" : "Войти"}
            <ArrowUpRight size={18} />
          </button>
        </form>
        <div className="demo-login-notice">
          Учётную запись создаёт владелец салона. Самостоятельная регистрация
          администраторов закрыта.
        </div>
        <Link to="/" className="text-link">
          Вернуться на сайт
        </Link>
      </div>
      <div className="login-image">
        <img src="/images/salon.jpg" alt="Интерьер салона" />
        <span>
          Забота начинается
          <br />с порядка.
        </span>
      </div>
    </main>
  );
}

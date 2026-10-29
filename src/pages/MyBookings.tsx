import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useStore } from "../lib/store";
import { instant } from "../lib/schedule";
import type { Appointment, BookingPreset } from "../types";
import { AppointmentCard } from "../components/AppointmentCard";
import { Empty } from "../components/UI";
import { isSupabase } from "../lib/supabase";
import { parseManagementCode, rememberAccess } from "../lib/guestAccess";
import { rpc } from "../lib/cloudRepository";
import { apiError } from "../lib/apiErrors";
export function MyBookings({
  onBook,
  onMessage,
}: {
  onBook: (p?: BookingPreset) => void;
  onMessage: (s: string) => void;
}) {
  const { data, refresh, loading } = useStore();
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const appointments = data.appointments
    .filter((a) => isSupabase || a.owner === "visitor")
    .filter((a) => {
      const upcoming =
        instant(a.date, a.time) > new Date() &&
        ["pending", "confirmed", "arrived"].includes(a.status);
      return tab === "upcoming" ? upcoming : !upcoming;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return (
    <main className="container bookings-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={17} /> На главную
      </Link>
      <div className="eyebrow">ВАШИ МАЛЕНЬКИЕ РИТУАЛЫ</div>
      <h1>
        Мои <em>записи</em>
      </h1>
      <p className="subtle">
        {isSupabase
          ? "Записи, к которым у вас есть персональный код управления. По одному номеру телефона доступ получить нельзя."
          : "Демонстрационные записи этого браузера. Проверка телефона и авторизация пока не подключены."}
      </p>
      {isSupabase && (
        <form
          className="admin-form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const parsed = parseManagementCode(code);
            if (!parsed) {
              setError(
                "Введите полный персональный код с экрана подтверждения.",
              );
              return;
            }
            setBusy(true);
            setError("");
            try {
              await rpc<Appointment>("get_appointment", {
                p_id: parsed.id,
                p_manage_token: parsed.token,
              });
              rememberAccess(parsed.id, parsed.token);
              setCode("");
              await refresh();
              onMessage("Запись найдена.");
            } catch (e) {
              setError(apiError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Код управления записью
            <input
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              placeholder="Вставьте сохранённый код"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? "Проверяем…" : "Открыть запись"}
          </button>
        </form>
      )}
      <div className="category-tabs">
        <button
          className={tab === "upcoming" ? "active" : ""}
          onClick={() => setTab("upcoming")}
        >
          Предстоящие
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          История и отменённые
        </button>
      </div>
      <div className="bookings-grid">
        {loading ? (
          <p className="subtle" role="status">
            Загружаем записи…
          </p>
        ) : (
          appointments.map((a) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              onBook={onBook}
              onMessage={onMessage}
            />
          ))
        )}
        {!loading && !appointments.length && (
          <Empty
            title={
              tab === "upcoming"
                ? "Самое время позаботиться о себе"
                : "История пока пуста"
            }
          >
            <p>
              {isSupabase
                ? "Оформите запись или откройте её по персональному коду."
                : "Ваши демонстрационные записи появятся здесь."}
            </p>
            <button className="button button-dark" onClick={() => onBook()}>
              Записаться
            </button>
          </Empty>
        )}
      </div>
    </main>
  );
}

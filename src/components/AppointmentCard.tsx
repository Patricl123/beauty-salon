import { useState } from "react";
import { CalendarDays, Clock3, UserRound } from "lucide-react";
import type { Appointment, BookingPreset } from "../types";
import { useStore } from "../lib/store";
import { money, statuses } from "../i18n";
import { clock, dateLabel, instant, minutes } from "../lib/schedule";
import { isSupabase } from "../lib/supabase";
import { ManagementCode } from "./ManagementCode";
import { downloadCalendar } from "../lib/calendar";
export function AppointmentCard({
  appointment: a,
  onBook,
  onMessage,
}: {
  appointment: Appointment;
  onBook: (p: BookingPreset) => void;
  onMessage: (s: string) => void;
}) {
  const { data, setStatus, saving } = useStore();
  const [cancel, setCancel] = useState(false);
  const upcoming =
    instant(a.date, a.time) > new Date() &&
    ["pending", "confirmed"].includes(a.status);
  return (
    <article className="appointment-card">
      <div className="appointment-top">
        <span className="eyebrow">№ {a.id}</span>
        <span className={`status status-${a.status}`}>
          {statuses[a.status]}
        </span>
      </div>
      <h3>{a.serviceName}</h3>
      <div className="appointment-meta">
        <span>
          <CalendarDays size={17} />
          {dateLabel(a.date, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
        <span>
          <Clock3 size={17} />
          {a.time}–{clock(minutes(a.time) + a.duration)} · Бишкек
        </span>
        <span>
          <UserRound size={17} />
          {data.masters.find((m) => m.id === a.masterId)?.name || a.masterName}
        </span>
      </div>
      <strong>{money(a.price)}</strong>
      {isSupabase && <ManagementCode id={a.id} />}{" "}
      {upcoming && (
        <div className="appointment-actions">
          <button
            className="button button-light"
            onClick={() => downloadCalendar(a, data)}
          >
            <CalendarDays size={16} /> В календарь
          </button>
          <button
            className="button button-light"
            onClick={() => onBook({ editId: a.id })}
          >
            Перенести
          </button>
          <button className="danger-text" onClick={() => setCancel(true)}>
            Отменить
          </button>
        </div>
      )}
      {cancel && (
        <div className="confirm-inline" role="alert">
          <p>Отменить запись? Это время станет доступно другим.</p>
          <button
            className="button button-danger"
            disabled={saving}
            onClick={async () => {
              if (!(await setStatus(a.id, "cancelled"))) return;
              setCancel(false);
              onMessage(
                isSupabase ? "Запись отменена." : "Демозапись отменена.",
              );
            }}
          >
            Да, отменить запись
          </button>
          <button
            className="button button-light"
            onClick={() => setCancel(false)}
          >
            Сохранить запись
          </button>
        </div>
      )}
    </article>
  );
}

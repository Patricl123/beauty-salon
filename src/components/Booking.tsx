import { useRef, useState } from "react";
import { MasterImage } from "./SiteImage";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  UserRound,
} from "lucide-react";
import { useStore } from "../lib/store";
import type { Appointment, BookingPreset } from "../types";
import { categories, durationLabel, money, weekdays } from "../i18n";
import {
  addDays,
  clock,
  dateLabel,
  minutes,
  today,
  weekday,
} from "../lib/schedule";
import { downloadCalendar } from "../lib/calendar";
import { useAvailability } from "../lib/useAvailability";
import { isSupabase } from "../lib/supabase";
import { ManagementCode } from "./ManagementCode";
import { Turnstile } from "./Turnstile";
import { useAuth } from "../lib/auth";
import { apiError } from "../lib/apiErrors";
import { Arrow, Empty, Modal } from "./UI";
const steps = ["Услуга", "Мастер", "Дата и время", "Контакты", "Подтверждение"];
export function Booking({
  preset,
  onClose,
  onSuccess,
}: {
  preset: BookingPreset;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { data, book, setStatus, saving } = useStore();
  const auth = useAuth();
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [resultId, setResultId] = useState("");
  const existing = data.appointments.find(
    (a) => a.id === (resultId || preset.editId),
  );
  const needsCaptcha = isSupabase && !auth.isAdmin && !existing;
  const [serviceId, setServiceId] = useState(
    existing?.serviceId || preset.serviceId || "",
  );
  const [masterId, setMasterId] = useState(
    existing?.masterId || preset.masterId || "any",
  );
  const [date, setDate] = useState(existing?.date || preset.date || today());
  const [month, setMonth] = useState(
    (existing?.date || preset.date || today()).slice(0, 7),
  );
  const [time, setTime] = useState(existing ? "" : preset.time || "");
  const [selectedMaster, setSelectedMaster] = useState(
    existing?.masterId || preset.masterId || "",
  );
  const [step, setStep] = useState(
    existing ? 2 : preset.time ? 3 : preset.serviceId ? 1 : 0,
  );
  const [name, setName] = useState(existing?.clientName || "");
  const [phone, setPhone] = useState(existing?.phone || "+996");
  const [comment, setComment] = useState(existing?.comment || "");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cancel, setCancel] = useState(false);
  const service = data.services.find((s) => s.id === serviceId);
  const master = data.masters.find(
    (m) => m.id === (selectedMaster || masterId),
  );
  const eligible = data.masters.filter((m) => !m.archived && m.serviceIds.includes(serviceId));
  const availability = useAvailability(serviceId, masterId, date, existing?.id);
  const available = availability.slots;
  const result = data.appointments.find((a) => a.id === resultId);
  const resetTime = () => {
    setTime("");
    setSelectedMaster("");
    setErrors({});
  };
  const chooseDate = (next: string) => {
    setDate(next);
    setMonth(next.slice(0, 7));
    resetTime();
  };
  const submit = async () => {
    if (submitLock.current || saving) return;
    const err: Record<string, string> = {};
    if (name.trim().length < 2)
      err.name = "Введите имя — не менее двух символов.";
    const cleanPhone = phone.replace(/[\s()-]/g, "");
    if (!/^\+996\d{9}$/.test(cleanPhone))
      err.phone = "Нужен код +996 и 9 цифр, например +996 000 000 001.";
    if (!consent) err.consent = "Подтвердите согласие на обработку данных.";
    if (needsCaptcha && !captchaToken)
      err.global = "Пройдите проверку защиты от ботов перед записью.";
    setErrors(err);
    if (Object.keys(err).length || !service) return;
    const chosen =
      isSupabase && time && selectedMaster
        ? { time, masterId: selectedMaster }
        : available.find(
            (s) => s.time === time && s.masterId === selectedMaster,
          );
    if (!chosen) {
      setErrors({
        global:
          "Окошко уже занято или график изменился. Выберите другое время.",
      });
      setStep(2);
      return;
    }
    const appointment: Appointment = {
      id: existing?.id || `A-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      serviceId,
      serviceName: service.name,
      masterId: chosen.masterId,
      date,
      time,
      duration: service.duration,
      price: service.price,
      clientName: name.trim(),
      phone: cleanPhone,
      comment: comment.trim(),
      status: existing?.status === "confirmed" ? "confirmed" : "pending",
      owner: existing?.owner || (preset.admin ? "salon" : "visitor"),
      createdAt: existing?.createdAt || new Date().toISOString(),
      version: existing?.version,
    };
    submitLock.current = true;
    setSubmitting(true);
    const outcome = await book(appointment, consent, captchaToken);
    setCaptchaToken("");
    setCaptchaAttempt((n) => n + 1);
    submitLock.current = false;
    setSubmitting(false);
    if (!outcome.ok) {
      setErrors({ global: outcome.error });
      return;
    }
    setResultId(outcome.appointment.id);
    setStep(4);
    onSuccess(
      existing
        ? "Запись перенесена. Старое время снова свободно."
        : isSupabase
          ? "Запись создана."
          : "Демонстрационная запись создана.",
    );
  };
  const moveMonth = (direction: number) => {
    const d = new Date(`${month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + direction);
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthStart = `${month}-01`;
  const leading = (weekday(monthStart) + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  ).getUTCDate();
  const firstMinute = Math.ceil(minutes(data.settings.start) / 30) * 30;
  const allTimes = Array.from(
    {
      length: Math.max(
        0,
        Math.ceil((minutes(data.settings.end) - firstMinute) / 30),
      ),
    },
    (_, i) => clock(firstMinute + i * 30),
  );
  return (
    <Modal
      wide
      title={
        existing
          ? "Перенести запись"
          : preset.admin
            ? "Запись по телефону"
            : "Время для себя"
      }
      onClose={() => {
        if (!submitting && !saving) onClose();
      }}
    >
      <div className="booking-demo">
        {isSupabase
          ? "Запись будет подтверждена сервером. Сохраните персональный код для переноса и отмены."
          : "Это демоверсия. Не вводите настоящие персональные данные."}
      </div>
      <ol className="booking-steps">
        {steps.map((label, i) => (
          <li
            key={label}
            className={i === step ? "current" : i < step ? "done" : ""}
            aria-current={i === step ? "step" : undefined}
          >
            <span>{i < step ? <Check size={13} /> : i + 1}</span>
            <b>{label}</b>
          </li>
        ))}
      </ol>
      {step < 4 && (
        <div className="booking-summary">
          <div>
            <span>Ваш выбор</span>
            <strong>{service?.name || "Выберите услугу"}</strong>
            <small>
              {master?.name
                ? `Мастер: ${master.name}`
                : "Любой свободный мастер"}
              {time ? ` · ${dateLabel(date)} · ${time}` : ""}
            </small>
          </div>
          {service && (
            <div className="summary-price">
              <strong>{money(service.price)}</strong>
              <small>
                <Clock3 size={13} />
                {durationLabel(service.duration)}
              </small>
            </div>
          )}
        </div>
      )}
      {availability.error && (
        <p className="form-error" role="alert">
          {availability.error}
        </p>
      )}
      {errors.global && (
        <p className="form-error global-error" role="alert">
          {errors.global}
        </p>
      )}
      <div className="booking-body">
        {step === 0 && (
          <>
            <h3>С чего начнём?</h3>
            <p className="subtle">Выберите свой ритуал красоты.</p>
            {Object.entries(categories).map(([id, label]) => {
              const list = data.services.filter(
                (s) =>
                  s.active && !s.archived &&
                  s.category === id &&
                  (!preset.masterId ||
                    data.masters
                      .find((m) => m.id === preset.masterId)
                      ?.serviceIds.includes(s.id)),
              );
              return list.length ? (
                <div className="booking-category" key={id}>
                  <h4>{label}</h4>
                  {list.map((s) => (
                    <button
                      className={`choice service-choice ${serviceId === s.id ? "selected" : ""}`}
                      key={s.id}
                      onClick={() => {
                        setServiceId(s.id);
                        if (
                          !data.masters
                            .find((m) => m.id === masterId)
                            ?.serviceIds.includes(s.id)
                        )
                          setMasterId("any");
                        resetTime();
                        setStep(1);
                      }}
                    >
                      <span>
                        <strong>{s.name}</strong>
                        <small>{durationLabel(s.duration)}</small>
                      </span>
                      <b>{money(s.price)}</b>
                      <Arrow />
                    </button>
                  ))}
                </div>
              ) : null;
            })}
            {!data.services.some(
              (s) =>
                s.active && !s.archived &&
                (!preset.masterId ||
                  data.masters
                    .find((m) => m.id === preset.masterId)
                    ?.serviceIds.includes(s.id)),
            ) && <Empty title="У этого мастера пока нет доступных услуг" />}
          </>
        )}
        {step === 1 && (
          <>
            <h3>Кому доверим вашу красоту?</h3>
            <p className="subtle">
              Все эти мастера оказывают выбранную услугу.
            </p>
            <button
              className={`choice master-choice ${masterId === "any" ? "selected" : ""}`}
              onClick={() => {
                setMasterId("any");
                resetTime();
              }}
            >
              <span className="any-master">
                <UserRound />
              </span>
              <span>
                <strong>Любой свободный мастер</strong>
                <small>Больше вариантов для вашего расписания</small>
              </span>
              {masterId === "any" && <Check size={18} />}
            </button>
            {eligible.map((m) => (
              <button
                key={m.id}
                className={`choice master-choice ${masterId === m.id ? "selected" : ""}`}
                onClick={() => {
                  setMasterId(m.id);
                  resetTime();
                }}
              >
                <MasterImage master={m} />
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.specialty}</small>
                </span>
                {masterId === m.id && <Check size={18} />}
              </button>
            ))}
            {!eligible.length && (
              <Empty title="Пока нет мастеров для этой услуги">
                <button className="text-link" onClick={() => setStep(0)}>
                  Выбрать другую услугу
                </button>
              </Empty>
            )}
            <button
              className="button button-dark booking-next"
              disabled={!eligible.length}
              onClick={() => setStep(2)}
            >
              Выбрать дату и время <Arrow />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h3>Когда вам удобно?</h3>
            <p className="subtle">Время Бишкека · UTC+6 · Asia/Bishkek</p>
            <div className="date-time-layout">
              <div className="calendar">
                <div className="calendar-heading">
                  <button
                    className="icon-button"
                    disabled={month <= today().slice(0, 7)}
                    onClick={() => moveMonth(-1)}
                    aria-label="Предыдущий месяц"
                  >
                    <ChevronLeft size={19} />
                  </button>
                  <strong>
                    {dateLabel(monthStart, { month: "long", year: "numeric" })}
                  </strong>
                  <button
                    className="icon-button"
                    disabled={month >= addDays(today(), 60).slice(0, 7)}
                    onClick={() => moveMonth(1)}
                    aria-label="Следующий месяц"
                  >
                    <ChevronRight size={19} />
                  </button>
                </div>
                <div className="calendar-grid">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <span className="weekday" key={d}>
                      {weekdays[d]}
                    </span>
                  ))}
                  {Array.from({ length: leading }, (_, i) => (
                    <span key={`empty-${i}`} />
                  ))}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const d = `${month}-${String(i + 1).padStart(2, "0")}`;
                    const disabled = d < today() || d > addDays(today(), 60);
                    return (
                      <button
                        type="button"
                        key={d}
                        disabled={disabled}
                        className={`${date === d ? "selected" : ""} ${d === today() ? "today" : ""}`}
                        onClick={() => chooseDate(d)}
                        aria-label={dateLabel(d, {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                        aria-pressed={date === d}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="time-picker">
                <h4>
                  {dateLabel(date, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </h4>
                {availability.loading ? (
                  <p className="subtle" role="status">
                    Проверяем свободное время…
                  </p>
                ) : available.length ? (
                  <>
                    <div className="time-grid">
                      {allTimes.map((t) => {
                        const slot = available.find((s) => s.time === t);
                        return (
                          <button
                            key={t}
                            disabled={!slot}
                            className={time === t ? "selected" : ""}
                            onClick={() => {
                              setTime(t);
                              setSelectedMaster(slot!.masterId);
                              setErrors({});
                            }}
                            aria-pressed={time === t}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                    <p className="subtle tiny">
                      Серое время недоступно для выбранной услуги.
                    </p>
                    {time && (
                      <p className="selected-time">
                        <Check size={15} />
                        {master?.name} · {time}–
                        {clock(minutes(time) + (service?.duration || 0))}
                      </p>
                    )}
                  </>
                ) : (
                  <Empty title="На этот день окошек нет">
                    <p>Попробуйте ближайшую свободную дату.</p>
                    <button
                      className="button button-light"
                      onClick={async () => {
                        try {
                          const next = await availability.next(
                            addDays(date, 1),
                          );
                          if (next) chooseDate(next.date);
                          else
                            setErrors({
                              global:
                                "В ближайшие 60 дней свободного времени нет. Выберите другого мастера или услугу.",
                            });
                        } catch (e) {
                          setErrors({ global: apiError(e) });
                        }
                      }}
                    >
                      Найти ближайшую дату
                    </button>
                    <button className="text-link" onClick={() => setStep(1)}>
                      Выбрать другого мастера
                    </button>
                  </Empty>
                )}
              </div>
            </div>
            <button
              className="button button-dark booking-next"
              disabled={
                availability.loading ||
                !time ||
                !available.some(
                  (s) => s.time === time && s.masterId === selectedMaster,
                )
              }
              onClick={() => setStep(3)}
            >
              Продолжить <Arrow />
            </button>
          </>
        )}
        {step === 3 && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h3>
              {preset.admin ? "Контакты клиента" : "Как к вам обращаться?"}
            </h3>
            <p className="subtle">
              {isSupabase
                ? "Оставьте имя и телефон для связи по вашей записи."
                : "Используйте тестовое имя и номер +996 000 000 001."}
            </p>
            <div className="form-grid">
              <label>
                Имя
                <input
                  aria-label="Имя"
                  autoComplete="off"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    isSupabase ? "Ваше имя" : "Например, Айдана (демо)"
                  }
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? "name-error" : undefined}
                />
                {errors.name && (
                  <span className="form-error" id="name-error">
                    {errors.name}
                  </span>
                )}
              </label>
              <label>
                Телефон
                <input
                  aria-label="Телефон"
                  type="tel"
                  autoComplete="off"
                  value={phone}
                  maxLength={22}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+996 000 000 001"
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                />
                {errors.phone && (
                  <span className="form-error" id="phone-error">
                    {errors.phone}
                  </span>
                )}
              </label>
            </div>
            <label>
              Комментарий <span className="subtle">· необязательно</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={500}
                placeholder="Ваши пожелания к визиту"
                rows={3}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {isSupabase
                  ? "Согласен(на) на обработку имени, телефона и комментария салоном для организации визита."
                  : "Согласен(на) на обработку введённых тестовых данных и их сохранение в этом браузере. Понимаю, что это демонстрационная запись."}
              </span>
            </label>
            {errors.consent && (
              <p className="form-error" role="alert">
                {errors.consent}
              </p>
            )}
            <details className="privacy-details">
              <summary>Как используются данные?</summary>
              <p>
                {isSupabase
                  ? "Данные сохраняются в базе салона и доступны уполномоченным администраторам. Ваш персональный код позволяет просмотреть, перенести или отменить только эту запись. Не передавайте код другим людям. По вопросам удаления данных обращайтесь в салон."
                  : "Данные записываются в localStorage этого браузера и видны в демонстрационной админ-панели без авторизации. Они не отправляются в салон. Удалить их можно кнопкой сброса демоданных в настройках."}
              </p>
            </details>
            {needsCaptcha && (
              <Turnstile onToken={setCaptchaToken} attempt={captchaAttempt} />
            )}
            <button
              className="button button-dark booking-next"
              type="submit"
              disabled={submitting || saving}
            >
              {submitting
                ? "Сохраняем…"
                : existing
                  ? "Сохранить перенос"
                  : isSupabase
                    ? "Подтвердить запись"
                    : "Создать демозапись"}{" "}
              <Arrow />
            </button>
          </form>
        )}
        {step === 4 && result && (
          <div className="booking-success">
            <span className="success-icon">
              <Check size={30} />
            </span>
            <div className="eyebrow">ЗАПИСЬ № {result.id}</div>
            <h3>
              {result.status === "cancelled"
                ? "Запись отменена"
                : "Ваше время — для вас."}
            </h3>
            <p className="subtle">
              {result.status === "cancelled"
                ? "Окошко снова доступно для записи."
                : isSupabase
                  ? "Запись сохранена на сервере. Сохраните код управления ниже."
                  : "Демозапись сохранена. Реальные уведомления не отправляются."}
            </p>
            <div className="confirmation-details">
              <h4>{result.serviceName}</h4>
              <p>
                <UserRound size={17} />
                Мастер:{" "}
                {data.masters.find((m) => m.id === result.masterId)?.name}
              </p>
              <p>
                <CalendarDays size={17} />
                {dateLabel(result.date, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
              <p>
                <Clock3 size={17} />
                {result.time}–{clock(minutes(result.time) + result.duration)} ·
                Бишкек
              </p>
              <strong>{money(result.price)}</strong>
              <span className={`status status-${result.status}`}>
                {result.status === "cancelled"
                  ? "Отменена"
                  : result.status === "confirmed"
                    ? "Подтверждена"
                    : "Ожидает подтверждения"}
              </span>
            </div>
            {isSupabase && <ManagementCode id={result.id} />}{" "}
            {result.status !== "cancelled" && (
              <>
                <button
                  className="button button-dark"
                  onClick={() => downloadCalendar(result, data)}
                >
                  <CalendarDays size={17} /> Добавить в календарь
                </button>
                <div className="confirmation-actions">
                  <button
                    onClick={() => {
                      setDate(result.date);
                      setTime("");
                      setConsent(false);
                      setStep(2);
                    }}
                  >
                    Перенести
                  </button>
                  <button
                    className="danger-text"
                    onClick={() => setCancel(true)}
                  >
                    Отменить запись
                  </button>
                </div>
                {cancel && (
                  <div className="confirm-inline" role="alert">
                    <p>Отменить запись и освободить время?</p>
                    <button
                      className="button button-danger"
                      disabled={saving}
                      onClick={async () => {
                        if (!(await setStatus(result.id, "cancelled"))) return;
                        setCancel(false);
                        onSuccess("Запись отменена. Время снова доступно.");
                      }}
                    >
                      Да, отменить
                    </button>
                    <button
                      className="button button-light"
                      onClick={() => setCancel(false)}
                    >
                      Оставить запись
                    </button>
                  </div>
                )}
              </>
            )}
            <button className="text-link" onClick={onClose}>
              Вернуться на сайт <Arrow />
            </button>
          </div>
        )}
      </div>
      {step > 0 && step < 4 && (
        <button
          className="back-link"
          onClick={() => {
            setStep(step - 1);
            setErrors({});
          }}
        >
          <ArrowLeft size={16} /> Назад
        </button>
      )}
    </Modal>
  );
}

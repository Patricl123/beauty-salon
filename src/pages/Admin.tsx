import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Home,
  LayoutDashboard,
  LogOut,
  Bell,
  Scissors,
  Settings,
  Users,
  UserRound,
  Plus,
  Search,
  LockKeyhole,
  ArrowUpRight,
  Images,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { isSupabase } from "../lib/supabase";
import { AdminLogin } from "../components/AdminLogin";
import { Loading } from "../components/UI";
import { useStore } from "../lib/store";
import {
  addDays,
  dateLabel,
  getSlots,
  instant,
  minutes,
  scheduleConflicts,
  today,
  weekday,
} from "../lib/schedule";
import {
  categories,
  durationLabel,
  events,
  money,
  statuses,
  weekdays,
} from "../i18n";
import type {
  Appointment,
  BookingPreset,
  Master,
  NotificationSettings,
  SalonSettings,
  Service,
  Status,
} from "../types";
import { Brand, Empty, Modal } from "../components/UI";
import { BlockForm, MasterForm, ServiceForm } from "../components/AdminForms";
import { makeNotifications } from "../lib/notifications";
import { SiteContentAdmin } from "../components/SiteContentAdmin";
import { MasterImage } from "../components/SiteImage";
import { CatalogActions, ArchiveFilter } from "../components/CatalogActions";
const tabs = [
  { id: "overview", name: "Обзор", icon: LayoutDashboard },
  { id: "calendar", name: "Календарь", icon: CalendarDays },
  { id: "appointments", name: "Записи", icon: Clock3 },
  { id: "masters", name: "Мастера", icon: UserRound },
  { id: "services", name: "Услуги", icon: Scissors },
  { id: "clients", name: "Клиенты", icon: Users },
  { id: "notifications", name: "Уведомления", icon: Bell },
  { id: "settings", name: "Настройки", icon: Settings },
  { id: "content", name: "Контент сайта", icon: Images },
];
export function Admin({
  onBook,
  onMessage,
}: {
  onBook: (p?: BookingPreset) => void;
  onMessage: (s: string) => void;
}) {
  const { data, update, setStatus, loading, saving } = useStore();
  const auth = useAuth();
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState("overview");
  const [masterFilter, setMasterFilter] = useState("all");
  const [date, setDate] = useState(today());
  const [view, setView] = useState<"day" | "week">("day");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceEdit, setServiceEdit] = useState<Service | "new" | null>(null);
  const [masterEdit, setMasterEdit] = useState<Master | "new" | null>(null);
  const [mastersArchived, setMastersArchived] = useState(false);
  const [servicesArchived, setServicesArchived] = useState(false);
  const [block, setBlock] = useState(false);
  const [detailId, setDetailId] = useState("");
  const [cancelId, setCancelId] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [note, setNote] = useState("");
  const [editContact, setEditContact] = useState({
    name: "",
    phone: "",
    comment: "",
  });
  const detail = data.appointments.find((a) => a.id === detailId);
  const openDetail = (a: Appointment) => {
    setDetailId(a.id);
    setEditContact({ name: a.clientName, phone: a.phone, comment: a.comment });
  };
  if (isSupabase && auth.loading && auth.isAdmin) return <Loading />;
  if (isSupabase && !auth.isAdmin) return <AdminLogin />;
  if (isSupabase && loading) return <Loading />;
  if (!isSupabase && !entered)
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
          <p>Расписание, мастера и забота о каждом визите — в одном месте.</p>
          <div className="demo-login-notice">
            <strong>Демонстрационный вход</strong>
            <p>
              Без пароля и реальной защиты. Все данные тестовые и доступны в
              этом браузере. Не вводите настоящие данные клиентов.
            </p>
          </div>
          <button
            className="button button-dark"
            onClick={() => setEntered(true)}
          >
            Войти в демо админ-панели <ArrowUpRight size={18} />
          </button>
          <Link to="/" className="text-link">
            Вернуться на сайт
          </Link>
        </div>
        <div className="login-image">
          <img src="/images/salon.jpg" alt="Демонстрационный интерьер" />
          <span>
            Забота начинается
            <br />с порядка.
          </span>
        </div>
      </main>
    );
  const current = data.appointments.filter((a) => a.date === today());
  const upcoming = data.appointments
    .filter(
      (a) =>
        instant(a.date, a.time) > new Date() &&
        ["pending", "confirmed"].includes(a.status),
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const filtered = data.appointments
    .filter(
      (a) =>
        (masterFilter === "all" || a.masterId === masterFilter) &&
        (statusFilter === "all" || a.status === statusFilter) &&
        `${a.id} ${a.clientName} ${a.phone} ${a.serviceName}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const weekStart = addDays(date, -((weekday(date) + 6) % 7));
  const dates =
    view === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
      : [date];
  const clients = [...new Set(data.appointments.map((a) => a.phone))]
    .map((phone) => ({
      phone,
      appointments: data.appointments.filter((a) => a.phone === phone),
    }))
    .filter((c) =>
      `${c.phone} ${c.appointments[0]?.clientName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const conflicts = scheduleConflicts(data);
  const availableToday = data.masters.reduce(
    (sum, m) =>
      sum +
      (m.serviceIds[0]
        ? getSlots(data, m.serviceIds[0], m.id, today()).length
        : 0),
    0,
  );
  const rows = (appointments: Appointment[]) =>
    appointments.length ? (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Клиент / запись</th>
              <th>Услуга</th>
              <th>Мастер</th>
              <th>Дата и время</th>
              <th>Статус</th>
              <th>Сумма</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {appointments.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.clientName}</strong>
                  <small>{a.id}</small>
                </td>
                <td>
                  {a.serviceName}
                  <small>{durationLabel(a.duration)}</small>
                </td>
                <td>{data.masters.find((m) => m.id === a.masterId)?.name}</td>
                <td>
                  {dateLabel(a.date, { day: "numeric", month: "short" })}
                  <small>{a.time}</small>
                </td>
                <td>
                  <span className={`status status-${a.status}`}>
                    {statuses[a.status]}
                  </span>
                </td>
                <td>{money(a.price)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Открыть запись ${a.id}`}
                    onClick={() => openDetail(a)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty title="Записей пока нет">
        <p>Попробуйте другие фильтры или создайте запись по телефону.</p>
      </Empty>
    );
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand />
        <div className="admin-sidebar-label">УПРАВЛЕНИЕ САЛОНОМ</div>
        <nav aria-label="Разделы админ-панели">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => {
                setTab(t.id);
                setQuery("");
              }}
            >
              <t.icon size={18} />
              <span>{t.name}</span>
              {t.id === "appointments" && (
                <small>
                  {
                    data.appointments.filter((a) => a.status === "pending")
                      .length
                  }
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="demo-label">
            {isSupabase ? "Администратор" : "Демонстрационный режим"}
          </span>
          <Link to="/">
            <Home size={17} /> Открыть сайт
          </Link>
          <button
            onClick={() => {
              if (isSupabase) void auth.signOut();
              else setEntered(false);
            }}
          >
            <LogOut size={17} /> {isSupabase ? "Выйти" : "Выйти из демо"}
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span>
            {data.settings.name} / {tabs.find((t) => t.id === tab)?.name}
          </span>
          <div>
            <span className="subtle">Бишкек · UTC+6</span>
            <span className="admin-avatar">A</span>
          </div>
        </header>
        <main className="admin-content">
          <div className="admin-page-heading">
            <div>
              <div className="eyebrow">ВАШ САЛОН, В ОДНОМ МЕСТЕ</div>
              <h1>
                {tab === "overview"
                  ? `Добрый день, ${data.settings.name}`
                  : tabs.find((t) => t.id === tab)?.name}
              </h1>
              <p>
                {tab === "overview"
                  ? dateLabel(today(), {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : isSupabase
                    ? "Изменения сохраняются на сервере"
                    : "Демонстрационные данные · изменения сохраняются в браузере"}
              </p>
            </div>
            <button
              className="button button-dark"
              onClick={() => onBook({ admin: true })}
            >
              <Plus size={17} /> Новая запись
            </button>
          </div>
          {conflicts.length > 0 && (
            <div className="warning">
              <strong>
                Проверьте расписание: {conflicts.length} записей вне рабочего
                графика.
              </strong>
              <p>
                Они сохранены. Откройте запись и согласуйте перенос:{" "}
                {conflicts.map((a) => a.id).join(", ")}.
              </p>
            </div>
          )}
          {tab === "content" && <SiteContentAdmin onMessage={onMessage} />}
          {tab === "overview" && (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <span>
                    Записей сегодня
                    <CalendarDays size={18} />
                  </span>
                  <strong>
                    {current.filter((a) => a.status !== "cancelled").length}
                  </strong>
                  <small>Весь день · по времени Бишкека</small>
                </div>
                <div className="stat-card">
                  <span>
                    Ожидают подтверждения
                    <Clock3 size={18} />
                  </span>
                  <strong>
                    {
                      data.appointments.filter((a) => a.status === "pending")
                        .length
                    }
                  </strong>
                  <small>Проверьте новые заявки</small>
                </div>
                <div className="stat-card">
                  <span>
                    Свободное время
                    <SparkleIcon />
                  </span>
                  <strong>{availableToday}</strong>
                  <small>
                    Варианты начала сегодня по первой услуге мастера
                  </small>
                </div>
                <div className="stat-card">
                  <span>
                    Клиенты
                    <Users size={18} />
                  </span>
                  <strong>{clients.length}</strong>
                  <small>
                    {isSupabase ? "Клиенты салона" : "Демонстрационные профили"}
                  </small>
                </div>
              </div>
              <section className="admin-panel">
                <div className="panel-heading">
                  <h2>Ближайшие визиты</h2>
                  <button
                    className="text-link"
                    onClick={() => setTab("appointments")}
                  >
                    Все записи <ArrowUpRight size={17} />
                  </button>
                </div>
                {rows(upcoming.slice(0, 6))}
              </section>
              <div className="admin-two-cols">
                <section className="admin-panel">
                  <div className="panel-heading">
                    <h2>Статусы записей</h2>
                  </div>
                  <div className="status-counts">
                    {Object.entries(statuses).map(([id, label]) => (
                      <div key={id}>
                        <span className={`status status-${id}`}>{label}</span>
                        <strong>
                          {
                            data.appointments.filter((a) => a.status === id)
                              .length
                          }
                        </strong>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="admin-panel">
                  <div className="panel-heading">
                    <h2>Быстрые действия</h2>
                  </div>
                  <div className="quick-actions">
                    <button onClick={() => setBlock(true)}>
                      <Clock3 size={18} /> Заблокировать время{" "}
                      <Plus size={17} />
                    </button>
                    <button onClick={() => setTab("masters")}>
                      <UserRound size={18} /> Изменить график мастера{" "}
                      <ArrowUpRight size={17} />
                    </button>
                    <button onClick={() => setTab("notifications")}>
                      <Bell size={18} /> Открыть журнал уведомлений{" "}
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}
          {tab === "calendar" && (
            <>
              <div className="toolbar">
                <div className="calendar-nav">
                  <button
                    className="icon-button"
                    onClick={() =>
                      setDate(addDays(date, view === "week" ? -7 : -1))
                    }
                    aria-label="Предыдущий период"
                  >
                    <ChevronLeft size={19} />
                  </button>
                  <label className="sr-only" htmlFor="admin-date">
                    Дата календаря
                  </label>
                  <input
                    id="admin-date"
                    type="date"
                    value={date}
                    onChange={(e) => e.target.value && setDate(e.target.value)}
                  />
                  <button
                    className="icon-button"
                    onClick={() =>
                      setDate(addDays(date, view === "week" ? 7 : 1))
                    }
                    aria-label="Следующий период"
                  >
                    <ChevronRight size={19} />
                  </button>
                  <button
                    className="text-link"
                    onClick={() => setDate(today())}
                  >
                    Сегодня
                  </button>
                </div>
                <div className="segmented">
                  <button
                    className={view === "day" ? "active" : ""}
                    onClick={() => setView("day")}
                  >
                    День
                  </button>
                  <button
                    className={view === "week" ? "active" : ""}
                    onClick={() => setView("week")}
                  >
                    Неделя
                  </button>
                </div>
                <select
                  aria-label="Фильтр по мастеру"
                  value={masterFilter}
                  onChange={(e) => setMasterFilter(e.target.value)}
                >
                  <option value="all">Все мастера</option>
                  {data.masters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  className="button button-light"
                  onClick={() => setBlock(true)}
                >
                  Блокировать время
                </button>
              </div>
              <div className={`admin-calendar ${view}`}>
                {dates.map((d) => (
                  <section className="calendar-day" key={d}>
                    <h3>
                      {dateLabel(d, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </h3>
                    {data.appointments
                      .filter(
                        (a) =>
                          a.date === d &&
                          (masterFilter === "all" ||
                            a.masterId === masterFilter),
                      )
                      .sort((a, b) => a.time.localeCompare(b.time))
                      .map((a) => (
                        <button
                          className={`calendar-event status-${a.status}`}
                          key={a.id}
                          onClick={() => openDetail(a)}
                        >
                          <b>
                            {a.time} · {durationLabel(a.duration)}
                          </b>
                          <strong>{a.clientName}</strong>
                          <span>{a.serviceName}</span>
                          <small>
                            {
                              data.masters.find((m) => m.id === a.masterId)
                                ?.name
                            }{" "}
                            · {statuses[a.status]}
                          </small>
                        </button>
                      ))}
                    {data.blocks
                      .filter(
                        (b) =>
                          b.date === d &&
                          (masterFilter === "all" ||
                            b.masterId === masterFilter),
                      )
                      .map((b) => (
                        <div key={b.id} className="calendar-block">
                          <b>
                            {b.start}–{b.end} · Заблокировано
                          </b>
                          <span>
                            {
                              data.masters.find((m) => m.id === b.masterId)
                                ?.name
                            }{" "}
                            · {b.reason}
                          </span>
                          <button
                            onClick={async () => {
                              if (
                                !(await update(
                                  (s) => ({
                                    ...s,
                                    blocks: s.blocks.filter(
                                      (v) => v.id !== b.id,
                                    ),
                                  }),
                                  false,
                                ))
                              )
                                return;
                              onMessage("Блокировка снята.");
                            }}
                          >
                            Снять блокировку
                          </button>
                        </div>
                      ))}
                    {!data.appointments.some(
                      (a) =>
                        a.date === d &&
                        (masterFilter === "all" || a.masterId === masterFilter),
                    ) && <p className="calendar-empty">Записей нет</p>}
                  </section>
                ))}
              </div>
              <div className="calendar-legend">
                {Object.entries(statuses).map(([id, name]) => (
                  <span className={`status status-${id}`} key={id}>
                    {name}
                  </span>
                ))}
              </div>
              <p className="subtle">
                Перерывы и выходные редактируются в разделе «Мастера». Свободное
                время проверяется при создании записи.
              </p>
            </>
          )}
          {tab === "appointments" && (
            <>
              <div className="toolbar">
                <div className="search-input">
                  <Search size={17} />
                  <input
                    aria-label="Поиск записей"
                    placeholder="Имя, телефон, услуга или номер…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Статус записи"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">Все статусы</option>
                  {Object.entries(statuses).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Мастер"
                  value={masterFilter}
                  onChange={(e) => setMasterFilter(e.target.value)}
                >
                  <option value="all">Все мастера</option>
                  {data.masters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <section className="admin-panel">{rows(filtered)}</section>
            </>
          )}
          {tab === "masters" && (
            <>
              <div className="toolbar">
                <p className="subtle">
                  {data.masters.length} мастеров · профили, услуги и расписание
                </p>
                <ArchiveFilter archived={mastersArchived} onChange={setMastersArchived} />
                <button
                  className="button button-light"
                  onClick={() => setMasterEdit("new")}
                >
                  <Plus size={16} /> Добавить мастера
                </button>
              </div>
              <div className="admin-master-grid">
                {data.masters.filter(m => !!m.archived === mastersArchived).map((m) => (
                  <article className="admin-master-card" key={m.id}>
                    <MasterImage master={m} />
                    <h2>{m.name}</h2>
                    <p>{m.specialty}</p>
                    <span>{m.days.map((d) => weekdays[d]).join(", ")}</span>
                    <span>
                      {m.start}–{m.end} · перерыв {m.breakStart || "нет"}
                      {m.breakEnd && `–${m.breakEnd}`}
                    </span>
                    <small>
                      {m.serviceIds.length} услуг
                      {m.vacationStart &&
                        ` · Отпуск ${m.vacationStart} — ${m.vacationEnd}`}
                    </small>
                    <button
                      className="button button-light"
                      onClick={() => setMasterEdit(m)}
                    >
                      Профиль и график <ArrowUpRight size={16} />
                    </button>
                    <CatalogActions kind="master" item={m} onMessage={onMessage} />
                  </article>
                ))}
              </div>
            </>
          )}
          {tab === "services" && (
            <>
              <div className="toolbar">
                <p className="subtle">
                  {data.services.length} услуг · цены в сомах
                </p>
                <ArchiveFilter archived={servicesArchived} onChange={setServicesArchived} />
                <button
                  className="button button-light"
                  onClick={() => setServiceEdit("new")}
                >
                  <Plus size={16} /> Добавить услугу
                </button>
              </div>
              <section className="admin-panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Услуга</th>
                      <th>Категория</th>
                      <th>Цена</th>
                      <th>Длительность</th>
                      <th>Активность</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.services.filter(s => !!s.archived === servicesArchived).map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.name}</strong>
                          <small className="table-description">
                            {s.description}
                          </small>
                        </td>
                        <td>{categories[s.category]}</td>
                        <td>{money(s.price)}</td>
                        <td>{durationLabel(s.duration)}</td>
                        <td>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={s.active}
                              disabled={s.archived || saving}
                              aria-label={`Активность: ${s.name}`}
                              onChange={async (e) => {
                                if (
                                  !(await update(
                                    (d) => ({
                                      ...d,
                                      services: d.services.map((item) =>
                                        item.id === s.id
                                          ? {
                                              ...item,
                                              active: e.target.checked,
                                            }
                                          : item,
                                      ),
                                    }),
                                    false,
                                  ))
                                )
                                  return;
                                onMessage(
                                  e.target.checked
                                    ? "Услуга доступна для записи."
                                    : "Услуга скрыта из формы записи.",
                                );
                              }}
                            />
                            {s.archived ? "В архиве" : s.active ? "Активна" : "Скрыта"}
                          </label>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Редактировать: ${s.name}`}
                            onClick={() => setServiceEdit(s)}
                          >
                            <ArrowUpRight size={18} />
                          </button>
                          <CatalogActions kind="service" item={s} onMessage={onMessage} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
          {tab === "clients" && (
            <>
              <div className="toolbar">
                <div className="search-input">
                  <Search size={17} />
                  <input
                    aria-label="Поиск клиентов"
                    placeholder="Имя или телефон…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <p className="subtle">
                  Внутренние заметки видны только в интерфейсе админ-панели.
                </p>
              </div>
              <section className="admin-panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Клиент</th>
                      <th>Телефон</th>
                      <th>Посещений</th>
                      <th>Заметка</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => (
                      <tr key={c.phone}>
                        <td>
                          <strong>
                            {
                              c.appointments[c.appointments.length - 1]
                                .clientName
                            }
                          </strong>
                        </td>
                        <td>{c.phone}</td>
                        <td>
                          {
                            c.appointments.filter(
                              (a) => a.status === "completed",
                            ).length
                          }
                        </td>
                        <td>
                          {data.clientNotes[c.phone] ? "Есть заметка" : "—"}
                        </td>
                        <td>
                          <button
                            className="button button-light"
                            onClick={() => {
                              setClientPhone(c.phone);
                              setNote(data.clientNotes[c.phone] || "");
                            }}
                          >
                            История и заметки
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!clients.length && <Empty title="Клиенты не найдены" />}
              </section>
            </>
          )}
          {tab === "settings" && (
            <SettingsPanel
              key={JSON.stringify(data.settings)}
              onMessage={onMessage}
            />
          )}
          {tab === "notifications" && (
            <NotificationsPanel onMessage={onMessage} />
          )}
          <footer className="admin-footer">
            {data.settings.name} ·{" "}
            {isSupabase
              ? "Вход через Supabase Auth · Уведомления пока не отправляются"
              : "Frontend-прототип · Данные в localStorage · Без реальной авторизации и отправки сообщений"}
          </footer>
        </main>
      </div>
      {serviceEdit && (
        <ServiceForm
          initial={serviceEdit === "new" ? undefined : serviceEdit}
          onClose={() => setServiceEdit(null)}
          onMessage={onMessage}
        />
      )}
      {masterEdit && (
        <MasterForm
          initial={masterEdit === "new" ? undefined : masterEdit}
          onClose={() => setMasterEdit(null)}
          onMessage={onMessage}
        />
      )}
      {block && (
        <BlockForm onClose={() => setBlock(false)} onMessage={onMessage} />
      )}
      {detail && (
        <Modal title={`Запись ${detail.id}`} onClose={() => setDetailId("")}>
          <div className="detail-summary">
            <h3>{detail.serviceName}</h3>
            <p>
              {dateLabel(detail.date)} · {detail.time} ·{" "}
              {durationLabel(detail.duration)}
            </p>
            <p>
              {data.masters.find((m) => m.id === detail.masterId)?.name} ·{" "}
              {money(detail.price)}
            </p>
          </div>
          <label>
            Статус
            <select
              disabled={saving}
              value={detail.status}
              onChange={async (e) => {
                const status = e.target.value as Status;
                if (status === "cancelled") return setCancelId(detail.id);
                if (!(await setStatus(detail.id, status)))
                  onMessage(
                    "Нельзя восстановить запись: время уже занято или прошло.",
                  );
                else onMessage("Статус обновлён.");
              }}
            >
              {Object.entries(statuses).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const phone = editContact.phone.replace(/[\s()-]/g, "");
              if (!/^\+996\d{9}$/.test(phone))
                return onMessage("Телефон должен содержать +996 и 9 цифр.");
              if (
                !(await update(
                  (d) => ({
                    ...d,
                    appointments: d.appointments.map((a) =>
                      a.id === detail.id
                        ? {
                            ...a,
                            clientName: editContact.name.trim(),
                            phone,
                            comment: editContact.comment,
                          }
                        : a,
                    ),
                  }),
                  false,
                ))
              )
                return;
              onMessage("Данные записи обновлены.");
            }}
          >
            <div className="form-grid">
              <label>
                Имя клиента
                <input
                  required
                  minLength={2}
                  value={editContact.name}
                  onChange={(e) =>
                    setEditContact({ ...editContact, name: e.target.value })
                  }
                />
              </label>
              <label>
                Телефон
                <input
                  required
                  type="tel"
                  value={editContact.phone}
                  onChange={(e) =>
                    setEditContact({ ...editContact, phone: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Комментарий клиента
              <textarea
                rows={2}
                value={editContact.comment}
                onChange={(e) =>
                  setEditContact({ ...editContact, comment: e.target.value })
                }
              />
            </label>
            <button type="submit" className="button button-light">
              Сохранить данные
            </button>
          </form>
          {instant(detail.date, detail.time) > new Date() &&
            ["pending", "confirmed"].includes(detail.status) && (
              <div className="appointment-actions">
                <button
                  className="button button-dark"
                  onClick={() => {
                    setDetailId("");
                    onBook({ editId: detail.id, admin: true });
                  }}
                >
                  Перенести / изменить услугу
                </button>
                <button
                  className="danger-text"
                  onClick={() => setCancelId(detail.id)}
                >
                  Отменить запись
                </button>
              </div>
            )}
          {cancelId === detail.id && (
            <div className="confirm-inline">
              <p>Отменить запись и освободить интервал?</p>
              <button
                className="button button-danger"
                onClick={async () => {
                  if (!(await setStatus(detail.id, "cancelled"))) return;
                  setCancelId("");
                  onMessage("Запись отменена, время свободно.");
                }}
              >
                Да, отменить
              </button>
              <button
                className="button button-light"
                onClick={() => setCancelId("")}
              >
                Нет, оставить
              </button>
            </div>
          )}
        </Modal>
      )}
      {clientPhone && (
        <Modal wide title="История клиента" onClose={() => setClientPhone("")}>
          <p className="subtle">
            {clientPhone} ·{" "}
            {isSupabase ? "профиль клиента" : "демонстрационный профиль"}
          </p>
          {rows(data.appointments.filter((a) => a.phone === clientPhone))}
          <label>
            Внутренняя заметка
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Только тестовые данные…"
            />
          </label>
          <button
            className="button button-dark"
            onClick={async () => {
              if (
                !(await update(
                  (d) => ({
                    ...d,
                    clientNotes: { ...d.clientNotes, [clientPhone]: note },
                  }),
                  false,
                ))
              )
                return;
              onMessage("Внутренняя заметка сохранена.");
            }}
          >
            Сохранить заметку
          </button>
        </Modal>
      )}
    </div>
  );
}
function SparkleIcon() {
  return <span aria-hidden="true">✳</span>;
}
function SettingsPanel({ onMessage }: { onMessage: (s: string) => void }) {
  const { data, update, reset } = useStore();
  const [form, setForm] = useState<SalonSettings>(data.settings);
  const [warning, setWarning] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof SalonSettings>(
    key: K,
    value: SalonSettings[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    setWarning(false);
    setError("");
  };
  const conflicts = scheduleConflicts({ ...data, settings: form });
  return (
    <div className="admin-form-panel">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (minutes(form.start) >= minutes(form.end))
            return setError(
              "Начало рабочего дня должно быть раньше окончания.",
            );
          if (
            form.phone &&
            !/^\+996\d{9}$/.test(form.phone.replace(/[\s()-]/g, ""))
          )
            return setError(
              "Контактный телефон: +996 и 9 цифр. Можно оставить пустым.",
            );
          if (conflicts.length && !warning) return setWarning(true);
          if (
            !(await update(
              (d) => ({
                ...d,
                settings: form,
                notifications: [
                  ...d.notifications,
                  ...d.masters.flatMap((m) =>
                    d.notificationSettings.channels.map((channel) => ({
                      id: crypto.randomUUID(),
                      appointmentId: "",
                      event: "schedule" as const,
                      recipient: `Мастер: ${m.name}`,
                      channel,
                      at: new Date().toISOString(),
                      planned: false,
                      text: `Настройки и часы работы салона обновлены: ${form.start}–${form.end}. Проверьте своё расписание.`,
                    })),
                  ),
                ],
              }),
              warning,
            ))
          )
            return;
          setWarning(false);
          onMessage("Настройки салона сохранены.");
        }}
      >
        <h2>О салоне</h2>
        <div className="form-grid">
          <label>
            Название
            <input
              required
              value={form.name}
              maxLength={40}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label>
            Подпись бренда
            <input
              value={form.tagline}
              maxLength={60}
              onChange={(e) => set("tagline", e.target.value)}
            />
          </label>
        </div>
        <label>
          Адрес
          <input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Пока не указан — карта не показывает отметку"
          />
        </label>
        <div className="form-grid">
          <label>
            Телефон
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="Не указан"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="Не указан"
            />
          </label>
        </div>
        <h2>Часы работы</h2>
        <p className="subtle">Часовой пояс: Asia/Bishkek (UTC+6).</p>
        <div className="days-toggle">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button
              type="button"
              aria-pressed={form.days.includes(d)}
              className={form.days.includes(d) ? "selected" : ""}
              key={d}
              onClick={() =>
                set(
                  "days",
                  form.days.includes(d)
                    ? form.days.filter((day) => day !== d)
                    : [...form.days, d],
                )
              }
            >
              {weekdays[d]}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <label>
            Открытие
            <input
              required
              type="time"
              value={form.start}
              onChange={(e) => set("start", e.target.value)}
            />
          </label>
          <label>
            Закрытие
            <input
              required
              type="time"
              value={form.end}
              onChange={(e) => set("end", e.target.value)}
            />
          </label>
        </div>
        <label>
          Правила отмены
          <textarea
            rows={4}
            required
            value={form.cancellationPolicy}
            onChange={(e) => set("cancellationPolicy", e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {warning && (
          <div className="warning">
            <strong>
              Новый график затрагивает {conflicts.length} записей.
            </strong>
            <p>
              Они не будут удалены: {conflicts.map((a) => a.id).join(", ")}.
              Согласуйте перенос с клиентами.
            </p>
          </div>
        )}
        <button className="button button-dark" type="submit">
          {warning
            ? "Сохранить график и существующие записи"
            : "Сохранить настройки"}
        </button>
      </form>
      {!isSupabase && (
        <div className="reset-section">
          <h2>Начать заново</h2>
          <p className="subtle">
            Сброс удалит изменения в этом браузере и создаст новое
            деморасписание относительно сегодняшней даты.
          </p>
          {resetConfirm ? (
            <div className="confirm-inline">
              <p>Сбросить все демонстрационные данные?</p>
              <button
                className="button button-danger"
                onClick={() => {
                  reset();
                  setForm(data.settings);
                  setResetConfirm(false);
                  onMessage("Демоданные восстановлены.");
                }}
              >
                Да, сбросить данные
              </button>
              <button
                className="button button-light"
                onClick={() => setResetConfirm(false)}
              >
                Отмена
              </button>
            </div>
          ) : (
            <button
              className="button button-light danger-text"
              onClick={() => setResetConfirm(true)}
            >
              Сбросить демоданные
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function NotificationsPanel({ onMessage }: { onMessage: (s: string) => void }) {
  const { data, update } = useStore();
  const [form, setForm] = useState<NotificationSettings>(
    data.notificationSettings,
  );
  const [template, setTemplate] =
    useState<keyof NotificationSettings["templates"]>("created");
  const logs = [...data.notifications].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <div className="notice">
        <Bell size={20} />
        <span>
          {isSupabase
            ? "Журнал событий. SMS, WhatsApp и email пока не отправляются."
            : "Только демонстрационный журнал. SMS, WhatsApp и email не отправляются."}
          Время — Бишкек.
        </span>
      </div>
      <section className="admin-form-panel">
        <h2>Каналы и напоминания</h2>
        <div className="channel-list">
          {(["SMS", "WhatsApp", "email"] as const).map((channel) => (
            <label className="checkbox-label" key={channel}>
              <input
                type="checkbox"
                checked={form.channels.includes(channel)}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    channels: e.target.checked
                      ? [...f.channels, channel]
                      : f.channels.filter((c) => c !== channel),
                  }))
                }
              />
              {channel}
            </label>
          ))}
        </div>
        <div className="channel-list">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.reminder24}
              onChange={(e) =>
                setForm({ ...form, reminder24: e.target.checked })
              }
            />
            За 24 часа
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.reminder2}
              onChange={(e) =>
                setForm({ ...form, reminder2: e.target.checked })
              }
            />
            За 2 часа
          </label>
        </div>
        <label>
          Шаблон
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as typeof template)}
          >
            {Object.entries(events).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Текст сообщения
          <textarea
            rows={4}
            value={form.templates[template]}
            onChange={(e) =>
              setForm({
                ...form,
                templates: { ...form.templates, [template]: e.target.value },
              })
            }
          />
        </label>
        <p className="subtle">
          Переменные: {"{name}, {number}, {service}, {date}, {time}, {master}"}.
        </p>
        <button
          className="button button-dark"
          onClick={async () => {
            if (
              !(await update((d) => {
                const next = { ...d, notificationSettings: form };
                const planned = d.appointments
                  .filter(
                    (a) =>
                      instant(a.date, a.time) > new Date() &&
                      ["pending", "confirmed"].includes(a.status),
                  )
                  .flatMap((a) =>
                    makeNotifications(next, a, "confirmed").filter(
                      (n) => n.planned,
                    ),
                  );
                return {
                  ...next,
                  notifications: [
                    ...d.notifications.filter((n) => !n.planned),
                    ...planned,
                  ],
                };
              }, false))
            )
              return;
            onMessage(
              isSupabase
                ? "Шаблоны и план напоминаний сохранены. Отправка сообщений пока не подключена."
                : "Шаблоны сохранены. План демонстрационных напоминаний обновлён.",
            );
          }}
        >
          Сохранить настройки
        </button>
      </section>
      <section className="admin-panel notification-log">
        <div className="panel-heading">
          <h2>Журнал уведомлений</h2>
          <span className="subtle">{logs.length} событий</span>
        </div>
        {logs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Когда бы отправили</th>
                  <th>Кому / канал</th>
                  <th>Сообщение</th>
                  <th>Режим</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((n) => (
                  <tr key={n.id}>
                    <td>
                      {new Intl.DateTimeFormat("ru-RU", {
                        timeZone: "Asia/Bishkek",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(n.at))}
                      <small>{events[n.event]}</small>
                    </td>
                    <td>
                      {n.recipient}
                      <small>{n.channel}</small>
                    </td>
                    <td className="notification-text">{n.text}</td>
                    <td>
                      <span className="status status-pending">
                        {isSupabase
                          ? n.planned
                            ? "Запланировано · не отправлено"
                            : "Не отправлено"
                          : n.planned
                            ? "План · демо"
                            : "Демособытие"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Журнал пока пуст">
            <p>
              Создайте, подтвердите, перенесите или отмените запись — здесь
              появится пример уведомления.
            </p>
          </Empty>
        )}
      </section>
    </>
  );
}

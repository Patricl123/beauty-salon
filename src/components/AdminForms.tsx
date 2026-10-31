import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Block, Master, Service } from "../types";
import { useStore } from "../lib/store";
import { categories, weekdays } from "../i18n";
import {
  instant,
  minutes,
  occupies,
  overlaps,
  scheduleConflicts,
  today,
} from "../lib/schedule";
import { Modal } from "./UI";
import { ImageEditor } from "./ImageEditor";
import { isSupabase } from "../lib/supabase";
import { masterSpecialties } from "../lib/masterSpecialties";
import {
  mediaError,
  mediaRequest,
  previewImages,
  stageImage,
  type ImageDraft,
} from "../lib/siteContent";
export function ServiceForm({
  initial,
  onClose,
  onMessage,
}: {
  initial?: Service;
  onClose: () => void;
  onMessage: (s: string) => void;
}) {
  const { update } = useStore();
  const [form, setForm] = useState<Service>(
    initial || {
      id: crypto.randomUUID(),
      category: "hair",
      name: "",
      description: "",
      price: 1000,
      duration: 60,
      active: true,
    },
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (
      !(await update(
        (d) => ({
          ...d,
          services: initial
            ? d.services.map((s) => (s.id === form.id ? form : s))
            : [...d.services, form],
        }),
        false,
      ))
    )
      return;
    onMessage("Услуга сохранена. Изменения доступны в форме записи.");
    onClose();
  };
  return (
    <Modal
      title={initial ? "Редактировать услугу" : "Новая услуга"}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <label>
          Название
          <input
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Категория
          <select
            value={form.category}
            onChange={(e) =>
              setForm({
                ...form,
                category: e.target.value as Service["category"],
              })
            }
          >
            {Object.entries(categories).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Описание
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Цена, сом
            <input
              required
              type="number"
              min={0}
              max={1000000}
              step={10}
              value={form.price}
              onChange={(e) =>
                setForm({ ...form, price: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Длительность, минут
            <input
              required
              type="number"
              min={15}
              max={600}
              step={15}
              value={form.duration}
              onChange={(e) =>
                setForm({ ...form, duration: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.active}
            disabled={form.archived}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          {form.archived ? "Услуга в архиве — сначала восстановите её в списке" : "Услуга доступна для записи"}
        </label>
        <p className="subtle">
          Цена и длительность существующих записей сохранятся. Новую услугу
          нужно назначить мастеру.
        </p>
        <button className="button button-dark" type="submit">
          Сохранить услугу
        </button>
      </form>
    </Modal>
  );
}
export function MasterForm({
  initial,
  onClose,
  onMessage,
}: {
  initial?: Master;
  onClose: () => void;
  onMessage: (s: string) => void;
}) {
  const { data, update } = useStore();
  const [form, setForm] = useState<Master>(
    initial ? { ...initial, published: initial.published === true } : {
      id: crypto.randomUUID(),
      name: "",
      specialty: "",
      photo: "",
      published: false,
      serviceIds: [],
      days: [1, 2, 3, 4, 5],
      start: "09:00",
      end: "20:00",
      breakStart: "13:00",
      breakEnd: "14:00",
      daysOff: [],
      vacationStart: "",
      vacationEnd: "",
    },
  );
  const [daysOff, setDaysOff] = useState(form.daysOff.join(", "));
  const legacySpecialty = initial?.specialty &&
    !masterSpecialties.some(value => value === initial.specialty) ? initial.specialty : '';
  const [photo, setPhoto] = useState<ImageDraft>({
    assetId: initial?.photoAssetId || null,
    legacySrc: initial?.photo || "",
    alt: initial?.photoAlt ?? initial?.name ?? "",
  });
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoLock = useRef(false);
  useEffect(() => {
    if (initial?.photoAssetId && isSupabase) {
      let active = true;
      void previewImages([initial.photoAssetId])
        .then((urls) => {
          if (active)
            setPhoto((p) =>
              p.assetId === initial.photoAssetId
                ? { ...p, previewUrl: urls[initial.photoAssetId!] }
                : p,
            );
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }
  }, [initial?.photoAssetId]);
  const [warning, setWarning] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const set = <K extends keyof Master>(key: K, value: Master[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setWarning(null);
    setError("");
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const off = daysOff
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    if (
      off.some(
        (d) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
          Number.isNaN(Date.parse(d)) ||
          new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) !== d,
      )
    )
      return setError("Укажите выходные через запятую в формате ГГГГ-ММ-ДД.");
    if (
      minutes(form.start) >= minutes(form.end) ||
      (form.breakStart &&
        form.breakEnd &&
        (minutes(form.breakStart) >= minutes(form.breakEnd) ||
          minutes(form.breakStart) < minutes(form.start) ||
          minutes(form.breakEnd) > minutes(form.end)))
    )
      return setError(
        "Проверьте рабочие часы и перерыв: начало должно быть раньше окончания, а перерыв — внутри рабочего дня.",
      );
    if (!!form.breakStart !== !!form.breakEnd)
      return setError("Укажите начало и конец перерыва или очистите оба поля.");
    if (
      !!form.vacationStart !== !!form.vacationEnd ||
      form.vacationStart > form.vacationEnd
    )
      return setError("Укажите корректные даты начала и окончания отпуска.");
    if (form.photo && !/^(\/images\/[^\s]+|https:\/\/[^\s]+)$/.test(form.photo))
      return setError(
        "Используйте локальный путь /images/… или HTTPS-ссылку на фотографию.",
      );
    const next = { ...form, name: form.name.trim(), daysOff: off };
    const updated = {
      ...data,
      masters: initial
        ? data.masters.map((m) => (m.id === next.id ? next : m))
        : [...data.masters, next],
    };
    const affected = scheduleConflicts(updated).filter(
      (a) => a.masterId === next.id,
    );
    if (affected.length && !warning)
      return setWarning(
        affected.map((a) => `${a.id} · ${a.date} ${a.time} · ${a.clientName}`),
      );
    if (photoLock.current) return;
    photoLock.current = true;
    setPhotoBusy(true);
    try {
      if (isSupabase) {
        const staged = await stageImage(photo);
        setPhoto(staged);
        next.photo = staged.legacySrc;
        next.photoAssetId = staged.assetId;
        next.photoAlt = staged.alt;
        next.photoVersion = initial?.photoVersion || 0;
      }
      if (
        !(await update(
          (d) => ({
            ...d,
            masters: initial
              ? d.masters.map((m) => (m.id === next.id ? next : m))
              : [...d.masters, next],
            notifications: [
              ...d.notifications,
              ...d.notificationSettings.channels.map((channel) => ({
                id: crypto.randomUUID(),
                appointmentId: "",
                event: "schedule" as const,
                recipient: `Мастер: ${next.name}`,
                channel,
                text: d.notificationSettings.templates.schedule.replace(
                  "{master}",
                  next.name,
                ),
                at: new Date().toISOString(),
                planned: false,
              })),
            ],
          }),
          warning !== null,
        ))
      )
        return;
      onMessage(
        "Профиль и расписание сохранены. Существующие записи сохранены.",
      );
      if (isSupabase) void mediaRequest("cleanup").catch(() => {});
      onClose();
    } catch (e) {
      setError(mediaError(e));
    } finally {
      photoLock.current = false;
      setPhotoBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={initial ? `Мастер ${initial.name}` : "Новый мастер"}
      onClose={() => {
        if (!photoBusy) onClose();
      }}
    >
      <form onSubmit={save} aria-busy={photoBusy}>
        <fieldset disabled={photoBusy} style={{ display: "contents" }}>
          <label htmlFor="master-name">
            Имя
            <input id="master-name" required maxLength={80}
              value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <section className="master-publication" aria-labelledby="master-publication-title">
            <h3 id="master-publication-title">Публикация на сайте</h3>
            <p className="subtle">
              {form.archived ? "В архиве — скрыт на сайте и недоступен для новых записей." : form.published ? "После сохранения профиль будет виден посетителям и доступен для онлайн-записи." : "Не опубликован — виден только в админке, новые записи недоступны."}
            </p>
            <label className="checkbox-label" htmlFor="master-published">
              <input id="master-published" name="published" type="checkbox"
                checked={form.published === true}
                onChange={(e) => set("published", e.target.checked)} />
              <span>Показывать мастера на сайте и разрешить онлайн-запись</span>
            </label>
            <p className="subtle">Изменение вступит в силу после нажатия «Сохранить мастера». Для записи нужны назначенная активная услуга и рабочее расписание. Архивный профиль нужно также восстановить.</p>
          </section>
            <label htmlFor="master-specialty">
              <span id="master-specialty-label">Специализация</span>
              <select id="master-specialty" aria-labelledby="master-specialty-label"
                required
                value={form.specialty}
                onChange={(e) => set("specialty", e.target.value)}
              >
                <option value="" disabled>Выберите специализацию</option>
                {legacySpecialty && <option value={legacySpecialty}>Текущее значение — выберите специализацию из списка: {legacySpecialty}</option>}
                {masterSpecialties.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            {legacySpecialty && form.specialty === legacySpecialty && <p className="subtle">Сохранённое значение: «{legacySpecialty}». Оно останется прежним, пока вы сами не выберете специализацию. Назначенные услуги меняются отдельно.</p>}
          <ImageEditor
            value={photo}
            onChange={setPhoto}
            ratio={3 / 4}
            disabled={!isSupabase || photoBusy}
            label="Фотография мастера"
          />
          {!isSupabase && (
            <p className="subtle">
              Загрузка фотографий доступна в режиме Supabase.
            </p>
          )}
          {photoBusy && (
            <p role="status">Проверка фотографии и сохранение профиля…</p>
          )}
          <fieldset>
            <legend>Услуги мастера</legend>
            <div className="checkbox-grid">
              {data.services.map((s) => (
                <label className="checkbox-label" key={s.id}>
                  <input
                    type="checkbox"
                    checked={form.serviceIds.includes(s.id)}
                    onChange={(e) =>
                      set(
                        "serviceIds",
                        e.target.checked
                          ? [...form.serviceIds, s.id]
                          : form.serviceIds.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.name}{s.archived ? " (в архиве)" : ""}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Рабочие дни</legend>
            <div className="days-toggle">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <button
                  type="button"
                  key={day}
                  aria-pressed={form.days.includes(day)}
                  className={form.days.includes(day) ? "selected" : ""}
                  onClick={() =>
                    set(
                      "days",
                      form.days.includes(day)
                        ? form.days.filter((d) => d !== day)
                        : [...form.days, day],
                    )
                  }
                >
                  {weekdays[day]}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="form-grid four">
            <label>
              Начало работы
              <input
                required
                type="time"
                value={form.start}
                onChange={(e) => set("start", e.target.value)}
              />
            </label>
            <label>
              Конец работы
              <input
                required
                type="time"
                value={form.end}
                onChange={(e) => set("end", e.target.value)}
              />
            </label>
            <label>
              Перерыв с
              <input
                type="time"
                value={form.breakStart}
                onChange={(e) => set("breakStart", e.target.value)}
              />
            </label>
            <label>
              Перерыв до
              <input
                type="time"
                value={form.breakEnd}
                onChange={(e) => set("breakEnd", e.target.value)}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Отпуск с
              <input
                type="date"
                value={form.vacationStart}
                onChange={(e) => set("vacationStart", e.target.value)}
              />
            </label>
            <label>
              Отпуск по
              <input
                type="date"
                value={form.vacationEnd}
                onChange={(e) => set("vacationEnd", e.target.value)}
              />
            </label>
          </div>
          <label>
            Отдельные выходные через запятую
            <input
              placeholder="2026-11-01, 2026-11-05"
              value={daysOff}
              onChange={(e) => {
                setDaysOff(e.target.value);
                setWarning(null);
              }}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {warning && (
            <div className="warning" role="alert">
              <strong>Изменение затрагивает {warning.length} записей.</strong>
              <p>
                Записи сохранятся. Свяжитесь с клиентами и перенесите их
                вручную.
              </p>
              <ul>
                {warning.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="button button-dark" type="submit">
            {warning
              ? "Сохранить график, не удаляя записи"
              : "Сохранить мастера"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
export function BlockForm({
  onClose,
  onMessage,
}: {
  onClose: () => void;
  onMessage: (s: string) => void;
}) {
  const { data, update } = useStore();
  const [form, setForm] = useState<Block>({
    id: crypto.randomUUID(),
    masterId: data.masters[0]?.id || "",
    date: today(),
    start: "16:00",
    end: "17:00",
    reason: "",
  });
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const change = (patch: Partial<Block>) => {
    setForm((f) => ({ ...f, ...patch }));
    setConfirmed(false);
    setError("");
  };
  const conflicting = data.appointments.filter(
    (a) =>
      occupies(a) &&
      a.masterId === form.masterId &&
      a.date === form.date &&
      overlaps(
        minutes(a.time),
        minutes(a.time) + a.duration,
        minutes(form.start),
        minutes(form.end),
      ),
  );
  return (
    <Modal title="Заблокировать время" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            minutes(form.start) >= minutes(form.end) ||
            instant(form.date, form.end) <= new Date()
          )
            return setError(
              "Укажите будущий интервал, начало которого раньше окончания.",
            );
          if (conflicting.length && !confirmed) {
            setConfirmed(true);
            return;
          }
          if (
            !(await update(
              (d) => ({
                ...d,
                blocks: [...d.blocks, form],
                notifications: [
                  ...d.notifications,
                  ...d.notificationSettings.channels.map((channel) => ({
                    id: crypto.randomUUID(),
                    appointmentId: "",
                    event: "schedule" as const,
                    recipient: `Мастер: ${d.masters.find((m) => m.id === form.masterId)?.name}`,
                    channel,
                    at: new Date().toISOString(),
                    planned: false,
                    text: `Заблокировано время ${form.date}, ${form.start}–${form.end}. ${form.reason}`,
                  })),
                ],
              }),
              confirmed,
            ))
          )
            return;
          onMessage("Время заблокировано. Существующие записи сохранены.");
          onClose();
        }}
      >
        <label>
          Мастер
          <select
            value={form.masterId}
            onChange={(e) => change({ masterId: e.target.value })}
          >
            {data.masters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата
          <input
            required
            type="date"
            min={today()}
            value={form.date}
            onChange={(e) => change({ date: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            С
            <input
              required
              type="time"
              value={form.start}
              onChange={(e) => change({ start: e.target.value })}
            />
          </label>
          <label>
            До
            <input
              required
              type="time"
              value={form.end}
              onChange={(e) => change({ end: e.target.value })}
            />
          </label>
        </div>
        <label>
          Причина
          <input
            value={form.reason}
            onChange={(e) => change({ reason: e.target.value })}
            placeholder="Обучение, личное время…"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {confirmed && (
          <div className="warning">
            <strong>В интервале есть записи: {conflicting.length}.</strong>
            <p>
              Они не будут удалены. Перенесите их вручную после согласования с
              клиентами.
            </p>
          </div>
        )}
        <button className="button button-dark" type="submit">
          {confirmed ? "Заблокировать, сохранив записи" : "Заблокировать время"}
        </button>
      </form>
    </Modal>
  );
}

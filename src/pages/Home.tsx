import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Clock3,
  Flower2,
  MapPin,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { useStore } from "../lib/store";
import { categories, durationLabel, money } from "../i18n";
import { dateLabel, today } from "../lib/schedule";
import { useNearestSlots } from "../lib/useAvailability";
import { isSupabase } from "../lib/supabase";
import type { BookingPreset, Category } from "../types";
import { Arrow, Brand, Empty, Modal } from "../components/UI";
import { useSiteContent } from "../lib/siteContent";
import { ContentImage, MasterImage } from "../components/SiteImage";
const categoryPhotos: Record<Category, string> = {
  hair: "/images/hair.jpg",
  nails: "/images/nails.jpg",
  brows: "/images/master-diana.jpg",
  makeup: "/images/master-elina.jpg",
  care: "/images/care.jpg",
};
export function Home({ onBook }: { onBook: (preset?: BookingPreset) => void }) {
  const { data } = useStore();
  const [category, setCategory] = useState<Category>("hair");
  const [portfolio, setPortfolio] = useState<string | null>(null);
  const [salonIndex, setSalonIndex] = useState(0);
  const { content } = useSiteContent();
  const hero = content.items.find((i) => i.kind === "hero");
  const salonPhotos = content.items
    .filter((i) => i.kind === "salon" && i.visible)
    .sort((a, b) => a.position - b.position);
  const activeSalonIndex = salonPhotos.length
    ? salonIndex % salonPhotos.length
    : 0;
  const works = content.items
    .filter((i) => i.kind === "portfolio" && i.visible)
    .sort((a, b) => a.position - b.position);
  const selectedWork = works.find((i) => i.id === portfolio);
  const nearest = useNearestSlots();
  return (
    <>
      <main>
        <section className="hero container">
          <div className="hero-copy">
            <div className="eyebrow hero-eyebrow">
              <span className="little-line" /> ВАШЕ ПРОСТРАНСТВО КРАСОТЫ В
              БИШКЕКЕ
            </div>
            <h1>
              Время
              <br />
              для <em>себя.</em>
              <span className="hero-star">✳</span>
            </h1>
            <p>
              Красота начинается с заботы.
              <br />
              Найдите свой ритуал, своего мастера
              <br className="desktop-break" /> и немного времени только для вас.
            </p>
            <div className="hero-buttons">
              <button className="button button-dark" onClick={() => onBook()}>
                Записаться онлайн <Arrow />
              </button>
              <a href="#services" className="text-link">
                Выбрать услугу <ArrowRight size={17} />
              </a>
            </div>
            <div className="hero-reassurance">
              <span>
                <Check size={15} /> Удобная онлайн-запись
              </span>
              <span>
                <Check size={15} /> Забота в каждой детали
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <ContentImage item={hero} fetchPriority="high" />
            <div className="hero-image-shade" />
            <div className="image-note">
              <span>
                ВЫДОХНИТЕ. ВЫ В {data.settings.name.toLocaleUpperCase("ru-RU")}.
              </span>
              <p>Здесь всё — о вас.</p>
            </div>
            <div className="hero-badge">
              <Flower2 size={24} />
              <span>
                Маленький ритуал.
                <br />
                <b>Большая любовь к себе.</b>
              </span>
            </div>
          </div>
        </section>
        <div className="ritual-strip">
          <div className="container">
            <span>ВОЛОСЫ</span>
            <i>✳</i>
            <span>НОГТИ</span>
            <i>✳</i>
            <span>БРОВИ И РЕСНИЦЫ</span>
            <i>✳</i>
            <span>МАКИЯЖ</span>
            <i>✳</i>
            <span>УХОД И ЗАБОТА</span>
          </div>
        </div>
        <section
          className="section container nearest-section"
          id="availability"
        >
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                <span className="live-dot" /> ДЛЯ СПОНТАННОЙ ЗАБОТЫ О СЕБЕ
              </div>
              <h2>Есть время для вас</h2>
              <p>Ближайшие свободные окошки — выберите своё.</p>
            </div>
            <button className="text-link" onClick={() => onBook()}>
              Все свободные даты <ArrowRight size={17} />
            </button>
          </div>
          <div className="slots-grid">
            {nearest.map((slot) => (
              <article className="slot-card" key={slot.service.id}>
                <div className="slot-top">
                  <span className="slot-date">
                    {slot.date === today()
                      ? "Сегодня"
                      : dateLabel(slot.date, {
                          day: "numeric",
                          month: "short",
                        })}{" "}
                    <b>· {slot.time}</b>
                  </span>
                  <Arrow size={20} />
                </div>
                <h3>{slot.service.name}</h3>
                <div className="slot-master">
                  <MasterImage master={slot.master} />
                  <span>
                    {slot.master.name}
                    <small>{durationLabel(slot.service.duration)}</small>
                  </span>
                </div>
                <div className="slot-bottom">
                  <strong>{money(slot.service.price)}</strong>
                  <button
                    onClick={() =>
                      onBook({
                        serviceId: slot.service.id,
                        masterId: slot.masterId,
                        date: slot.date,
                        time: slot.time,
                      })
                    }
                  >
                    Записаться <Arrow size={16} />
                  </button>
                </div>
              </article>
            ))}
            {!nearest.length && (
              <Empty title="Свободных окошек пока нет">
                <p>Посмотрите другие услуги или мастеров.</p>
                <button
                  className="button button-light"
                  onClick={() => onBook()}
                >
                  Выбрать услугу
                </button>
              </Empty>
            )}
          </div>
        </section>
        <section className="services-section section" id="services">
          <div className="container">
            <div className="section-heading">
              <div>
                <div className="eyebrow">МАЛЕНЬКИЕ РИТУАЛЫ КРАСОТЫ</div>
                <h2>
                  То, что вам <em>нужно</em>
                </h2>
              </div>
              <p className="heading-aside">
                От любимой стрижки до часа тишины.
                <br />
                Выбирайте заботу по настроению.
              </p>
            </div>
            <div
              className="category-tabs"
              role="tablist"
              aria-label="Категории услуг"
            >
              {Object.entries(categories).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={category === id}
                  aria-controls="service-panel"
                  id={`tab-${id}`}
                  tabIndex={category === id ? 0 : -1}
                  onKeyDown={(e) => {
                    const ids = Object.keys(categories) as Category[];
                    const index = ids.indexOf(category);
                    const next =
                      e.key === "ArrowRight"
                        ? ids[(index + 1) % ids.length]
                        : e.key === "ArrowLeft"
                          ? ids[(index + ids.length - 1) % ids.length]
                          : e.key === "Home"
                            ? ids[0]
                            : e.key === "End"
                              ? ids[ids.length - 1]
                              : null;
                    if (next) {
                      e.preventDefault();
                      setCategory(next);
                      document.getElementById(`tab-${next}`)?.focus();
                    }
                  }}
                  onClick={() => setCategory(id as Category)}
                  className={category === id ? "active" : ""}
                >
                  {label}
                  <Arrow size={15} />
                </button>
              ))}
            </div>
            <div
              className="service-layout"
              role="tabpanel"
              id="service-panel"
              aria-labelledby={`tab-${category}`}
            >
              <div className="service-photo">
                <img
                  src={categoryPhotos[category]}
                  alt={`Вдохновение для категории «${categories[category]}»`}
                  loading="lazy"
                />
                <div>
                  <span>01 — ВАША НОВАЯ ИСТОРИЯ</span>
                  <p>
                    {category === "hair"
                      ? "Лёгкость в каждом движении"
                      : category === "nails"
                        ? "Красота в деталях"
                        : "Позвольте себе сиять"}
                  </p>
                </div>
              </div>
              <div className="service-list">
                {data.services
                  .filter((s) => s.category === category && s.active && !s.archived)
                  .map((s) => (
                    <article className="service-row" key={s.id}>
                      <div>
                        <h3>{s.name}</h3>
                        <p>{s.description}</p>
                        <span className="duration">
                          <Clock3 size={13} />
                          {durationLabel(s.duration)}
                        </span>
                      </div>
                      <div className="service-price">
                        <strong>{money(s.price)}</strong>
                        <button
                          className="round-button"
                          aria-label={`Записаться: ${s.name}`}
                          onClick={() => onBook({ serviceId: s.id })}
                        >
                          <Arrow size={20} />
                        </button>
                      </div>
                    </article>
                  ))}
                {!data.services.some(
                  (s) => s.category === category && s.active && !s.archived,
                ) && <Empty title="Скоро здесь появятся услуги" />}
                <div className="service-footnote">
                  {isSupabase
                    ? "Стоимость фиксируется при записи. Без онлайн-оплаты."
                    : "Цены и услуги демонстрационные. Без онлайн-оплаты."}
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="section container" id="masters">
          <div className="section-heading">
            <div>
              <div className="eyebrow">КРАСОТА НАЧИНАЕТСЯ С ДОВЕРИЯ</div>
              <h2>В хороших руках</h2>
            </div>
            <p className="heading-aside">
              Знакомьтесь с вашей командой заботы.
              <br />
              <span className="subtle">Демонстрационные профили мастеров.</span>
            </p>
          </div>
          <div className="masters-grid">
            {data.masters.filter(m => !m.archived).map((m) => (
              <article className="master-card" key={m.id}>
                <div className="master-photo">
                  <MasterImage master={m} loading="lazy" />
                  <span className="master-mark">
                    {data.settings.name.charAt(0).toLocaleLowerCase("ru-RU")}.
                  </span>
                </div>
                <div className="master-info">
                  <h3>{m.name}</h3>
                  <p>{m.specialty}</p>
                  <button onClick={() => onBook({ masterId: m.id })}>
                    Посмотреть свободное время <Arrow size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="about-section" id="about">
          <div className="container about-layout">
            <div className="about-image">
              <ContentImage
                item={salonPhotos[activeSalonIndex]}
                loading="lazy"
              />
              <span>МЕСТО, ГДЕ МОЖНО ПРОСТО БЫТЬ СОБОЙ</span>
              {salonPhotos.length > 1 && (
                <div
                  className="salon-photo-controls"
                  aria-label="Фотографии салона"
                >
                  <button
                    type="button"
                    aria-label="Предыдущее фото салона"
                    onClick={() =>
                      setSalonIndex(
                        (i) =>
                          (i - 1 + salonPhotos.length) % salonPhotos.length,
                      )
                    }
                  >
                    ←
                  </button>
                  <span>
                    {activeSalonIndex + 1} / {salonPhotos.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Следующее фото салона"
                    onClick={() =>
                      setSalonIndex((i) => (i + 1) % salonPhotos.length)
                    }
                  >
                    →
                  </button>
                </div>
              )}
            </div>
            <div className="about-copy">
              <Flower2 size={33} strokeWidth={1} />
              <div className="eyebrow">ЧУТЬ БОЛЬШЕ, ЧЕМ САЛОН</div>
              <h2>
                Ваша красота.
                <br />
                Ваша <em>атмосфера.</em>
              </h2>
              <p>
                {data.settings.name} — идея пространства, в котором забота о
                себе становится приятной привычкой. Без спешки, лишнего шума и
                необходимости быть кем-то ещё.
              </p>
              <p>
                Мы создаём место для маленьких перемен и больших улыбок. Для
                разговора по душам или часа наедине с собой.
              </p>
              <div className="about-values">
                <span>
                  <ShieldCheck size={19} /> Бережный подход
                </span>
                <span>
                  <Sparkles size={19} /> Внимание к деталям
                </span>
              </div>
              <small>
                Концепция будущего салона. Фотографии иллюстративные.
              </small>
            </div>
          </div>
        </section>
        <section className="section container" id="portfolio">
          <div className="section-heading">
            <div>
              <div className="eyebrow">КРАСОТА БЕЗ ЛИШНИХ СЛОВ</div>
              <h2>Вдохновение для вас</h2>
            </div>
            <p className="heading-aside">
              Настроение будущего портфолио.
              <br />
              Иллюстрации, не работы реального салона.
            </p>
          </div>
          <div className="portfolio-grid">
            {works.map((work) => (
              <button
                className="portfolio-card"
                key={work.id}
                onClick={() => setPortfolio(work.id)}
              >
                <ContentImage item={work} loading="lazy" />
                <div>
                  <span>{work.category}</span>
                  <h3>{work.caption}</h3>
                  <Arrow size={23} />
                </div>
              </button>
            ))}
          </div>
        </section>
        <section className="reviews-section section">
          <div className="container">
            <div className="section-heading">
              <div>
                <div className="eyebrow">СЛОВА, КОТОРЫЕ СОГРЕВАЮТ</div>
                <h2>После встречи</h2>
              </div>
              <span className="demo-label">Примеры отзывов · демо</span>
            </div>
            <div className="reviews-grid">
              {[
                {
                  name: "Мээрим",
                  text: "Именно тот момент, когда можно выдохнуть и посвятить время себе. Очень нравится эта атмосфера.",
                  service: "Стрижка и укладка",
                },
                {
                  name: "Анастасия",
                  text: "Красивый нюд, аккуратная форма и никакой спешки. Такой и хочется видеть заботу о себе.",
                  service: "Маникюр с покрытием",
                },
                {
                  name: "Айпери",
                  text: "Лёгкий макияж, в котором остаёшься собой. Приятно, когда слышат твои пожелания.",
                  service: "Дневной макияж",
                },
              ].map((r) => (
                <article className="review" key={r.name}>
                  <div
                    className="review-stars"
                    aria-label="Демонстрационная оценка: 5 из 5"
                  >
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star key={i} size={13} fill="currentColor" />
                    ))}
                  </div>
                  <blockquote>«{r.text}»</blockquote>
                  <div>
                    <strong>{r.name}</strong>
                    <span>{r.service} · демопример</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="section container faq-layout">
          <div>
            <div className="eyebrow">ВСЁ, ЧТО ХОТЕЛОСЬ УТОЧНИТЬ</div>
            <h2>
              Перед
              <br />
              <em>встречей</em>
            </h2>
            <p className="subtle">Пара ответов, чтобы вам было спокойнее.</p>
          </div>
          <div className="faq-list">
            {[
              {
                q: "Как записаться на процедуру?",
                a: "Нажмите «Записаться», выберите услугу, мастера, дату и удобное время. В демоверсии используйте вымышленные имя и телефон: настоящая запись в салон не создаётся.",
              },
              {
                q: "Можно ли перенести или отменить запись?",
                a: data.settings.cancellationPolicy,
              },
              {
                q: "Как выбрать мастера?",
                a: "Выберите конкретного специалиста или «Любой свободный мастер». Мы покажем только тех, кто оказывает выбранную услугу. При выборе любого мастера его имя будет указано до подтверждения.",
              },
              {
                q: "Нужно ли вносить предоплату?",
                a: "В этом прототипе оплата не предусмотрена. Итоговая демонстрационная стоимость видна на каждом шаге записи.",
              },
              {
                q: "Почему некоторые часы недоступны?",
                a: "Свободное время учитывает длительность процедуры, рабочий график, перерывы, отпуск мастера и уже существующие записи. Всё время указано по Бишкеку (UTC+6).",
              },
            ].map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <Plus size={19} />
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="contact-section" id="contacts">
          <div className="container contact-layout">
            <div>
              <div className="eyebrow">ВАШ СЛЕДУЮЩИЙ МАЛЕНЬКИЙ ПРАЗДНИК</div>
              <h2>
                Увидимся
                <br />в <em>{data.settings.name}.</em>
              </h2>
              <div className="contact-details">
                <p>
                  <MapPin size={18} />
                  <span>
                    {data.settings.address ||
                      "Бишкек · точный адрес скоро появится"}
                  </span>
                </p>
                <p>
                  <Clock3 size={18} />
                  <span>
                    {data.settings.days.length === 7
                      ? "Ежедневно"
                      : "Рабочие дни — в форме записи"}
                    , {data.settings.start}–{data.settings.end}
                    <small>Время Бишкека · Asia/Bishkek</small>
                  </span>
                </p>
                {data.settings.phone ? (
                  <a href={`tel:${data.settings.phone}`}>
                    {data.settings.phone}
                  </a>
                ) : (
                  <p className="subtle">Телефон и контакты пока не указаны.</p>
                )}
                {data.settings.email && (
                  <a href={`mailto:${data.settings.email}`}>
                    {data.settings.email}
                  </a>
                )}
              </div>
              <button className="button button-dark" onClick={() => onBook()}>
                Найти время для себя <Arrow />
              </button>
            </div>
            <div className="map-placeholder">
              <div className="map-grid" />
              <div className="map-content">
                <MapPin size={29} strokeWidth={1} />
                <h3>Скоро встретимся здесь</h3>
                <p>
                  {data.settings.address || "Бишкек, Кыргызстан"}
                  <br />
                  Карта появится после подтверждения адреса.
                </p>
                <span>Без вымышленной отметки на карте</span>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="container footer-main">
          <Brand />
          <p>Красота — это быть собой.</p>
          <Link to="/admin">
            {isSupabase ? "Вход для команды" : "Демо админ-панели"}{" "}
            <Arrow size={15} />
          </Link>
        </div>
        <div className="container footer-bottom">
          <span>
            © {new Date().getFullYear()} {data.settings.name}{" "}
            {data.settings.tagline} · Концепция
          </span>
          <span>
            Фото: Unsplash ·{" "}
            {isSupabase ? "Онлайн-запись" : "Данные хранятся в этом браузере"}
          </span>
        </div>
      </footer>
      {selectedWork && (
        <Modal
          title={selectedWork.caption || "Работа салона"}
          onClose={() => setPortfolio(null)}
        >
          <ContentImage className="lightbox-photo" item={selectedWork} />
          <p className="subtle">{selectedWork.category}</p>
        </Modal>
      )}
    </>
  );
}

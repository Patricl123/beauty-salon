import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Menu, X } from "lucide-react";
import { isSupabase } from "../lib/supabase";
import { Brand, Arrow } from "./UI";
import { useStore } from "../lib/store";
import { useSiteContent } from "../lib/siteContent";
import { isPublishedMaster, isPublishedWork } from "../lib/publicContent";
export function Header({ onBook }: { onBook: () => void }) {
  const [open, setOpen] = useState(false);
  const { data } = useStore();
  const { content } = useSiteContent();
  return (
    <>
      <div className="demo-strip">
        {isSupabase ? (
          <>
            Онлайн-запись <span>·</span> Время салона — Бишкек
          </>
        ) : (
          <>
            Демонстрационная версия <span>·</span> Записи тестовые — используйте
            вымышленные данные
          </>
        )}
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav
            aria-label="Основная навигация"
            className={open ? "nav open" : "nav"}
          >
            {[
              ["services", "Услуги и цены"],
              ...(data.masters.some(isPublishedMaster) ? [["masters", "Мастера"]] : []),
              ["about", "О салоне"],
              ...(content.items.some(isPublishedWork) ? [["portfolio", "Наши работы"]] : []),
              ["contacts", "Контакты"],
            ].map(([id, label]) => (
              <a key={id} href={`/#${id}`} onClick={() => setOpen(false)}>
                {label}
              </a>
            ))}
            <Link
              className="mobile-nav-bookings"
              to="/bookings"
              onClick={() => setOpen(false)}
            >
              Мои записи
            </Link>
          </nav>
          <div className="header-actions">
            <Link className="my-bookings" to="/bookings">
              <CalendarDays size={17} /> Мои записи
            </Link>
            <button className="button button-dark header-book" onClick={onBook}>
              Записаться <Arrow />
            </button>
            <button
              className="icon-button menu-button"
              onClick={() => setOpen(!open)}
              aria-label={open ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={open}
            >
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <button className="button button-dark mobile-book" onClick={onBook}>
        Записаться онлайн <Arrow />
      </button>
    </>
  );
}

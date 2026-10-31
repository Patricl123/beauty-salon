import { useState } from "react";
import { MapPin } from "lucide-react";
import type { SalonSettings } from "../types";
import { locationLinks } from "../lib/publicContent";

export function LocationMap({ settings }: { settings: SalonSettings }) {
  const { route, embed, confirmed } = locationLinks(settings);
  const [failedUrl, setFailedUrl] = useState("");
  return (
    <div className="location-map">
      <h3>Где мы находимся</h3>
      <p className="location-address">
        <MapPin size={18} />
        <span>{settings.address || "Адрес уточняется"}</span>
      </p>
      {settings.buildingDescription && <p>{settings.buildingDescription}</p>}
      {embed && failedUrl !== embed ? (
        <iframe
          key={embed}
          src={embed}
          title="Карта расположения салона"
          loading="lazy"
          referrerPolicy="no-referrer"
          allowFullScreen
          onError={() => setFailedUrl(embed)}
        />
      ) : (
        <div className="location-map-notice">
          {confirmed
            ? "Встроенная карта недоступна. Откройте здание по ссылке ниже."
            : "Точка на карте уточняется. Пока доступен поиск по адресу."}
        </div>
      )}
      {settings.address && (
        <a
          className="button button-light"
          href={route}
          target="_blank"
          rel="noopener noreferrer"
        >
          Построить маршрут
        </a>
      )}
      <p className="subtle">
        {confirmed
          ? "Кнопка откроет картографический сервис. Если карта не загрузилась, адрес и ссылка остаются доступны."
          : "Ссылка откроет поиск по адресу, а не подтверждённую точку. Проверьте найденное здание перед поездкой."}
      </p>
    </div>
  );
}

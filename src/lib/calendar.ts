import { isSupabase } from "./supabase";
import type { Appointment, AppData } from "../types";
import { instant, minutes, clock } from "./schedule";
const escape = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
export function calendarText(a: Appointment, data: AppData) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AURA//Beauty Demo//RU",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${a.id}@aura-demo.local`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(instant(a.date, a.time))}`,
    `DTEND:${stamp(instant(a.date, clock(minutes(a.time) + a.duration)))}`,
    `SUMMARY:${escape(`${data.settings.name}: ${a.serviceName}${isSupabase ? "" : " (демо)"}`)}`,
    `DESCRIPTION:${escape(`${isSupabase ? "Запись в салон." : "Демонстрационная запись."} Мастер: ${data.masters.find((m) => m.id === a.masterId)?.name}. Номер: ${a.id}`)}`,
    `LOCATION:${escape(data.settings.address || "Бишкек — адрес уточняется")}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
export function downloadCalendar(a: Appointment, data: AppData) {
  const url = URL.createObjectURL(
    new Blob([calendarText(a, data)], { type: "text/calendar;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `aura-${a.id}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

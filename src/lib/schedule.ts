import type { AppData, Appointment, Master, Service } from '../types';
export const TIME_ZONE = 'Asia/Bishkek';
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
export const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const instant = (date: string, time: string) => new Date(`${date}T${time}:00+06:00`);
export const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: TIME_ZONE }).format(new Date(`${date}T12:00:00+06:00`));
export const overlaps = (start: number, end: number, otherStart: number, otherEnd: number) => start < otherEnd && end > otherStart;
export const occupies = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'noshow';
export function isWorking(master: Master, date: string) {
  return master.days.includes(weekday(date)) && !master.daysOff.includes(date) && !(master.vacationStart && master.vacationEnd && date >= master.vacationStart && date <= master.vacationEnd);
}
export function fitsSchedule(data: AppData, master: Master, date: string, time: string, duration: number) {
  const start = minutes(time), end = start + duration;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0 || !isWorking(master, date) || !data.settings.days.includes(weekday(date))) return false;
  if (start < Math.max(minutes(master.start), minutes(data.settings.start)) || end > Math.min(minutes(master.end), minutes(data.settings.end))) return false;
  if (master.breakStart && master.breakEnd && overlaps(start, end, minutes(master.breakStart), minutes(master.breakEnd))) return false;
  return !data.blocks.some(b => b.masterId === master.id && b.date === date && overlaps(start, end, minutes(b.start), minutes(b.end)));
}
export function isAvailable(data: AppData, service: Service, master: Master, date: string, time: string, excludeId?: string, now = new Date()) {
  if (service.archived || master.archived || !service.active || !master.serviceIds.includes(service.id) || !fitsSchedule(data, master, date, time, service.duration)) return false;
  if (instant(date, time).getTime() <= now.getTime()) return false;
  const start = minutes(time), end = start + service.duration;
  return !data.appointments.some(a => a.id !== excludeId && a.masterId === master.id && a.date === date && occupies(a) && overlaps(start, end, minutes(a.time), minutes(a.time) + a.duration));
}
export interface Slot { time: string; masterId: string; }
export function getSlots(data: AppData, serviceId: string, masterId: string, date: string, excludeId?: string, now = new Date()): Slot[] {
  const service = data.services.find(s => s.id === serviceId);
  if (!service?.active) return [];
  const masters = data.masters.filter(m => (masterId === 'any' || m.id === masterId) && m.serviceIds.includes(serviceId));
  const slots: Slot[] = [];
  for (let t = 0; t < 24 * 60; t += 30) {
    const time = clock(t);
    const master = masters.find(m => isAvailable(data, service, m, date, time, excludeId, now));
    if (master) slots.push({ time, masterId: master.id });
  }
  return slots;
}
export function nextAvailable(data: AppData, serviceId: string, masterId = 'any', from = today(), excludeId?: string) {
  for (let offset = 0; offset <= 60; offset++) {
    const date = addDays(from, offset);
    if (date > addDays(today(), 60)) break;
    const slots = getSlots(data, serviceId, masterId, date, excludeId);
    if (slots.length) return { date, ...slots[0] };
  }
  return null;
}
export function scheduleConflicts(data: AppData) {
  return data.appointments.filter(a => occupies(a) && instant(a.date, a.time) > new Date() && !fitsSchedule(data, data.masters.find(m => m.id === a.masterId)!, a.date, a.time, a.duration));
}

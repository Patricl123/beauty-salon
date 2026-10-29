import type { AppData, Appointment, Notification, NotificationEvent } from '../types';
import { dateLabel, instant } from './schedule';
export function makeNotifications(data: AppData, a: Appointment, event: NotificationEvent): Notification[] {
  const name = data.masters.find(m => m.id === a.masterId)?.name || '';
  const vars: Record<string, string> = { name: a.clientName, number: a.id, service: a.serviceName, date: dateLabel(a.date), time: a.time, master: name };
  const result: Notification[] = [];
  const emit = (ev: NotificationEvent, recipient: string, at: string, planned = false) => {
    const message = data.notificationSettings.templates[ev].replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
    for (const channel of data.notificationSettings.channels) result.push({ id: crypto.randomUUID(), appointmentId: a.id, event: ev, recipient, channel, text: message, at, planned });
  };
  const now = new Date().toISOString();
  emit(event, `Клиент: ${a.clientName} · ${a.phone}`, now);
  if (event === 'created' || event === 'cancelled') emit(event, 'Администратор', now);
  if (event === 'created' || event === 'rescheduled' || event === 'cancelled') emit(event, `Мастер: ${name}`, now);
  if (event === 'created' || event === 'rescheduled' || event === 'confirmed') {
    for (const hours of [24, 2] as const) {
      if (!data.notificationSettings[hours === 24 ? 'reminder24' : 'reminder2']) continue;
      const at = new Date(instant(a.date, a.time).getTime() - hours * 3600000);
      if (at > new Date()) emit(hours === 24 ? 'reminder24' : 'reminder2', `Клиент: ${a.clientName} · ${a.phone}`, at.toISOString(), true);
    }
  }
  return result;
}

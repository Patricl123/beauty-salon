import type { AppData, Master, NotificationSettings, Service } from '../types';
import { addDays, today, weekday } from '../lib/schedule';
const service = (id: string, category: Service['category'], name: string, description: string, price: number, duration: number): Service => ({ id, category, name, description, price, duration, active: true });
export const services: Service[] = [
  service('haircut', 'hair', 'Стрижка и укладка', 'Форма, которая подчеркнёт вас. Консультация, мытьё и лёгкая укладка включены.', 2200, 60),
  service('color', 'hair', 'Окрашивание в один тон', 'Ровный оттенок, бережная формула и красивый блеск.', 5500, 120),
  service('styling', 'hair', 'Укладка и локоны', 'Естественное движение и объём для вашего особенного дня.', 1800, 60),
  service('treatment', 'hair', 'Восстановление волос', 'Глубокий уход для мягкости, гладкости и сияния.', 3000, 90),
  service('manicure', 'nails', 'Маникюр с покрытием', 'Бережный маникюр, выравнивание и ваш любимый оттенок.', 1800, 90),
  service('pedicure', 'nails', 'Педикюр с покрытием', 'Тщательный уход за стопами и стойкое покрытие.', 2400, 90),
  service('nude', 'nails', 'Маникюр без покрытия', 'Чистая форма и аккуратный уход за натуральными ногтями.', 1000, 60),
  service('brows', 'brows', 'Архитектура бровей', 'Индивидуальная форма, коррекция и окрашивание.', 1200, 60),
  service('lamination', 'brows', 'Ламинирование ресниц', 'Выразительный изгиб и открытый взгляд без наращивания.', 2000, 90),
  service('makeup', 'makeup', 'Вечерний макияж', 'Выразительные акценты и стойкий образ для важного события.', 3000, 90),
  service('daymakeup', 'makeup', 'Лёгкий дневной макияж', 'Свежая кожа, мягкие оттенки и ваша естественная красота.', 2000, 60),
  service('facial', 'care', 'Увлажняющий уход', 'Мягкое очищение, сыворотка и маска по потребностям кожи.', 2800, 60),
  service('massage', 'care', 'Массаж лица', 'Час спокойствия: расслабление, тонус и бережная забота.', 2000, 60),
];
const master = (id: string, name: string, specialty: string, photo: string, serviceIds: string[], days: number[]): Master => ({ id, name, specialty, photo, published: false, serviceIds, days, start: '09:00', end: '20:00', breakStart: '13:00', breakEnd: '14:00', daysOff: [], vacationStart: '', vacationEnd: '' });
export const masters: Master[] = [
  master('aida', 'Аида', 'Стилист по волосам', '/images/master-aida.jpg', ['haircut', 'color', 'styling', 'treatment'], [1, 2, 3, 5, 6, 0]),
  master('aliya', 'Алия', 'Мастер маникюра', '/images/master-aliya.jpg', ['manicure', 'pedicure', 'nude'], [1, 2, 4, 5, 6, 0]),
  master('diana', 'Диана', 'Бровист · визажист', '/images/master-diana.jpg', ['brows', 'lamination', 'makeup', 'daymakeup'], [1, 3, 4, 5, 6, 0]),
  master('amina', 'Амина', 'Специалист по уходу', '/images/master-amina.jpg', ['facial', 'massage', 'brows'], [1, 2, 3, 4, 6, 0]),
  master('elina', 'Элина', 'Стилист · визажист', '/images/master-elina.jpg', ['haircut', 'styling', 'makeup', 'daymakeup'], [2, 3, 4, 5, 6, 0]),
];
export const notificationSettings: NotificationSettings = {
  channels: ['WhatsApp'], reminder24: true, reminder2: true,
  templates: {
    created: '{name}, ваша запись {number}: {service}, {date} в {time}, мастер {master}. Ожидаем подтверждения.',
    confirmed: '{name}, запись {number} подтверждена. Ждём вас {date} в {time}.',
    rescheduled: '{name}, запись {number} перенесена на {date}, {time}. Мастер: {master}.',
    cancelled: '{name}, запись {number} отменена. Будем рады новой встрече.',
    reminder24: '{name}, напоминаем: завтра {service}, {time}. Мастер: {master}.',
    reminder2: '{name}, до встречи через 2 часа! {service}, {time}.',
    schedule: 'Расписание мастера {master} обновлено. Проверьте предстоящие записи.',
  },
};
export function createSeed(): AppData {
  const data: AppData = { version: 1, services: structuredClone(services), masters: structuredClone(masters), appointments: [], blocks: [], clientNotes: {}, notifications: [], notificationSettings: structuredClone(notificationSettings), settings: { name: 'AURA', tagline: 'Beauty Bishkek', address: 'Бишкек, Проспект Манаса, 38 / Киевская улица, 164', buildingDescription: 'Малоэтажный жилой дом', mapUrl: 'https://2gis.kg/bishkek/geo/15763234351108741/74.587887,42.875068', mapEmbedUrl: 'https://yandex.ru/map-widget/v1/?ll=74.587887%2C42.875068&z=17&pt=74.587887%2C42.875068%2Cpm2rdm', mapConfirmed: true, phone: '', email: '', start: '09:00', end: '20:00', days: [0, 1, 2, 3, 4, 5, 6], cancellationPolicy: 'Перенесите или отмените запись в разделе «Мои записи». Будем благодарны, если вы сообщите об изменениях за 3 часа до визита. В демоверсии отмена доступна без ограничений.' } };
  const base = today();
  let n = 1;
  for (let day = -2; day < 8; day++) {
    for (let mi = 0; mi < masters.length; mi++) {
      const m = masters[mi], date = addDays(base, day);
      if (!m.days.includes(weekday(date))) continue;
      const s = services.find(s => s.id === m.serviceIds[0])!;
      const status = day < 0 ? (mi === 2 ? 'noshow' : 'completed') : day === 2 && mi === 1 ? 'cancelled' : mi % 2 ? 'pending' : 'confirmed';
      data.appointments.push({ id: `A${String(n++).padStart(4, '0')}`, serviceId: s.id, serviceName: s.name, masterId: m.id, date, time: mi % 2 ? '15:00' : '10:00', duration: s.duration, price: s.price, clientName: ['Анастасия (демо)', 'Мээрим (демо)', 'София (демо)', 'Айпери (демо)', 'Мария (демо)'][mi], phone: `+99600000000${mi}`, comment: 'Демонстрационная запись', status, owner: day === 1 && mi === 0 ? 'visitor' : 'salon', createdAt: new Date().toISOString() });
    }
  }
  if (!data.appointments.some(a => a.owner === 'visitor')) { const sample = data.appointments.find(a => a.date > base); if (sample) sample.owner = 'visitor'; }
  data.blocks.push({ id: 'demo-block', masterId: 'aida', date: addDays(base, 2), start: '16:00', end: '17:00', reason: 'Обучение команды' });
  return data;
}

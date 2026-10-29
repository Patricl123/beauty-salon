// Add a `ky` dictionary here, then expose locale selection in the header.
export const locale = 'ru-RU';
export const categories = { hair: 'Волосы', nails: 'Ногти', brows: 'Брови и ресницы', makeup: 'Макияж', care: 'Уход' } as const;
export const statuses = { pending: 'Ожидает подтверждения', confirmed: 'Подтверждена', arrived: 'Клиент пришёл', completed: 'Завершена', cancelled: 'Отменена', noshow: 'Неявка' } as const;
export const events = { created: 'Новая запись', confirmed: 'Подтверждение', rescheduled: 'Перенос', cancelled: 'Отмена', reminder24: 'За 24 часа', reminder2: 'За 2 часа', schedule: 'Изменение расписания' } as const;
export const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const money = (value: number) => `${new Intl.NumberFormat(locale).format(value)} сом`;
export const durationLabel = (value: number) => value < 60 ? `${value} мин` : `${Math.floor(value / 60)} ч${value % 60 ? ` ${value % 60} мин` : ''}`;

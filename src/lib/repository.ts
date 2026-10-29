import type { AppData } from '../types';
import { createSeed } from '../data/seed';
export const STORAGE_KEY = 'aura-beauty-demo-v1';
// The only persistence boundary. Replace with an authenticated API repository later.
export const repository = {
  read(): AppData {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeed();
    const data = JSON.parse(raw) as AppData;
    if (data.version !== 1 || !Array.isArray(data.appointments) || !Array.isArray(data.masters) || !Array.isArray(data.services) || !data.settings || !data.notificationSettings || !data.clientNotes || !Array.isArray(data.blocks) || !Array.isArray(data.notifications)) throw new Error('Сохранённые демоданные повреждены. Можно сбросить их в настройках.');
    return data;
  },
  write(data: AppData) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); },
};

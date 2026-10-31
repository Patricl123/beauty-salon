export type Category = "hair" | "nails" | "brows" | "makeup" | "care";
export type Status =
  "pending" | "confirmed" | "arrived" | "completed" | "cancelled" | "noshow";
export interface Service {
  archived?: boolean;
  id: string;
  category: Category;
  name: string;
  description: string;
  price: number;
  duration: number;
  active: boolean;
}
export interface Master {
  published?: boolean;
  archived?: boolean;
  id: string;
  name: string;
  specialty: string;
  photo: string;
  photoAssetId?: string | null;
  photoAlt?: string;
  photoVersion?: number;
  serviceIds: string[];
  days: number[];
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
  daysOff: string[];
  vacationStart: string;
  vacationEnd: string;
}
export interface Appointment {
  masterName?: string;
  id: string;
  serviceId: string;
  masterId: string;
  date: string;
  time: string;
  duration: number;
  price: number;
  serviceName: string;
  clientName: string;
  phone: string;
  comment: string;
  status: Status;
  owner: "visitor" | "salon";
  createdAt: string;
  version?: number;
}
export interface Block {
  id: string;
  masterId: string;
  date: string;
  start: string;
  end: string;
  reason: string;
}
export interface SalonSettings {
  buildingDescription?: string;
  mapUrl?: string;
  mapEmbedUrl?: string;
  mapConfirmed?: boolean;
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  start: string;
  end: string;
  days: number[];
  cancellationPolicy: string;
}
export type NotificationEvent =
  | "created"
  | "confirmed"
  | "rescheduled"
  | "cancelled"
  | "reminder24"
  | "reminder2"
  | "schedule";
export interface Notification {
  id: string;
  appointmentId: string;
  event: NotificationEvent;
  recipient: string;
  channel: "SMS" | "WhatsApp" | "email";
  text: string;
  at: string;
  planned: boolean;
}
export interface NotificationSettings {
  channels: ("SMS" | "WhatsApp" | "email")[];
  reminder24: boolean;
  reminder2: boolean;
  templates: Record<NotificationEvent, string>;
}
export interface AppData {
  version: 1;
  revision?: number;
  services: Service[];
  masters: Master[];
  appointments: Appointment[];
  blocks: Block[];
  clientNotes: Record<string, string>;
  settings: SalonSettings;
  notifications: Notification[];
  notificationSettings: NotificationSettings;
}
export interface BookingPreset {
  serviceId?: string;
  masterId?: string;
  date?: string;
  time?: string;
  editId?: string;
  admin?: boolean;
}
export type CatalogKind = "master" | "service";
export type CatalogAction = "delete" | "archive" | "restore";
export interface CatalogImpact {
  total: number;
  future: number;
  archived: boolean;
  revision: number;
}

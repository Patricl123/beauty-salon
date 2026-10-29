import type {
  AppData,
  CatalogAction,
  CatalogImpact,
  CatalogKind,
} from "../types";
import { instant } from "./schedule";

export function catalogImpact(
  data: AppData,
  kind: CatalogKind,
  id: string,
): CatalogImpact {
  const item = (kind === "master" ? data.masters : data.services).find(
    (item) => item.id === id,
  );
  if (!item) throw { message: "CATALOG_NOT_FOUND" };
  const visits = data.appointments.filter(
    (a) => (kind === "master" ? a.masterId : a.serviceId) === id,
  );
  return {
    total: visits.length,
    future: visits.filter(
      (a) =>
        a.status !== "cancelled" &&
        +instant(a.date, a.time) + a.duration * 60000 > Date.now(),
    ).length,
    archived: !!item.archived,
    revision: data.revision || 0,
  };
}

export function applyDemoCatalogAction(
  data: AppData,
  kind: CatalogKind,
  id: string,
  action: CatalogAction,
  revision: number,
): AppData {
  const impact = catalogImpact(data, kind, id);
  if (action !== "restore" && impact.future)
    throw {
      message: "CATALOG_FUTURE_BOOKINGS",
      details: String(impact.future),
    };
  if (impact.revision !== revision) throw { message: "DATA_CHANGED" };
  if (action === "delete" && impact.total)
    throw { message: "CATALOG_HAS_HISTORY" };
  return {
    ...data,
    revision: impact.revision + 1,
    masters:
      kind === "master"
        ? data.masters
            .filter((m) => action !== "delete" || m.id !== id)
            .map((m) =>
              m.id === id ? { ...m, archived: action === "archive" } : m,
            )
        : data.masters.map((m) =>
            action === "delete"
              ? { ...m, serviceIds: m.serviceIds.filter((s) => s !== id) }
              : m,
          ),
    services:
      kind === "service"
        ? data.services
            .filter((s) => action !== "delete" || s.id !== id)
            .map((s) =>
              s.id === id ? { ...s, archived: action === "archive" } : s,
            )
        : data.services,
    blocks:
      kind === "master" && action === "delete"
        ? data.blocks.filter((b) => b.masterId !== id)
        : data.blocks,
  };
}

import { useEffect, useState } from "react";
import { useStore } from "./store";
import { getSlots, nextAvailable, today, type Slot } from "./schedule";
import { cloudRepository } from "./cloudRepository";
import { isSupabase } from "./supabase";
import { apiError } from "./apiErrors";
import { isPublishedMaster } from "./publicContent";
export function useAvailability(
  serviceId: string,
  masterId: string,
  date: string,
  excludeId?: string,
) {
  const { data } = useStore();
  const [attempt, setAttempt] = useState(0);
  const key = `${serviceId}/${masterId}/${date}/${excludeId || ""}/${data.revision || 0}/${attempt}`;
  const [remote, setRemote] = useState<{
    key: string;
    slots: Slot[];
    error: string;
  }>({ key: "", slots: [], error: "" });
  useEffect(() => {
    if (!isSupabase || !serviceId) return;
    let alive = true;
    const load = () =>
      cloudRepository
        .slots(serviceId, masterId, date, excludeId)
        .then((slots) => {
          if (alive) setRemote({ key, slots, error: "" });
        })
        .catch((e) => {
          if (alive) setRemote({ key, slots: [], error: apiError(e) });
        });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key, serviceId, masterId, date, excludeId]);
  return {
    slots: isSupabase
      ? remote.key === key
        ? remote.slots
        : []
      : getSlots(data, serviceId, masterId, date, excludeId),
    loading: isSupabase && !!serviceId && remote.key !== key,
    error: remote.key === key ? remote.error : "",
    retry: () => setAttempt(n => n + 1),
    next: (from: string) =>
      isSupabase
        ? cloudRepository.next(serviceId, masterId, from, excludeId)
        : Promise.resolve(
            nextAvailable(data, serviceId, masterId, from, excludeId),
          ),
  };
}
export function useNearestSlots() {
  const { data } = useStore();
  type Row = { serviceId: string; slot: Slot & { date: string } };
  const [attempt, setAttempt] = useState(0);
  const [remote, setRemote] = useState<{key: string; rows: Row[]; error: string}>({key: '', rows: [], error: ''});
  const serviceIds = data.services
    .filter((s) => s.active && !s.archived && data.masters.some(m => isPublishedMaster(m) && m.serviceIds.includes(s.id)))
    .slice(0, 3)
    .map((s) => s.id)
    .join(",");
  const key = `${serviceIds}/${data.revision || 0}/${attempt}`;
  useEffect(() => {
    if (!isSupabase || !serviceIds) return;
    let alive = true;
    void Promise.all(
      serviceIds
        .split(",")
        .map(async (serviceId) => ({
          serviceId,
          slot: await cloudRepository.next(serviceId, "any", today()),
        })),
    )
      .then((rows) => {
        if (alive)
          setRemote({key, error: '', rows: rows.filter(
              (r): r is { serviceId: string; slot: Slot & { date: string } } =>
                !!r.slot,
            )});
      })
      .catch((error) => {
        if (alive) setRemote({key, rows: [], error: apiError(error)});
      });
    return () => {
      alive = false;
    };
  }, [serviceIds, key]);
  const rows = isSupabase
    ? serviceIds && remote.key === key ? remote.rows : []
    : ["manicure", "haircut", "brows"].flatMap((serviceId) => {
        const slot = nextAvailable(data, serviceId);
        return slot ? [{ serviceId, slot }] : [];
      });
  const slots = rows.flatMap(({ serviceId, slot }) => {
    const service = data.services.find((s) => s.id === serviceId && s.active),
      master = data.masters.find((m) => m.id === slot.masterId && isPublishedMaster(m));
    return service && master ? [{ ...slot, service, master }] : [];
  });
  return {
    slots,
    loading: isSupabase && !!serviceIds && remote.key !== key,
    error: isSupabase && serviceIds && remote.key === key ? remote.error : '',
    retry: () => setAttempt(n => n + 1),
  };
}

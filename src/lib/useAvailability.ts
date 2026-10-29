import { useEffect, useState } from "react";
import { useStore } from "./store";
import { getSlots, nextAvailable, today, type Slot } from "./schedule";
import { cloudRepository } from "./cloudRepository";
import { isSupabase } from "./supabase";
import { apiError } from "./apiErrors";
export function useAvailability(
  serviceId: string,
  masterId: string,
  date: string,
  excludeId?: string,
) {
  const { data } = useStore();
  const key = `${serviceId}/${masterId}/${date}/${excludeId || ""}/${data.revision || 0}`;
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
  const [remote, setRemote] = useState<
    { serviceId: string; slot: Slot & { date: string } }[]
  >([]);
  const serviceIds = data.services
    .filter((s) => s.active)
    .slice(0, 3)
    .map((s) => s.id)
    .join(",");
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
          setRemote(
            rows.filter(
              (r): r is { serviceId: string; slot: Slot & { date: string } } =>
                !!r.slot,
            ),
          );
      })
      .catch(() => {
        if (alive) setRemote([]);
      });
    return () => {
      alive = false;
    };
  }, [serviceIds, data.revision]);
  const rows = isSupabase
    ? remote
    : ["manicure", "haircut", "brows"].flatMap((serviceId) => {
        const slot = nextAvailable(data, serviceId);
        return slot ? [{ serviceId, slot }] : [];
      });
  return rows.flatMap(({ serviceId, slot }) => {
    const service = data.services.find((s) => s.id === serviceId && s.active),
      master = data.masters.find((m) => m.id === slot.masterId);
    return service && master ? [{ ...slot, service, master }] : [];
  });
}

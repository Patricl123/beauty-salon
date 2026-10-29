import type { AppData, Appointment, Status, CatalogKind, CatalogAction } from "../types";
import type { Slot } from "./schedule";
import { requireSupabase } from "./supabase";
import {
  finishCommand,
  getCommand,
  guestTokens,
  rememberAccess,
} from "./guestAccess";
const protectedOperations: Record<string, string> = {
  create_appointment: "create",
  get_appointment: "read",
  reschedule_appointment: "move",
  cancel_appointment: "cancel",
  get_available_slots: "slots",
  get_next_available_slot: "next",
};
export async function rpc<T>(
  name: string,
  args?: Record<string, unknown>,
  captchaToken?: string,
): Promise<T> {
  const client = requireSupabase();
  const operation = protectedOperations[name];
  if (operation) {
    const { data: session } = await client.auth.getSession();
    const role = session.session ? await client.rpc("is_admin") : null;
    if (role?.data !== true || role?.error) {
      const { data, error } = await client.functions.invoke("booking-gateway", {
        body: {
          operation,
          args: args || {},
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (error) {
        const response = (error as { context?: Response }).context;
        if (response instanceof Response) {
          const result = await response
            .clone()
            .json()
            .catch(() => null);
          if (result?.error?.code)
            throw { code: result.error.code, message: result.error.code };
        }
        throw {
          code: "PROTECTION_UNAVAILABLE",
          message: "PROTECTION_UNAVAILABLE",
        };
      }
      if (data?.error)
        throw { code: data.error.code, message: data.error.code };
      return data.data as T;
    }
  }
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data as T;
}
async function commandRpc<T>(
  operation: string,
  requestId: string,
  name: string,
  args: Record<string, unknown>,
  captchaToken?: string,
): Promise<T> {
  try {
    const result = await rpc<T>(name, args, captchaToken);
    finishCommand(operation, requestId);
    return result;
  } catch (error) {
    // A PostgreSQL exception is a definite rollback, so a fresh attempt may use a new version.
    // Network failures are ambiguous: retain the original key/version for a safe replay.
    const code = (error as { code?: string })?.code || "";
    if (
      /^[0-9A-Z]{5}$/.test(code) ||
      [
        "BOOKING_CHANGED",
        "QUOTE_CHANGED",
        "SLOT_UNAVAILABLE",
        "INVALID_CONTACTS",
        "CONSENT_REQUIRED",
        "BOOKING_NOT_EDITABLE",
        "TIME_OUT_OF_RANGE",
        "INVALID_TIME",
        "INVALID_REQUEST",
        "SERVICE_UNAVAILABLE",
      ].includes(code)
    )
      finishCommand(operation, requestId);
    throw error;
  }
}
const changed = <T extends { id: string }>(before: T[], after: T[]) =>
  after.filter(
    (item) =>
      JSON.stringify(before.find((old) => old.id === item.id)) !==
      JSON.stringify(item),
  );
export function adminDiff(before: AppData, after: AppData) {
  const patch: Record<string, unknown> = {};
  const serviceRows = changed(before.services, after.services);
  if (serviceRows.length) patch.services = serviceRows;
  const masterRows = changed(before.masters, after.masters);
  if (masterRows.length) patch.masters = masterRows;
  for (const field of ["settings", "notificationSettings"] as const)
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field]))
      patch[field] = after[field];
  const notes = Object.fromEntries(
    Object.entries(after.clientNotes).filter(
      ([phone, note]) => before.clientNotes[phone] !== note,
    ),
  );
  if (Object.keys(notes).length) patch.notes = notes;
  const blocks = changed(before.blocks, after.blocks);
  if (blocks.length) patch.blocksUpsert = blocks;
  const deleted = before.blocks
    .filter((b) => !after.blocks.some((row) => row.id === b.id))
    .map((b) => b.id);
  if (deleted.length) patch.blocksDelete = deleted;
  const contacts = after.appointments
    .filter((a) => {
      const old = before.appointments.find((item) => item.id === a.id);
      return (
        old &&
        (old.clientName !== a.clientName ||
          old.phone !== a.phone ||
          old.comment !== a.comment)
      );
    })
    .map((a) => ({
      id: a.id,
      clientName: a.clientName,
      phone: a.phone,
      comment: a.comment,
    }));
  if (contacts.length) patch.contacts = contacts;
  return patch;
}
export const cloudRepository = {
  catalogAction(kind: CatalogKind, id: string, action: CatalogAction, revision: number) {
    return rpc<AppData>("admin_catalog_action", {
      p_kind: kind, p_id: id, p_action: action, p_expected_revision: revision,
    });
  },
  async read(admin: boolean): Promise<AppData> {
    const data = await rpc<AppData>(
      admin ? "get_admin_snapshot" : "get_public_catalog",
    );
    if (!admin)
      data.appointments = await Promise.all(
        Object.entries(guestTokens()).map(([id, token]) =>
          rpc<Appointment>("get_appointment", {
            p_id: id,
            p_manage_token: token,
          }),
        ),
      );
    return data;
  },
  async book(
    a: Appointment,
    existing: boolean,
    consent: boolean,
    captchaToken?: string,
  ) {
    const payload = {
      serviceId: a.serviceId,
      masterId: a.masterId,
      date: a.date,
      time: a.time,
      clientName: a.clientName,
      phone: a.phone,
      comment: a.comment,
      expectedPrice: a.price,
      expectedDuration: a.duration,
      owner: a.owner,
      consent,
    };
    const previousToken = existing ? guestTokens()[a.id] : undefined;
    const operation = existing ? `move:${a.id}` : "create";
    const command = await getCommand(
      operation,
      payload,
      previousToken,
      a.version,
    );
    const result = await commandRpc<Appointment>(
      operation,
      command.requestId,
      existing ? "reschedule_appointment" : "create_appointment",
      existing
        ? {
            p_id: a.id,
            p_manage_token: previousToken || null,
            p_expected_version: command.version,
            p_request_id: command.requestId,
            p_payload: payload,
          }
        : {
            p_manage_token: command.token,
            p_request_id: command.requestId,
            p_payload: payload,
          },
      captchaToken,
    );
    if (!existing) rememberAccess(result.id, command.token);
    return result;
  },
  async setStatus(a: Appointment, status: Status) {
    const token = guestTokens()[a.id];
    const operation = `status:${a.id}`;
    const command = await getCommand(
      operation,
      { id: a.id, status },
      token,
      a.version,
    );
    const args = {
      p_id: a.id,
      p_request_id: command.requestId,
      p_expected_version: command.version,
    };
    const result = await commandRpc<Appointment>(
      operation,
      command.requestId,
      status === "cancelled" ? "cancel_appointment" : "admin_set_status",
      status === "cancelled"
        ? { ...args, p_manage_token: token || null }
        : { ...args, p_status: status },
    );
    return result;
  },
  async update(before: AppData, after: AppData, allowConflicts: boolean) {
    const patch = adminDiff(before, after);
    if (!Object.keys(patch).length) return before;
    return rpc<AppData>("admin_apply_changes", {
      p_changes: patch,
      p_expected_revision: before.revision,
      p_allow_conflicts: allowConflicts,
    });
  },
  slots(serviceId: string, masterId: string, date: string, excludeId?: string) {
    return rpc<Slot[]>("get_available_slots", {
      p_service_id: serviceId,
      p_master_id: masterId,
      p_date: date,
      p_exclude_id: excludeId || null,
      p_manage_token: excludeId ? guestTokens()[excludeId] || null : null,
    });
  },
  next(serviceId: string, masterId: string, from: string, excludeId?: string) {
    return rpc<(Slot & { date: string }) | null>("get_next_available_slot", {
      p_service_id: serviceId,
      p_master_id: masterId,
      p_from: from,
      p_exclude_id: excludeId || null,
      p_manage_token: excludeId ? guestTokens()[excludeId] || null : null,
    });
  },
};

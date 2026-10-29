// Run on a trusted server/scheduler. Never import this module into Vite.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment.",
  );
  process.exitCode = 1;
} else {
  try {
    let total = 0;
    for (let batch = 0; batch < 20; batch++) {
      const response = await fetch(
        url.replace(/\/$/, "") + "/functions/v1/site-media?action=cleanup",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(60000),
        },
      );
      if (!response.ok)
        throw new Error("Cleanup request failed; HTTP " + response.status);
      const result = await response.json();
      if (!Number.isInteger(result.deleted))
        throw new Error("Invalid cleanup response");
      total += result.deleted;
      if (result.deleted < 50) break;
    }
    console.log("Unused media objects removed: " + total);
  } catch {
    console.error(
      "Media cleanup failed. Check the server environment and Edge Function; credentials are not logged.",
    );
    process.exitCode = 1;
  }
}

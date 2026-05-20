/**
 * `useJobPolling` — refresh the current job every 1.5s while it is active,
 * and opportunistically push freshly-generated sections into the Outline
 * document using the user's own session (`documents.update` + append).
 *
 * Returns the latest `JobDetail` so the consumer can render directly from
 * React state. We deliberately do NOT rely on `BAKitStore.currentJob` here:
 * with Outline's stack (MobX 4 + mobx-react 6.3 + React 17) reassigning an
 * `@observable.ref` from an async setTimeout callback sometimes fails to
 * trigger a re-render — observed as "UI only updates after switching tab".
 * React `useState` guarantees a re-render on every update, side-stepping the
 * MobX edge case entirely. The store is still updated in `BAKitStore.fetchJob`
 * for other consumers (recent jobs list, etc.).
 *
 * After each poll we look at `currentJob.sections` for rows where
 * `status === 'done' && !appendedToDoc && content`. For every match we:
 *   1. Call Outline `documents.update` with the H2 section heading + body.
 *   2. On success, hit `ba-kit.jobs.markSynced` so the backend flag flips
 *      and future polls won't re-append the same section.
 *
 * A local Set tracks in-flight sync attempts so a slow Outline response
 * doesn't trigger duplicate appends in the next tick.
 */

import { useEffect, useRef, useState } from "react";
import useStores from "~/hooks/useStores";
import { appendSectionToOutlineDoc, markSectionSynced } from "../api";
import type { JobDetail } from "../types";
import { isJobActive } from "../utils/sectionState";

// Q9 — 1.5s cadence keeps the UI feeling live without hammering FastAPI.
const POLL_INTERVAL_MS = 1500;

/**
 * Polls `getJob(jobId)` and returns the latest JobDetail straight from React
 * state. The store is also updated for cross-component access, but the
 * returned value is what guarantees JobView re-renders on every tick.
 */
export function useJobPolling(jobId: string | null): JobDetail | null {
  const { baKit } = useStores();
  // step 1: React state is the source of truth for THIS component — bypasses
  // any MobX observer edge case with async setTimeout updates.
  const [job, setJob] = useState<JobDetail | null>(null);

  // Tracks section ids currently being pushed to Outline so we don't
  // double-fire while a documents.update is still in flight.
  const inFlightRef = useRef<Set<string>>(new Set());
  // Tick counter for debug logging — verifies polling actually fires.
  const tickCountRef = useRef(0);

  useEffect(() => {
    // step 2: bail when there is no job to poll
    if (!jobId) {
      setJob(null);
      baKit.clearCurrentJob();
      inFlightRef.current.clear();
      return;
    }

    // eslint-disable-next-line no-console
    console.log("[BAKit polling] hook mount, jobId=", jobId);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const tickNo = ++tickCountRef.current;
      // eslint-disable-next-line no-console
      console.log(`[BAKit polling] tick #${tickNo} → fetching jobId=${jobId}`);

      // step 3: pull latest job state — `fetchJob` updates the store too so
      // other components (e.g. RecentJobsList badge counts) stay in sync.
      const detail = await baKit.fetchJob(jobId);
      if (cancelled) {
        // eslint-disable-next-line no-console
        console.log(`[BAKit polling] tick #${tickNo} cancelled after fetch`);
        return;
      }

      // Log a concise summary of what the backend returned — section count by
      // status — so we can see at a glance whether the state is changing.
      if (detail) {
        const counts: Record<string, number> = {};
        for (const s of detail.sections) {
          counts[s.status] = (counts[s.status] || 0) + 1;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[BAKit polling] tick #${tickNo} ← jobStatus=${detail.status}`,
          "sections=",
          counts
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[BAKit polling] tick #${tickNo} ← fetch returned null`);
      }

      // step 4: drive React state from the fetched data; this is what
      // re-renders the JobView tree.
      // eslint-disable-next-line no-console
      console.log(`[BAKit polling] tick #${tickNo} → setJob(detail)`);
      setJob(detail);

      // step 5: opportunistically sync any newly-done sections into the doc
      if (detail) {
        await syncDoneSections(detail, inFlightRef.current);
        if (cancelled) return;
      }

      // step 6: decide whether to keep polling
      //   - detail present + terminal status → stop, we're done
      //   - detail present + still active → schedule next tick
      //   - detail null (network/server hiccup) → back-off + retry
      if (detail && !isJobActive(detail)) {
        // eslint-disable-next-line no-console
        console.log(
          `[BAKit polling] tick #${tickNo} terminal status=${detail.status} → STOP`
        );
        return;
      }
      const delay = detail ? POLL_INTERVAL_MS : POLL_INTERVAL_MS * 2;
      // eslint-disable-next-line no-console
      console.log(`[BAKit polling] tick #${tickNo} → schedule next in ${delay}ms`);
      timer = setTimeout(tick, delay);
    };

    // Fire immediately so the UI doesn't show a blank for 1.5s.
    void tick();

    // step 7: clean up on unmount or jobId change
    return () => {
      // eslint-disable-next-line no-console
      console.log("[BAKit polling] hook cleanup, jobId=", jobId);
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, baKit]);

  return job;
}

/**
 * Push every done-but-not-yet-synced section into the Outline document.
 *
 * Sections are processed sequentially (await per section) so the document's
 * append order matches §I, §II, … rather than racing.
 */
async function syncDoneSections(
  job: JobDetail,
  inFlight: Set<string>
): Promise<void> {
  // We can only append when we have a target document.
  if (!job.outlineDocumentId) return;

  // Sort by orderIndex so the markdown ends up in the natural reading order.
  const pending = job.sections
    .filter(
      (s) =>
        !s.appendedToDoc &&
        !!s.content &&
        // Skip sections that are still in flight from a previous tick.
        !inFlight.has(s.id) &&
        // Only fully-finished sections; agent may revise on retry/regenerate.
        (s.status === "done" || s.status === "skipped")
    )
    .sort((a, b) => a.orderIndex - b.orderIndex);

  for (const section of pending) {
    inFlight.add(section.id);
    try {
      await appendSectionToOutlineDoc(
        job.outlineDocumentId,
        section.title,
        section.content || ""
      );
      // step a: flip backend flag so the next poll skips this section
      await markSectionSynced(job.id, section.sectionId);
    } catch {
      // Leave the section as unsynced — next tick will retry. We intentionally
      // don't surface this to the user inline (avoids toast spam on transient
      // network blips); regenerate / retry buttons handle the explicit case.
    } finally {
      inFlight.delete(section.id);
    }
  }
}

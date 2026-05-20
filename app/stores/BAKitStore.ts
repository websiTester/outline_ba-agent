/**
 * BA Kit (M2) MobX store.
 *
 * Owns the templates list, the caller's recent jobs, and the currently-opened
 * job. Plain observable class (not extending base Store) since BAKit data is
 * not a single-model collection like DocumentsStore — it's an aggregate from
 * three FastAPI endpoints.
 */

import { observable, action, runInAction, computed } from "mobx";
import { NotFoundError } from "~/utils/errors";
import * as api from "~/scenes/BAKit/api";
import type {
  JobDetail,
  JobSummary,
  TemplateSummary,
} from "~/scenes/BAKit/types";

export default class BAKitStore {
  // ── State ────────────────────────────────────────────────────────────────

  @observable.shallow
  templates: TemplateSummary[] = [];

  @observable
  templatesLoading = false;

  @observable
  templatesError: string | null = null;

  @observable.shallow
  myJobs: JobSummary[] = [];

  @observable
  myJobsLoading = false;

  @observable.ref
  currentJob: JobDetail | null = null;

  @observable
  currentJobError: string | null = null;

  // Set when fetchJob hit a 404 so JobView can render the dedicated
  // "no longer exists" screen and trigger the auto-redirect timer.
  @observable
  currentJobNotFound = false;

  // ── Computed ─────────────────────────────────────────────────────────────

  @computed
  get activeJobs(): JobSummary[] {
    // Convenience filter for the "recent jobs" widget on the gallery page.
    return this.myJobs.filter(
      (j) =>
        j.status === "running" ||
        j.status === "awaiting_input" ||
        j.status === "pending"
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  @action
  fetchTemplates = async () => {
    // step 1: gate against concurrent fetches
    this.templatesLoading = true;
    this.templatesError = null;
    try {
      const templates = await api.listTemplates();
      runInAction(() => {
        this.templates = templates;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load templates";
      runInAction(() => {
        this.templatesError = message;
      });
    } finally {
      runInAction(() => {
        this.templatesLoading = false;
      });
    }
  };

  @action
  fetchMyJobs = async () => {
    this.myJobsLoading = true;
    try {
      const jobs = await api.listMyJobs();
      runInAction(() => {
        this.myJobs = jobs;
      });
    } finally {
      runInAction(() => {
        this.myJobsLoading = false;
      });
    }
  };

  @action
  fetchJob = async (jobId: string): Promise<JobDetail | null> => {
    // Used by the polling hook every 1.5s — no loading flag toggling here
    // (would cause flicker). Errors surface via `currentJobError`;
    // 404 specifically also flips `currentJobNotFound` so JobView can render
    // the "deleted" screen instead of an inert error string.
    try {
      const detail = await api.getJob(jobId);
      runInAction(() => {
        this.currentJob = detail;
        this.currentJobError = null;
        this.currentJobNotFound = false;
      });
      return detail;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load job";
      const notFound = err instanceof NotFoundError;
      runInAction(() => {
        this.currentJobError = message;
        this.currentJobNotFound = notFound;
        // Drop the stale detail so JobView doesn't keep showing it.
        if (notFound) {
          this.currentJob = null;
        }
      });
      return null;
    }
  };

  @action
  startJob = async (params: api.StartJobParams) => api.startJob(params);

  @action
  submitAnswer = async (
    jobId: string,
    sectionId: string,
    answers: Record<string, string>,
    skip = false
  ) => {
    await api.submitJobAnswer(jobId, sectionId, answers, skip);
    // Re-fetch to get the new state quickly; polling will continue too.
    await this.fetchJob(jobId);
  };

  @action
  stopSection = async (jobId: string, sectionId: string) => {
    // Backend cancels the LLM task and writes USER_STOPPED; refresh so the
    // UI immediately switches from "Generating…" to the stopped branch.
    await api.stopSection(jobId, sectionId);
    await this.fetchJob(jobId);
  };

  @action
  deleteJob = async (jobId: string) => {
    // step 1: drop the row on the backend (auto-cancels active jobs server-side)
    await api.deleteJob(jobId);
    // step 2: remove from the recent-jobs cache so RecentJobsList updates
    // without waiting for a fetch round-trip
    runInAction(() => {
      this.myJobs = this.myJobs.filter((j) => j.id !== jobId);
      // If the user happens to have this job open in JobView, clear it so
      // the polling hook's next 404 doesn't fight stale store state.
      if (this.currentJob && this.currentJob.id === jobId) {
        this.currentJob = null;
        this.currentJobError = null;
        this.currentJobNotFound = false;
      }
    });
    // step 3: refresh list authoritatively (also reconciles cross-tab deletes)
    await this.fetchMyJobs();
  };

  @action
  regenerateSection = async (jobId: string, sectionId: string) => {
    await api.regenerateSection(jobId, sectionId);
    await this.fetchJob(jobId);
  };

  @action
  clearCurrentJob = () => {
    this.currentJob = null;
    this.currentJobError = null;
    this.currentJobNotFound = false;
  };
}

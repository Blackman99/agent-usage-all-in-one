import type { MonitoringSettings } from '../core/types.js';

export interface ScheduledUsageApplication {
  refresh(): Promise<void>;
  getMonitoringSettings(): Promise<MonitoringSettings>;
}

export interface CollectionSchedulerOptions {
  application: ScheduledUsageApplication;
  intervalMs?: number;
}

export class CollectionScheduler {
  readonly #application: ScheduledUsageApplication;
  readonly #intervalMs?: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #stopped = true;

  constructor(options: CollectionSchedulerOptions) {
    this.#application = options.application;
    this.#intervalMs = options.intervalMs;
  }

  async tick(): Promise<void> {
    const settings = await this.#application.getMonitoringSettings();
    if (settings.backgroundCollectionEnabled) await this.#application.refresh();
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    void this.#scheduleNext();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #scheduleNext(): Promise<void> {
    if (this.#stopped) return;
    const settings = await this.#application.getMonitoringSettings();
    const interval = this.#intervalMs ?? settings.intervalMinutes * 60 * 1000;
    this.#timer = setTimeout(async () => {
      try {
        await this.tick();
      } finally {
        void this.#scheduleNext();
      }
    }, interval);
  }
}

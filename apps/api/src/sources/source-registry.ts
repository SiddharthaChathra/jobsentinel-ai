import { Injectable } from '@nestjs/common';
import { AshbyAdapter } from './adapters/ashby.adapter';
import { GreenhouseAdapter } from './adapters/greenhouse.adapter';
import { LeverAdapter } from './adapters/lever.adapter';
import { RemotiveAdapter } from './adapters/remotive.adapter';
import { RssAdapter } from './adapters/rss.adapter';
import type { JobSource } from './job-source';

/**
 * Adapter name → implementation (docs 06 §4). Adding a source type = one class + one line here.
 * Unknown adapter names in `job_sources` are reported, never fatal.
 */
@Injectable()
export class SourceRegistry {
  private readonly adapters = new Map<string, JobSource<unknown>>();

  constructor() {
    for (const a of [
      new GreenhouseAdapter(),
      new LeverAdapter(),
      new AshbyAdapter(),
      new RemotiveAdapter(),
      new RssAdapter(),
    ]) {
      this.register(a);
    }
  }

  register(adapter: JobSource<unknown>): void {
    this.adapters.set(adapter.metadata.adapter, adapter);
  }

  get(name: string): JobSource<unknown> | undefined {
    return this.adapters.get(name);
  }

  list(): JobSource<unknown>[] {
    return [...this.adapters.values()];
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../common/db/db.module';
import { companies } from '../common/db/schema';

export interface CompanyRef {
  id: string;
  name: string;
  websiteDomain: string | null;
  isBlocked: boolean;
  isTrusted: boolean;
}

/** Companies are shared rows keyed by normalized name; created lazily by ingestion (docs 02 §3.4). */
@Injectable()
export class CompaniesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findOrCreate(input: {
    name: string;
    normalizedName: string;
    domain?: string | null;
    atsProvider?: string;
    atsSlug?: string;
  }): Promise<CompanyRef> {
    const existing = await this.db.query.companies.findFirst({
      where: eq(companies.normalizedName, input.normalizedName),
    });
    if (existing) {
      // Fill in a domain we did not know yet; never overwrite a known one from a weaker source.
      if (!existing.websiteDomain && input.domain) {
        await this.db
          .update(companies)
          .set({ websiteDomain: input.domain })
          .where(eq(companies.id, existing.id));
        existing.websiteDomain = input.domain;
      }
      return toRef(existing);
    }
    const [row] = await this.db
      .insert(companies)
      .values({
        name: input.name,
        normalizedName: input.normalizedName,
        websiteDomain: input.domain ?? null,
        atsProvider: input.atsProvider ?? null,
        atsSlug: input.atsSlug ?? null,
      })
      .onConflictDoUpdate({ target: companies.normalizedName, set: { updatedAt: new Date() } })
      .returning();
    return toRef(row!);
  }

  async incrementSourcesCount(companyId: string): Promise<void> {
    await this.db
      .update(companies)
      .set({ sourcesCount: sql`${companies.sourcesCount} + 1` })
      .where(eq(companies.id, companyId));
  }
}

function toRef(row: typeof companies.$inferSelect): CompanyRef {
  return {
    id: row.id,
    name: row.name,
    websiteDomain: row.websiteDomain,
    isBlocked: row.isBlocked,
    isTrusted: row.isTrusted,
  };
}

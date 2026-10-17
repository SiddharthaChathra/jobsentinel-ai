import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { assertEnv, type Env, pgSsl } from '@jobsentinel/config';
import { ENV } from '../config/config.module';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export const DB = Symbol('DB');
const PG_CLIENT = Symbol('PG_CLIENT');

/**
 * Drizzle over postgres-js using the Supabase transaction pooler (DATABASE_URL).
 * `prepare: false` is required by PgBouncer transaction mode. The API connects with the
 * service role, so ownership is enforced in services (docs 02 §6).
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      useFactory: (env: Env) => {
        assertEnv(env, ['DATABASE_URL']);
        return postgres(env.DATABASE_URL, {
          // TLS for every hosted database; a local test stack has none (D101).
          ssl: pgSsl(env.DATABASE_URL),
          prepare: false,
          max: env.NODE_ENV === 'production' ? 8 : 4,
          // A 30 s idle timeout churned the pool: after half a minute of quiet, the next request
          // paid for a fresh TLS handshake to ap-south-1, and on a residential uplink that
          // regularly exceeded a 10 s connect timeout — surfacing as a 500 on the first request
          // after any pause. Hold connections longer and allow the handshake the time it needs;
          // `idle_in_transaction_session_timeout` below is what actually protects pooler slots (D72).
          idle_timeout: 300,
          connect_timeout: 30,
          connection: {
            // Without these, a query abandoned by a killed process pins a pooler slot
            // indefinitely — observed as 13-minute `active` backends after a killed test run.
            // The pooler queues new clients when its slots are full, so a leaked connection
            // eventually stalls everyone. Both are generous: no request here is this slow (D54).
            statement_timeout: 60_000,
            idle_in_transaction_session_timeout: 30_000,
          },
        });
      },
      inject: [ENV],
    },
    {
      provide: DB,
      useFactory: (client: postgres.Sql): Db => drizzle(client, { schema }),
      inject: [PG_CLIENT],
    },
  ],
  exports: [DB],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_CLIENT) private readonly client: postgres.Sql) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}

import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { assertEnv, type Env } from '@jobsentinel/config';
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
          ssl: 'require',
          prepare: false,
          max: env.NODE_ENV === 'production' ? 8 : 4,
          idle_timeout: 30,
          connect_timeout: 10,
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

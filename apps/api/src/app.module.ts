import { Module } from '@nestjs/common';
import { ConfigModule } from './common/config/config.module';
import { SystemModule } from './system/system.module';

/** HTTP API composition root (docs 05 §1). Feature modules are added phase by phase. */
@Module({
  imports: [ConfigModule, SystemModule],
})
export class AppModule {}

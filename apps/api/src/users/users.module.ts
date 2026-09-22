import { Module } from '@nestjs/common';
import { PreferencesService } from './preferences.service';
import { ProfilesService } from './profiles.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [ProfilesService, PreferencesService],
  exports: [ProfilesService, PreferencesService],
})
export class UsersModule {}

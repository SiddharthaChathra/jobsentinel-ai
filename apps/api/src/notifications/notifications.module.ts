import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { DigestService } from './digest.service';
import { DispatcherService } from './dispatcher.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { WeeklySummaryService } from './weekly-summary.service';
import { WorkflowWatchService } from './workflow-watch.service';
import { TelegramClient } from './telegram.client';
import { TelegramPollerService } from './telegram-poller.service';
import { TelegramWebhookController, TelegramWebhookRegistrar } from './telegram-webhook';

/**
 * Alerts: decide (NotificationsService) → deliver (DispatcherService), with the Telegram
 * transport and the bot's update handling (polling or webhook, D98) alongside (docs 10). Imports JobsModule because the bot's
 * Save / Not-interested buttons go through exactly the same services as the web UI.
 */
@Module({
  imports: [JobsModule],
  controllers: [NotificationsController, RemindersController, TelegramWebhookController],
  providers: [
    TelegramClient,
    NotificationsService,
    DispatcherService,
    DigestService,
    RemindersService,
    WeeklySummaryService,
    WorkflowWatchService,
    TelegramPollerService,
    TelegramWebhookRegistrar,
  ],
  exports: [
    NotificationsService,
    DispatcherService,
    DigestService,
    RemindersService,
    WeeklySummaryService,
    TelegramPollerService,
    TelegramClient,
  ],
})
export class NotificationsModule {}

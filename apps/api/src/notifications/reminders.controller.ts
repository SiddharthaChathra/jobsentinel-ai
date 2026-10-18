import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ReminderSnoozeInput, RemindersQuery, type ReminderItem } from '@jobsentinel/types';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { enveloped } from '../common/interceptors/envelope.interceptor';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RemindersService } from './reminders.service';

/** Tracker reminders (F5, D119; docs 03 §Reminders). Every query is scoped to the caller. */
@Controller()
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('reminders')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(RemindersQuery)) query: RemindersQuery,
  ) {
    const items = await this.reminders.list(user.id, query.withinDays ?? 7);
    return enveloped<ReminderItem[]>(items, { count: items.length });
  }

  @Post('reminders/:id/snooze')
  @HttpCode(200)
  snooze(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReminderSnoozeInput)) body: ReminderSnoozeInput,
  ): Promise<ReminderItem> {
    return this.reminders.snooze(user.id, id, body.hours);
  }

  @Post('reminders/:id/dismiss')
  @HttpCode(204)
  async dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.reminders.dismiss(user.id, id);
  }
}

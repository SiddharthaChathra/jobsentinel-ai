import { Controller, Get } from '@nestjs/common';
import type { SystemStatus } from '@jobsentinel/types';
import { StatusService } from './status.service';

/** Authenticated (any user) system snapshot for the System Status page (docs 03 §4). */
@Controller('system')
export class SystemController {
  constructor(private readonly status: StatusService) {}

  @Get('status')
  status_(): Promise<SystemStatus> {
    return this.status.snapshot();
  }
}

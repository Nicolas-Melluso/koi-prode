import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import type { AuthenticatedRequest } from '../common/types';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  active(@Req() request: AuthenticatedRequest) {
    return this.notifications.activeForUser(request.user.id);
  }
}

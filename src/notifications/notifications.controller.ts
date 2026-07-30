import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorRole } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ActorRole.STUDENT)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Deliberately not a bare `GET /notifications` - that exact path is also the student web
  // page's route (StudentWebController), and Express only ever reaches whichever of two
  // identical method+path registrations was added first; a bare GET here would silently make
  // the web page unreachable.
  @Get('list')
  @ApiOperation({ summary: "List the authenticated student's notifications, newest first" })
  @ApiResponse({ status: 200, type: [NotificationResponseDto] })
  async list(@CurrentUser() user: AuthenticatedUser): Promise<NotificationResponseDto[]> {
    return this.notificationsService.listForStudent(user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark every one of the authenticated student's notifications as read" })
  @ApiResponse({ status: 200, description: 'Marked as read' })
  async markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<{ message: string }> {
    await this.notificationsService.markAllRead(user.id);
    return { message: 'Notifications marked as read' };
  }
}

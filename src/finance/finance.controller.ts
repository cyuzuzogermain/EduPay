import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorRole } from '@prisma/client';
import { FinanceService } from './finance.service';
import { StudentBalanceResponseDto } from './dto/student-balance-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';

@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Get the authenticated student's balance and transaction history, matched from their institution's records by school ID",
  })
  @ApiResponse({ status: 200, type: StudentBalanceResponseDto })
  @ApiResponse({
    status: 404,
    description: 'No school ID linked yet, or no matching record found for it',
  })
  async getMyBalance(@CurrentUser() user: AuthenticatedUser): Promise<StudentBalanceResponseDto> {
    const balance = await this.financeService.getBalanceForStudent(user.id);

    if (!balance) {
      throw new NotFoundException(
        'No financial record found - link your institution and school ID from your dashboard first',
      );
    }

    return balance;
  }
}

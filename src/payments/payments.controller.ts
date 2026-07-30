import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorRole } from '@prisma/client';
import { Response } from 'express';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { QuotePaymentDto } from './dto/quote-payment.dto';
import { PaymentQuoteResponseDto } from './dto/payment-quote-response.dto';
import { ReviewPaymentDto } from './dto/review-payment.dto';
import { ChargeResponseDto } from './dto/charge-response.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { PaginatedPendingPaymentsResponseDto } from './dto/paginated-pending-payments-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('charges')
  @Roles(ActorRole.STUDENT)
  @ApiOperation({ summary: "List the authenticated student's outstanding charges" })
  @ApiResponse({ status: 200, type: [ChargeResponseDto] })
  async getOutstandingCharges(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChargeResponseDto[]> {
    return this.paymentsService.getOutstandingCharges(user.id);
  }

  @Post('quote')
  @Roles(ActorRole.STUDENT)
  @ApiOperation({
    summary:
      'Preview the FX conversion + fee disclosure for a potential payment before initiating - ' +
      'no payment record is created. Requires an APPROVED KYC status, same as initiate.',
  })
  @ApiResponse({ status: 201, type: PaymentQuoteResponseDto })
  @ApiResponse({ status: 403, description: 'KYC not approved yet' })
  async quote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QuotePaymentDto,
  ): Promise<PaymentQuoteResponseDto> {
    return this.paymentsService.quotePayment(user.id, dto);
  }

  @Post('initiate')
  @Roles(ActorRole.STUDENT)
  @ApiOperation({
    summary:
      'Start paying a single charge or the full outstanding balance - creates a payment in INITIATED state. ' +
      'Requires an APPROVED KYC status, a send currency, and a phone number. The FX rate/converted ' +
      'amount/fee are computed and locked onto the payment here, never recomputed later. Routes ' +
      'through the PAYMENT_PARTNER abstraction (SimulatedPartner today).',
  })
  @ApiResponse({ status: 201, type: PaymentResponseDto })
  @ApiResponse({ status: 403, description: 'KYC not approved yet' })
  @ApiResponse({
    status: 409,
    description: 'Charge is not payable right now, or nothing outstanding',
  })
  async initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitiatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.initiatePayment(user.id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(ActorRole.STUDENT)
  @ApiOperation({
    summary: 'Simulates approving the payment on the phone - moves INITIATED to PENDING_APPROVAL',
  })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  @ApiResponse({ status: 403, description: 'Not your payment' })
  @ApiResponse({ status: 409, description: 'Payment is not in INITIATED state' })
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.confirmPayment(id, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(ActorRole.STUDENT)
  @ApiOperation({
    summary: 'Cancels an INITIATED payment, freeing its charges to be selected again',
  })
  @ApiResponse({ status: 200, description: 'Cancelled' })
  @ApiResponse({ status: 403, description: 'Not your payment' })
  @ApiResponse({ status: 409, description: 'Payment is not in INITIATED state' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    await this.paymentsService.cancelPayment(id, user.id);
    return { message: 'Payment cancelled' };
  }

  @Get('pending')
  @Roles(ActorRole.PLATFORM_ADMIN, ActorRole.INSTITUTION_ADMIN)
  @ApiOperation({
    summary:
      'List payments awaiting approval (paginated) - institution admins see only their own institution, platform admins see everyone',
  })
  @ApiResponse({ status: 200, type: PaginatedPendingPaymentsResponseDto })
  async listPending(
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedPendingPaymentsResponseDto> {
    return this.paymentsService.listPendingApprovals(user, pagination);
  }

  @Patch(':id/review')
  @Roles(ActorRole.PLATFORM_ADMIN, ActorRole.INSTITUTION_ADMIN)
  @ApiOperation({
    summary:
      'Approve or reject a payment awaiting approval - writes an AuditLog row and, if an EduPay ' +
      'account has claimed the underlying record, a Notification, in the same transaction as the status change',
  })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  @ApiResponse({ status: 403, description: 'Not allowed to review this payment' })
  async review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.reviewPayment(id, user, dto);
  }

  @Get(':id/receipt')
  @Roles(ActorRole.STUDENT, ActorRole.INSTITUTION_ADMIN, ActorRole.PLATFORM_ADMIN)
  @ApiOperation({
    summary:
      'Download a PDF receipt for a COMPLETED payment - the owning student or a reviewing admin only',
  })
  @ApiResponse({ status: 200, description: 'PDF receipt' })
  @ApiResponse({ status: 403, description: 'Not allowed to view this payment' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  @ApiResponse({ status: 409, description: 'Payment has not reached COMPLETED yet' })
  async getReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdfBuffer = await this.paymentsService.generateReceipt(id, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="edupay-receipt-${id}.pdf"`,
    });
    return new StreamableFile(pdfBuffer);
  }
}

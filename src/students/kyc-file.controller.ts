import { createReadStream } from 'fs';
import { Controller, Get, Param, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { StudentsService } from './students.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';

/// Deliberately separate from StudentsController - a KYCDocument id is globally unique, so this
/// doesn't need a studentId in the path (same reasoning as GET /payments/:id/receipt). The
/// uploads directory itself is never served statically (see main.ts); this is the only way to
/// ever read a stored file back out, and it's scoped server-side on every request.
@ApiTags('kyc')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('kyc')
export class KycFileController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get(':documentId/file')
  @ApiOperation({
    summary:
      'Stream a submitted KYC document - the owning student, a reviewing admin of that ' +
      "student's institution, or a platform admin only",
  })
  @ApiResponse({ status: 200, description: 'The stored file (image or PDF)' })
  @ApiResponse({ status: 403, description: 'Not allowed to view this document' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getFile(
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { filePath, mimeType, originalFileName } = await this.studentsService.getKycFile(
      documentId,
      user,
    );

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(originalFileName)}"`,
    });

    return new StreamableFile(createReadStream(filePath));
  }
}

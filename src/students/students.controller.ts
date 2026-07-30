import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ActorRole } from '@prisma/client';
import { StudentsService } from './students.service';
import { VerifyRegistrationDto } from './dto/verify-registration.dto';
import { RegistrationVerifiedResponseDto } from './dto/registration-verified-response.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { StudentResponseDto } from './dto/student-response.dto';
import { PaginatedStudentsResponseDto } from './dto/paginated-students-response.dto';
import { KycDocumentResponseDto, KycStatusResponseDto } from './dto/kyc-document-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post('register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Step 1 of registration - verify a prospective student against their institution's SchoolFinancialRecord",
  })
  @ApiResponse({ status: 200, type: RegistrationVerifiedResponseDto })
  @ApiResponse({
    status: 404,
    description:
      'No institution or record matches the given details (generic, does not reveal which field failed)',
  })
  @ApiResponse({ status: 409, description: 'That school ID is already claimed by another account' })
  async verify(@Body() dto: VerifyRegistrationDto): Promise<RegistrationVerifiedResponseDto> {
    return this.studentsService.verifyForRegistration(dto);
  }

  @Post('register')
  @ApiOperation({
    summary:
      'Step 2 of registration - create the account using the verificationToken from step 1 (institutionId/schoolId can never be supplied directly)',
  })
  @ApiResponse({ status: 201, description: 'Student created', type: StudentResponseDto })
  @ApiResponse({ status: 401, description: 'Verification token missing, invalid, or expired' })
  @ApiResponse({
    status: 409,
    description: 'Email already in use, or the school ID was claimed since verification',
  })
  async register(@Body() dto: CompleteRegistrationDto): Promise<StudentResponseDto> {
    return this.studentsService.completeRegistration(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN, ActorRole.INSTITUTION_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List students with their latest KYC status (paginated) - institution admins see only their own institution, platform admins see everyone',
  })
  @ApiResponse({ status: 200, type: PaginatedStudentsResponseDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedStudentsResponseDto> {
    return this.studentsService.listForRequester(user, pagination);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Get a student's profile - a student may only fetch their own, an institution admin only their institution's, a platform admin any",
  })
  @ApiResponse({ status: 200, description: 'Student profile', type: StudentResponseDto })
  @ApiResponse({ status: 403, description: 'Not allowed to view this student' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StudentResponseDto> {
    return this.studentsService.findById(id, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the authenticated student's own profile" })
  @ApiResponse({ status: 200, description: 'Student updated', type: StudentResponseDto })
  @ApiResponse({ status: 403, description: 'Not allowed to update another profile' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateStudentDto,
  ): Promise<StudentResponseDto> {
    return this.studentsService.update(id, user.id, dto);
  }

  @Post(':id/kyc')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['documentType', 'file'],
      properties: {
        documentType: { type: 'string', example: 'PASSPORT' },
        file: { type: 'string', format: 'binary', description: 'JPEG, PNG, or PDF, max 5MB' },
      },
    },
  })
  @ApiOperation({ summary: 'Submit a KYC document (JPEG/PNG/PDF, max 5MB) for review' })
  @ApiResponse({ status: 201, description: 'KYC document submitted', type: KycDocumentResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Missing file, disallowed file type, or file too large',
  })
  @ApiResponse({ status: 403, description: 'Not allowed to submit KYC for another student' })
  async submitKyc(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitKycDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<KycDocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('A file is required');
    }

    return this.studentsService.submitKyc(id, user.id, dto, file);
  }

  @Get(':id/kyc/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the student's current KYC status" })
  @ApiResponse({ status: 200, description: 'KYC status', type: KycStatusResponseDto })
  async getKycStatus(@Param('id') id: string): Promise<KycStatusResponseDto> {
    return this.studentsService.getKycStatus(id);
  }

  @Patch(':id/kyc/:documentId/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN, ActorRole.INSTITUTION_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject a submitted KYC document' })
  @ApiResponse({ status: 200, description: 'KYC document reviewed', type: KycDocumentResponseDto })
  @ApiResponse({ status: 403, description: 'Not allowed to review this student' })
  async reviewKyc(
    @Param('id') studentId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewKycDto,
  ): Promise<KycDocumentResponseDto> {
    return this.studentsService.reviewKyc(studentId, documentId, user, dto);
  }
}

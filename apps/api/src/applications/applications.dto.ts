import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export const APPLICATION_STATUSES = [
  "PLANNING",
  "CONFIRMED",
  "MATERIAL_PREPARATION",
  "PENDING_SUBMISSION",
  "SUBMISSION_PENDING_EVIDENCE",
  "SUBMITTED",
  "WAITING_RESULT",
  "SUPPLEMENT",
  "INTERVIEW",
  "WAITLISTED",
  "OFFER",
  "REJECTED",
  "ENROLLED",
  "WITHDRAWN",
] as const;

export const APPLICATION_STAGES = [
  "PREPARING",
  "PENDING_SUBMISSION",
  "SUBMITTED",
  "ACTION_REQUIRED",
  "ADMITTED",
  "CLOSED",
] as const;

export const APPLICATION_ATTENTION_RISKS = [
  "PENDING_EVIDENCE",
  "MISSING_DEADLINE",
  "OVERDUE",
  "DUE_7_DAYS",
  "DUE_14_DAYS",
] as const;

export const APPLICATION_DEADLINE_MODES = ["FIXED", "ROLLING", "UNKNOWN"] as const;

export const APPLICATION_ACTIVITY_TYPES = [
  "MATERIALS_UPDATED",
  "SUBMISSION_RECORDED",
  "SUPPLEMENT_RECORDED",
  "NOTIFICATION_RECEIVED",
  "RESULT_RECORDED",
  "CORRECTION",
  "OTHER",
] as const;

export const APPLICATION_RESULT_STATUSES = ["WAITLISTED", "OFFER", "REJECTED", "ENROLLED"] as const;

export class ListApplicationsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({ enum: ["HK_DIRECT", "JUPAS"] })
  @IsOptional()
  @IsIn(["HK_DIRECT", "JUPAS"])
  channel?: "HK_DIRECT" | "JUPAS";

  @ApiPropertyOptional({ enum: APPLICATION_STATUSES })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: (typeof APPLICATION_STATUSES)[number];

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value))
  @IsBoolean()
  overdueOnly: boolean = false;
}

export class ApplicationDashboardQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ enum: ["HK_DIRECT", "JUPAS"] })
  @IsOptional()
  @IsIn(["HK_DIRECT", "JUPAS"])
  channel?: "HK_DIRECT" | "JUPAS";

  @ApiPropertyOptional({ enum: APPLICATION_STAGES })
  @IsOptional()
  @IsIn(APPLICATION_STAGES)
  stage?: (typeof APPLICATION_STAGES)[number];

  @ApiPropertyOptional({ enum: APPLICATION_ATTENTION_RISKS })
  @IsOptional()
  @IsIn(APPLICATION_ATTENTION_RISKS)
  risk?: (typeof APPLICATION_ATTENTION_RISKS)[number];
}

export class CreateApplicationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  studentId!: string;

  @ApiProperty({ enum: ["HK_DIRECT", "JUPAS"] })
  @IsIn(["HK_DIRECT", "JUPAS"])
  channel!: "HK_DIRECT" | "JUPAS";

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  institutionName!: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  programName?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  programChoices?: string[];

  @ApiPropertyOptional({ minimum: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  preferenceNo?: number | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roundName?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString()
  deadlineAt?: string | null;

  @ApiProperty({ enum: APPLICATION_DEADLINE_MODES })
  @IsIn(APPLICATION_DEADLINE_MODES)
  deadlineMode!: (typeof APPLICATION_DEADLINE_MODES)[number];

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  requestBasis!: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== "")
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  portalUrl?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  confirmPastDeadline = false;
}

export class UpdateApplicationDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  institutionName?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  programName?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  programChoices?: string[];

  @ApiPropertyOptional({ minimum: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  preferenceNo?: number | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  roundName?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString()
  deadlineAt?: string | null;

  @ApiPropertyOptional({ enum: APPLICATION_DEADLINE_MODES })
  @IsOptional()
  @IsIn(APPLICATION_DEADLINE_MODES)
  deadlineMode?: (typeof APPLICATION_DEADLINE_MODES)[number];

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  requestBasis?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== "")
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  portalUrl?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class ChangeApplicationStatusDto {
  @ApiProperty({ enum: APPLICATION_STATUSES })
  @IsIn(APPLICATION_STATUSES)
  status!: (typeof APPLICATION_STATUSES)[number];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString()
  submittedAt?: string | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  applicationNo?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  result?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  offerCondition?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString()
  confirmationDeadline?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  intakeDecision?: string | null;
}

export class CreateApplicationRequirementDto {
  @ApiProperty({ enum: ["SUPPLEMENT", "INTERVIEW", "OFFER_CONFIRMATION", "ESSAY", "OTHER"] })
  @IsIn(["SUPPLEMENT", "INTERVIEW", "OFFER_CONFIRMATION", "ESSAY", "OTHER"])
  requirementType!: "SUPPLEMENT" | "INTERVIEW" | "OFFER_CONFIRMATION" | "ESSAY" | "OTHER";

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;

  @ApiProperty({ format: "date-time" })
  @IsDateString()
  dueAt!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  createTask = true;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isBlocking = true;
}

export class AddApplicationActivityDto {
  @ApiProperty({ enum: APPLICATION_ACTIVITY_TYPES })
  @IsIn(APPLICATION_ACTIVITY_TYPES)
  activityType!: (typeof APPLICATION_ACTIVITY_TYPES)[number];

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  studentVisible = false;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== "")
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  portalUrl?: string | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  applicationNo?: string | null;

  @ApiPropertyOptional({ enum: APPLICATION_RESULT_STATUSES })
  @IsOptional()
  @IsIn(APPLICATION_RESULT_STATUSES)
  targetStatus?: (typeof APPLICATION_RESULT_STATUSES)[number];

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  result?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  offerCondition?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString()
  confirmationDeadline?: string | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  intakeDecision?: string | null;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  submittedAt?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  correctionOfActivityId?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @ApiPropertyOptional({ description: "Base64编码文件内容，解码后最大50MB" })
  @IsOptional()
  @IsString()
  @IsBase64()
  contentBase64?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class AddApplicationEvidenceDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  mimeType!: string;

  @ApiProperty({ description: "Base64编码文件内容，解码后最大50MB" })
  @IsString()
  @IsBase64()
  contentBase64!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class SetApplicationMaterialsDto {
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID("4", { each: true })
  materialVersionIds!: string[];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class ReturnApplicationEvidenceDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  expectedBy?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class InvalidateApplicationActivityDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class TransferApplicationOwnerDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  ownerId!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

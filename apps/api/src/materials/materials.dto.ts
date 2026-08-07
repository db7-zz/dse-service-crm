import {
  ArrayMinSize,
  IsBase64,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const MATERIAL_OUTCOMES = [
  "APPROVED",
  "PARTIALLY_MISSING",
  "RESUBMISSION_REQUIRED",
  "AWAITING_CONFIRMATION",
  "NOT_APPLICABLE",
] as const;

export class CreateMaterialItemDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  materialTypeId!: string;

  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  requirement?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @ApiProperty({ maxLength: 1000, description: "新增特殊资料的业务原因" })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  creationReason!: string;

  @ApiPropertyOptional({ enum: ["REQUIRED", "OPTIONAL"], default: "REQUIRED" })
  @IsOptional()
  @IsIn(["REQUIRED", "OPTIONAL"])
  requirementKind: "REQUIRED" | "OPTIONAL" = "REQUIRED";
}

export class UploadMaterialVersionDto {
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

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "补正时被替换的问题文件" })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  replacesFileId?: string | null;
}

export class ReviewMaterialDto {
  @ApiProperty({ enum: MATERIAL_OUTCOMES })
  @IsIn(MATERIAL_OUTCOMES)
  outcome!: (typeof MATERIAL_OUTCOMES)[number];

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class MarkMaterialMissingDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  missingReason!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  ownerId!: string;

  @ApiProperty({ format: "date-time" })
  @IsDateString()
  expectedSubmitAt!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class MaterialFollowupDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  createTask = false;

  @ApiPropertyOptional({ format: "date-time" })
  @ValidateIf((object) => object.createTask)
  @IsDateString()
  dueAt?: string;
}

export class ArchiveMaterialDto {
  @ApiProperty({ enum: ["ARCHIVED", "ARCHIVE_FAILED"] })
  @IsIn(["ARCHIVED", "ARCHIVE_FAILED"])
  archiveStatus!: "ARCHIVED" | "ARCHIVE_FAILED";

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;
}

export class CreateMaterialSubmissionDto {
  @ApiPropertyOptional({ maxLength: 1000, nullable: true, description: "管家代传时必填" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}

export class RemoveMaterialSubmissionFileDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class WithdrawMaterialSubmissionDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class MaterialSubmissionFileDecisionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  fileId!: string;

  @ApiProperty({ enum: ["APPROVED", "CORRECTION_REQUIRED"] })
  @IsIn(["APPROVED", "CORRECTION_REQUIRED"])
  outcome!: "APPROVED" | "CORRECTION_REQUIRED";

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @ValidateIf((input: MaterialSubmissionFileDecisionDto) => input.outcome === "CORRECTION_REQUIRED")
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment?: string | null;
}

export class ReviewMaterialSubmissionDto {
  @ApiProperty({ enum: ["APPROVED", "NEEDS_CORRECTION"] })
  @IsIn(["APPROVED", "NEEDS_CORRECTION"])
  outcome!: "APPROVED" | "NEEDS_CORRECTION";

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @ValidateIf((input: ReviewMaterialSubmissionDto) => input.outcome === "NEEDS_CORRECTION")
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @ValidateIf((input: ReviewMaterialSubmissionDto) => input.outcome === "NEEDS_CORRECTION")
  @IsDateString()
  correctionDueAt?: string | null;

  @ApiProperty({ type: [MaterialSubmissionFileDecisionDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MaterialSubmissionFileDecisionDto)
  fileDecisions!: MaterialSubmissionFileDecisionDto[];
}

export class RequestMaterialNotApplicableDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class ReviewMaterialApplicabilityDto {
  @ApiProperty({ enum: ["APPROVED", "REJECTED"] })
  @IsIn(["APPROVED", "REJECTED"])
  outcome!: "APPROVED" | "REJECTED";

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @ValidateIf((input: ReviewMaterialApplicabilityDto) => input.outcome === "REJECTED")
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  comment?: string | null;
}

export class CancelSpecialMaterialDto {
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

import {
  IsBase64,
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
} from "class-validator";
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

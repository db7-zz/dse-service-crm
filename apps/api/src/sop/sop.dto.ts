import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const MATERIAL_REQUIREMENT_KINDS = ["REQUIRED", "CONDITIONAL", "OPTIONAL"] as const;
const MATERIAL_DEADLINE_RULES = ["ACTIVATION_OFFSET", "STAGE_OFFSET", "FIXED_DATE"] as const;

export class SopTaskTemplateInputDto {
  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  completionCriteria?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  completionWindowHours!: number;

  @ApiProperty({ default: true, description: "是否阻止所属阶段自动完成" })
  @IsBoolean()
  isBlocking = true;
}

export class SopMaterialTemplateInputDto {
  @ApiPropertyOptional({ format: "uuid", description: "跨SOP版本保持不变的资料模板标识" })
  @IsOptional()
  @IsUUID()
  templateKey?: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  materialTypeId!: string;

  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  requirement?: string | null;

  @ApiProperty({ enum: MATERIAL_REQUIREMENT_KINDS })
  @IsIn(MATERIAL_REQUIREMENT_KINDS)
  requirementKind!: (typeof MATERIAL_REQUIREMENT_KINDS)[number];

  @ApiProperty({ enum: MATERIAL_DEADLINE_RULES })
  @IsIn(MATERIAL_DEADLINE_RULES)
  deadlineRule!: (typeof MATERIAL_DEADLINE_RULES)[number];

  @ApiPropertyOptional({ minimum: 0, nullable: true })
  @ValidateIf((input: SopMaterialTemplateInputDto) => input.deadlineRule !== "FIXED_DATE")
  @IsInt()
  @Min(0)
  deadlineOffsetDays?: number | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @ValidateIf((input: SopMaterialTemplateInputDto) => input.deadlineRule === "FIXED_DATE")
  @IsDateString()
  fixedDueAt?: string | null;

  @ApiPropertyOptional({ type: Object, nullable: true })
  @ValidateIf((input: SopMaterialTemplateInputDto) => input.requirementKind === "CONDITIONAL")
  @IsObject()
  conditionRule?: Record<string, unknown> | null;
}

export class SopStageTemplateInputDto {
  @ApiProperty({ maxLength: 32 })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  stageCode!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiProperty({ type: [SopTaskTemplateInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SopTaskTemplateInputDto)
  tasks!: SopTaskTemplateInputDto[];

  @ApiPropertyOptional({ type: [SopMaterialTemplateInputDto], maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SopMaterialTemplateInputDto)
  materials?: SopMaterialTemplateInputDto[];
}

export class UpdateSopVersionDto {
  @ApiProperty({ minimum: 1, description: "乐观锁版本号" })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ type: [SopStageTemplateInputDto], minItems: 8, maxItems: 8 })
  @IsArray()
  @ArrayMinSize(8)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => SopStageTemplateInputDto)
  stages!: SopStageTemplateInputDto[];
}

export class PublishSopVersionDto {
  @ApiProperty({ minimum: 1, description: "乐观锁版本号" })
  @IsInt()
  @Min(1)
  version!: number;
}

export class PreviewSopMaterialBackfillDto {
  @ApiPropertyOptional({ type: [String], format: "uuid", maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  studentIds?: string[];
}

export class ApplySopMaterialBackfillDto extends PreviewSopMaterialBackfillDto {
  @ApiProperty({ minLength: 64, maxLength: 64, description: "预览接口返回的内容指纹" })
  @IsString()
  @Length(64, 64)
  previewFingerprint!: string;
}

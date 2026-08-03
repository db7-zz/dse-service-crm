import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const SCORE_TYPES = ["CURRENT", "PREDICTED"] as const;
const TARGET_LEVELS = ["ASPIRATIONAL", "MATCH", "SAFE", "OTHER"] as const;
const RISK_LEVELS = ["NORMAL", "ATTENTION", "HIGH"] as const;
const SERVICE_STATUSES = ["ENABLED", "PAUSED", "TERMINATED"] as const;

export class StudentScoreInputDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subjectName!: string;

  @ApiProperty({ enum: SCORE_TYPES })
  @IsIn(SCORE_TYPES)
  scoreType!: (typeof SCORE_TYPES)[number];

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  scoreValue!: string;
}

export class StudentTargetInputDto {
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

  @ApiProperty({ enum: TARGET_LEVELS })
  @IsIn(TARGET_LEVELS)
  targetLevel!: (typeof TARGET_LEVELS)[number];
}

export class UpdateStudentRecordDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  englishName?: string | null;

  @ApiPropertyOptional({ maxLength: 150, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  school?: string | null;

  @ApiPropertyOptional({ maxLength: 32, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  grade?: string | null;

  @ApiPropertyOptional({ minimum: 2020, maximum: 2100, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2100)
  cohortYear?: number | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nextMilestone?: string | null;

  @ApiPropertyOptional({ type: [StudentScoreInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentScoreInputDto)
  scores?: StudentScoreInputDto[];

  @ApiPropertyOptional({ type: [StudentTargetInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StudentTargetInputDto)
  targets?: StudentTargetInputDto[];

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class UpdateStudentRiskDto {
  @ApiProperty({ enum: RISK_LEVELS })
  @IsIn(RISK_LEVELS)
  riskLevel!: (typeof RISK_LEVELS)[number];

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  riskNote?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class UpdateStudentServiceStatusDto {
  @ApiProperty({ enum: SERVICE_STATUSES })
  @IsIn(SERVICE_STATUSES)
  status!: (typeof SERVICE_STATUSES)[number];

  @ApiProperty({ enum: ["KEEP", "CANCEL"], default: "KEEP" })
  @IsIn(["KEEP", "CANCEL"])
  unfinishedTaskAction: "KEEP" | "CANCEL" = "KEEP";

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

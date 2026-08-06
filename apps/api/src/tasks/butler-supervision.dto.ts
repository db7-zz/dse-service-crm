import { Type } from "class-transformer";
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export const STUDENT_BLOCKER_CATEGORIES = [
  "STUDENT_COOPERATION",
  "FAMILY",
  "SCHOOL",
  "EXTERNAL_DOCUMENT",
  "OTHER",
] as const;

export class ButlerSupervisionWeekQueryDto {
  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsDateString()
  weekStart?: string;
}

export class ReportStudentBlockerDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ enum: STUDENT_BLOCKER_CATEGORIES })
  @IsIn(STUDENT_BLOCKER_CATEGORIES)
  category!: (typeof STUDENT_BLOCKER_CATEGORIES)[number];

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;

  @ApiProperty({ format: "date-time" })
  @IsDateString()
  expectedRecoveryAt!: string;
}

export class RejectStudentBlockerDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}

export class WeeklyReviewResponseItemDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  anomalyId!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  responseNote!: string;
}

export class SubmitWeeklyReviewDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ type: [WeeklyReviewResponseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeeklyReviewResponseItemDto)
  items!: WeeklyReviewResponseItemDto[];
}

export const WEEKLY_REVIEW_DECISIONS = ["RECTIFIED", "APPEAL_ACCEPTED", "APPEAL_REJECTED"] as const;

export class WeeklyReviewDecisionItemDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  anomalyId!: string;

  @ApiProperty({ enum: WEEKLY_REVIEW_DECISIONS })
  @IsIn(WEEKLY_REVIEW_DECISIONS)
  decision!: (typeof WEEKLY_REVIEW_DECISIONS)[number];
}

export class ReviewWeeklyReviewDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;

  @ApiProperty({ type: [WeeklyReviewDecisionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeeklyReviewDecisionItemDto)
  items!: WeeklyReviewDecisionItemDto[];
}

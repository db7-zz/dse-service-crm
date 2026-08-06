import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const RECTIFICATION_STATUSES = ["PENDING_RECTIFICATION", "PENDING_REVIEW", "CLOSED"] as const;

export class ListRectificationsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ enum: RECTIFICATION_STATUSES })
  @IsOptional()
  @IsIn(RECTIFICATION_STATUSES)
  status?: (typeof RECTIFICATION_STATUSES)[number];

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  butlerId?: string;
}

export class CreateRectificationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  butlerId!: string;

  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayUnique()
  @IsUUID("4", { each: true })
  taskIds: string[] = [];

  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayUnique()
  @IsUUID("4", { each: true })
  issueIds: string[] = [];

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  summary!: string;

  @ApiProperty({ format: "date-time" })
  @IsDateString()
  dueAt!: string;
}

export class SubmitRectificationDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  note!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class ReviewRectificationDto extends SubmitRectificationDto {
  @ApiProperty({ description: "true 表示复核通过并关闭，false 表示退回整改" })
  @IsBoolean()
  approve!: boolean;
}

import { Type } from "class-transformer";
import {
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

export class ListIssuesQueryDto {
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

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({
    enum: ["OPEN", "NEEDS_INFO", "RESPONDED", "CONVERTED_TO_TASK", "RESOLVED", "CLOSED"],
  })
  @IsOptional()
  @IsIn(["OPEN", "NEEDS_INFO", "RESPONDED", "CONVERTED_TO_TASK", "RESOLVED", "CLOSED"])
  status?: "OPEN" | "NEEDS_INFO" | "RESPONDED" | "CONVERTED_TO_TASK" | "RESOLVED" | "CLOSED";
}

export class CreateIssueDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  studentId!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  linkedTaskId?: string | null;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  category!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  context!: string;

  @ApiPropertyOptional({ maxLength: 32, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  priority?: string | null;
}

export class IssueActionDto {
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

export class RespondIssueDto extends IssueActionDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requestMoreInformation = false;
}

export class ConvertIssueToTaskDto extends IssueActionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  ownerId!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  stageInstanceId?: string;

  @ApiProperty({ format: "date-time" })
  @IsDateString()
  dueAt!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  evidenceRequired = false;
}

import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const SERVICE_STATUSES = ["NOT_ENABLED", "ENABLED"] as const;
const STUDENT_PROGRESS_SORTS = ["stageProgress", "currentBlockers", "overdueTasks"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;

export class ListStudentsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: SERVICE_STATUSES })
  @IsOptional()
  @IsIn(SERVICE_STATUSES)
  serviceStatus?: (typeof SERVICE_STATUSES)[number];

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  defaultButlerId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  plannerId?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  currentStageCode?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value))
  @IsBoolean()
  hasCurrentBlockers?: boolean;

  @ApiPropertyOptional({ enum: STUDENT_PROGRESS_SORTS })
  @IsOptional()
  @IsIn(STUDENT_PROGRESS_SORTS)
  sortBy?: (typeof STUDENT_PROGRESS_SORTS)[number];

  @ApiPropertyOptional({ enum: SORT_ORDERS, default: "desc" })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder: (typeof SORT_ORDERS)[number] = "desc";
}

export class CreateStudentDto {
  @ApiProperty({ example: "黄翰", maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: "+852 6123 4567", maxLength: 32, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== "")
  @IsString()
  @Matches(/^[0-9+\-()\s]{5,32}$/)
  phone?: string | null;

  @ApiPropertyOptional({
    example: "hon.wong@example.com",
    maxLength: 254,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== "")
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  defaultButlerId?: string | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  plannerId?: string | null;
}

export class UpdateStudentDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 32, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== "")
  @IsString()
  @Matches(/^[0-9+\-()\s]{5,32}$/)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 254, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== "")
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiProperty({ minimum: 1, description: "乐观锁版本号" })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AssignResponsiblePersonDto {
  @ApiProperty({ format: "uuid", nullable: true })
  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  userId!: string | null;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ minimum: 1, description: "乐观锁版本号" })
  @IsInt()
  @Min(1)
  version!: number;
}

export class ActivateStudentServiceDto {
  @ApiProperty({ minimum: 1, description: "学生资料乐观锁版本号" })
  @IsInt()
  @Min(1)
  version!: number;
}

export class BulkAssignTaskItemDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  taskId!: string;

  @ApiProperty({ minimum: 1, description: "任务乐观锁版本号" })
  @IsInt()
  @Min(1)
  version!: number;
}

export class BulkAssignUnassignedTasksDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  butlerId!: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ type: [BulkAssignTaskItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkAssignTaskItemDto)
  tasks!: BulkAssignTaskItemDto[];
}

export class CreateManualTaskDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  stageInstanceId!: string;

  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

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

  @ApiProperty({ format: "date-time", description: "精确到分钟且晚于当前时间" })
  @IsDateString()
  currentDueAt!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @ApiProperty({ default: false })
  @IsBoolean()
  isBlocking = false;

  @ApiProperty({ minimum: 0, description: "所属阶段乐观锁版本号" })
  @IsInt()
  @Min(0)
  stageVersion!: number;
}

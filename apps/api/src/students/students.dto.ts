import { Type } from "class-transformer";
import {
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
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const SERVICE_STATUSES = ["NOT_ENABLED", "ENABLED"] as const;

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

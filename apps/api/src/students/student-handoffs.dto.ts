import { Type } from "class-transformer";
import {
  IsDateString,
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

export class ListStudentHandoffsQueryDto {
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
}

export class CreateStudentHandoffDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  studentName!: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== "")
  @Matches(/^[0-9+\-()\s]{5,32}$/)
  studentPhone?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  studentWechat?: string | null;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  parentName!: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  parentRelationship?: string | null;

  @ApiProperty({ maxLength: 32 })
  @Matches(/^[0-9+\-()\s]{5,32}$/)
  parentPhone!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  parentWechat?: string | null;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  school?: string | null;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  grade?: string | null;

  @ApiPropertyOptional({ minimum: 2000, maximum: 2200 })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2200)
  cohortYear?: number | null;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  assignedButlerId!: string;

  @ApiProperty({ format: "date-time" })
  @IsDateString()
  wechatGroupCreatedAt!: string;
}

export class AcceptStudentHandoffDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

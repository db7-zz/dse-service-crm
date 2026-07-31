import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

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

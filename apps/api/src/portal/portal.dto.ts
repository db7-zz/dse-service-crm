import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PortalUploadMaterialDto {
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

  @ApiProperty()
  @IsString()
  @IsBase64()
  contentBase64!: string;
}

export class RespondConfirmationDto {
  @ApiProperty({ enum: ["CONFIRMED", "DECLINED"] })
  @IsIn(["CONFIRMED", "DECLINED"])
  status!: "CONFIRMED" | "DECLINED";

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class SubmitPortalProfileDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  studentName!: string;

  @ApiProperty({ minimum: 2000, maximum: 2200 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  cohortYear!: number;

  @ApiProperty({ maxLength: 32 })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  grade!: string;

  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  school!: string;

  @ApiProperty({ maxLength: 32 })
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  studentPhone!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  studentWechat!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  parentName!: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  parentRelationship!: string;

  @ApiProperty({ maxLength: 32 })
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  parentPhone!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  parentWechat!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  identityCategory!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  examCandidateType!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  dseSubjects!: string[];

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  scoreSummary!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  targetDirection!: string;
}

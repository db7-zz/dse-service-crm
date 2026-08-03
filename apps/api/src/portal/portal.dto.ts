import { IsBase64, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
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

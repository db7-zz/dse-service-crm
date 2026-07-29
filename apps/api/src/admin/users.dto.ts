import { RoleCode } from "@dse/shared";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const ROLE_CODES = Object.values(RoleCode);

export class CreateUserDto {
  @ApiProperty({ example: "staff.name" })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/)
  username!: string;

  @ApiProperty({ example: "员工姓名" })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @ApiProperty({ format: "password", minLength: 12 })
  @IsString()
  @MinLength(12)
  password!: string;

  @ApiProperty({ enum: ROLE_CODES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ROLE_CODES, { each: true })
  roleCodes!: RoleCode[];
}

export class UpdateUserDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({ format: "password", minLength: 12 })
  @IsOptional()
  @IsString()
  @MinLength(12)
  password?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetUserRolesDto {
  @ApiProperty({ enum: ROLE_CODES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ROLE_CODES, { each: true })
  roleCodes!: RoleCode[];

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class UserStateChangeDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

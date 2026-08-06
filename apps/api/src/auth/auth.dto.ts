import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "admin" })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/)
  username!: string;

  @ApiProperty({ format: "password", minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: "password", minLength: 6 })
  @IsString()
  @MinLength(6)
  currentPassword!: string;

  @ApiProperty({ format: "password", minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

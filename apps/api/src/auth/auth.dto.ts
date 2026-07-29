import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "admin" })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/)
  username!: string;

  @ApiProperty({ format: "password", minLength: 12 })
  @IsString()
  @MinLength(12)
  password!: string;
}

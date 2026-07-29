import { RoleCode } from "@dse/shared";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateUserDto, UpdateUserDto } from "../admin/users.dto.js";
import { LoginDto } from "./auth.dto.js";

async function expectPasswordLength(
  input: LoginDto | CreateUserDto | UpdateUserDto,
  valid: boolean,
): Promise<void> {
  const errors = await validate(input);
  const passwordError = errors.find((error) => error.property === "password");

  if (valid) {
    expect(passwordError).toBeUndefined();
    return;
  }

  expect(passwordError?.constraints).toHaveProperty("minLength");
}

describe("password length policy", () => {
  it("accepts six-character passwords and rejects shorter login passwords", async () => {
    await expectPasswordLength(
      Object.assign(new LoginDto(), { username: "admin", password: "123456" }),
      true,
    );
    await expectPasswordLength(
      Object.assign(new LoginDto(), { username: "admin", password: "12345" }),
      false,
    );
  });

  it("uses the same minimum length when creating or updating an account", async () => {
    await expectPasswordLength(
      Object.assign(new CreateUserDto(), {
        username: "butler",
        displayName: "测试管家",
        password: "123456",
        roleCodes: [RoleCode.BUTLER],
      }),
      true,
    );
    await expectPasswordLength(Object.assign(new UpdateUserDto(), { password: "12345" }), false);
  });
});

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "username" VARCHAR(64) NOT NULL,
  "display_name" VARCHAR(100) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  "failed_login_window_started_at" TIMESTAMP(3),
  "locked_until" TIMESTAMP(3),
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "role_code" VARCHAR(32) NOT NULL,
  "role_name" VARCHAR(50) NOT NULL,
  "description" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "permission_code" VARCHAR(64) NOT NULL,
  "permission_name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_roles" (
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expired_at" TIMESTAMP(3),
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id")
);

CREATE TABLE "role_permissions" (
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "csrf_token_hash" CHAR(64) NOT NULL,
  "absolute_expires_at" TIMESTAMP(3) NOT NULL,
  "idle_expires_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "ip_address" VARCHAR(64),
  "user_agent" VARCHAR(512),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "operator_id" UUID,
  "operator_role" VARCHAR(32),
  "object_type" VARCHAR(64) NOT NULL,
  "object_id" VARCHAR(128),
  "action" VARCHAR(64) NOT NULL,
  "before_data" JSONB,
  "after_data" JSONB,
  "reason" VARCHAR(500),
  "request_id" VARCHAR(64) NOT NULL,
  "ip_address" VARCHAR(64),
  "device_info" VARCHAR(512),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "roles_role_code_key" ON "roles"("role_code");
CREATE UNIQUE INDEX "permissions_permission_code_key" ON "permissions"("permission_code");
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_absolute_expires_at_idx" ON "sessions"("absolute_expires_at");
CREATE INDEX "audit_logs_operator_id_created_at_idx" ON "audit_logs"("operator_id", "created_at");
CREATE INDEX "audit_logs_object_type_object_id_idx" ON "audit_logs"("object_type", "object_id");
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConfigService } from "@nestjs/config";
import { Inject, Injectable } from "@nestjs/common";
import type { Environment } from "../config/environment.js";

@Injectable()
export class FileStorageService {
  private readonly root: string;

  public constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    this.root = path.resolve(config.get("FILE_STORAGE_ROOT", { infer: true }));
  }

  public async put(input: {
    namespace: "materials" | "task-evidence" | "application-evidence";
    ownerId: string;
    fileName: string;
    content: Buffer;
  }) {
    const extension = path.extname(input.fileName).toLowerCase();
    const relativeKey = path.posix.join(
      input.namespace,
      input.ownerId,
      `${Date.now()}-${randomUUID()}${extension}`,
    );
    const fullPath = this.resolveKey(relativeKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.content, { flag: "wx" });
    return {
      storageKey: relativeKey,
      fileHash: createHash("sha256").update(input.content).digest("hex"),
    };
  }

  public read(storageKey: string) {
    return readFile(this.resolveKey(storageKey));
  }

  private resolveKey(storageKey: string) {
    const resolved = path.resolve(this.root, storageKey.replaceAll("/", path.sep));
    const prefix = `${this.root}${path.sep}`;
    if (resolved !== this.root && !resolved.startsWith(prefix)) {
      throw new Error("Invalid storage key");
    }
    return resolved;
  }
}

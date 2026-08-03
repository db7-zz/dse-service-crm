import { ErrorCode } from "@dse/shared";

export interface SopBlockingStageFact {
  sequenceNo: number;
  name: string;
  tasks: ReadonlyArray<{ isBlocking: boolean }>;
}

export function blockingStageValidationErrors(stages: ReadonlyArray<SopBlockingStageFact>) {
  return stages
    .filter((stage) => !stage.tasks.some((task) => task.isBlocking))
    .map((stage) => ({
      path: `stages.${stage.sequenceNo}.tasks`,
      code: ErrorCode.STAGE_BLOCKING_TASK_REQUIRED,
      message: `${stage.name}至少需要一项阻塞任务`,
    }));
}

export type ProgressTaskStatus =
  "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "NOT_APPLICABLE";

export interface StageProgressFact {
  id: string;
  sequenceNo: number;
  tasks: Array<{ status: ProgressTaskStatus; isBlocking: boolean }>;
}

export interface DerivedStageProgress {
  stages: Array<{
    id: string;
    sequenceNo: number;
    status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    openBlockingTaskCount: number;
    legacyTaskCount: number;
  }>;
  completedStageCount: number;
  currentStageId: string | null;
}

export class StageProgressFactsError extends Error {}

export function deriveStageProgress(facts: StageProgressFact[]): DerivedStageProgress {
  if (facts.length !== 8 || facts.some((stage, index) => stage.sequenceNo !== index + 1)) {
    throw new StageProgressFactsError("阶段数量或顺序快照异常");
  }

  let completedStageCount = 0;
  let currentStageId: string | null = null;
  let reachedIncomplete = false;
  const stages = facts.map((stage) => {
    const blockers = stage.tasks.filter((task) => task.isBlocking);
    if (blockers.length === 0) {
      throw new StageProgressFactsError(`第 ${stage.sequenceNo} 阶段没有阻塞任务`);
    }
    const openBlockingTaskCount = blockers.filter(
      (task) => task.status === "TODO" || task.status === "IN_PROGRESS",
    ).length;
    let status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    if (!reachedIncomplete && openBlockingTaskCount === 0) {
      status = "COMPLETED";
      completedStageCount += 1;
    } else if (!reachedIncomplete) {
      status = "IN_PROGRESS";
      currentStageId = stage.id;
      reachedIncomplete = true;
    } else {
      status = "NOT_STARTED";
    }
    return {
      id: stage.id,
      sequenceNo: stage.sequenceNo,
      status,
      openBlockingTaskCount,
      legacyTaskCount:
        status === "COMPLETED"
          ? stage.tasks.filter(
              (task) =>
                !task.isBlocking && (task.status === "TODO" || task.status === "IN_PROGRESS"),
            ).length
          : 0,
    };
  });
  return { stages, completedStageCount, currentStageId };
}

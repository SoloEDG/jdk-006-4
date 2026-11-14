import type {
  CaseClockState,
  CaseContent,
  CaseSnapshot,
  EvidenceState,
  HeardHistory,
  Investigation,
  ResumePoint,
} from "../../../shared/types";
import { createCaseClock } from "../../caseclock/model/mapping";
import { validateSnapshot } from "../lib/codec";
export function createSnapshot(
  content: CaseContent,
  story: Investigation,
  evidence: EvidenceState,
  heard: HeardHistory,
  resume: ResumePoint,
  clock?: CaseClockState,
): CaseSnapshot {
  return validateSnapshot(
    {
      version: 1,
      caseId: content.id,
      story,
      evidence,
      heard,
      resume,
      clock: clock ?? createCaseClock(content),
    },
    content,
  );
}

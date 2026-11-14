import type {
  EvidenceNote,
  SceneId,
  TimeAnchor,
} from "../../../shared/types";
import { caseTimeAt } from "./anchors";

export interface CaseRange {
  start: number;
  end: number;
}

/** 笔记的录音范围投影到案发时间线；任一端未被映射覆盖即为 null（空档）。 */
export function noteCaseRange(
  anchors: TimeAnchor[],
  note: EvidenceNote,
): CaseRange | null {
  const start = caseTimeAt(anchors, note.anchor.start);
  const end = caseTimeAt(anchors, note.anchor.end);
  if (start === null || end === null) return null;
  return { start, end };
}

export interface NoteShift {
  note: EvidenceNote;
  before: CaseRange | null;
  after: CaseRange | null;
}

function sameRange(a: CaseRange | null, b: CaseRange | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.start - b.start) < 0.01 && Math.abs(a.end - b.end) < 0.01;
}

/**
 * 预览锚点调整：列出该地点所有笔记在新旧两套锚点下的案发落点差异，
 * 供确认提交前检查。其他地点的笔记不受影响。
 */
export function previewAnchorChange(
  notes: EvidenceNote[],
  sceneId: SceneId,
  beforeAnchors: TimeAnchor[],
  afterAnchors: TimeAnchor[],
): NoteShift[] {
  return notes
    .filter((note) => note.anchor.sceneId === sceneId)
    .map((note) => ({
      note,
      before: noteCaseRange(beforeAnchors, note),
      after: noteCaseRange(afterAnchors, note),
    }))
    .filter((shift) => !sameRange(shift.before, shift.after));
}

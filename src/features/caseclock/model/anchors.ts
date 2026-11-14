import type { TimeAnchor } from "../../../shared/types";
import { CASE_TIME_MAX } from "../../../shared/time";

/**
 * 校验并按录音时间排序锚点。
 * 录音时长不等于案发时间：映射完全由锚点插值得到，
 * 倒序或重复时间会形成无效区间，直接拒绝。
 */
export function validateAnchors(
  anchors: TimeAnchor[],
  duration: number,
): TimeAnchor[] {
  if (anchors.length === 0) return [];
  if (anchors.length === 1)
    throw new Error("至少需要两个锚点才能在录音与案发时间之间插值");
  const checked = anchors.map((anchor) => {
    if (
      !anchor ||
      typeof anchor.id !== "string" ||
      !anchor.id ||
      !Number.isFinite(anchor.sourceTime) ||
      !Number.isFinite(anchor.caseTime)
    )
      throw new Error("锚点包含无效数值");
    if (anchor.sourceTime < 0 || anchor.sourceTime > duration)
      throw new Error("锚点的录音时间超出音频范围");
    if (anchor.caseTime < 0 || anchor.caseTime > CASE_TIME_MAX)
      throw new Error("锚点的案发时间超出案件时间范围");
    return {
      id: anchor.id,
      sourceTime: anchor.sourceTime,
      caseTime: anchor.caseTime,
      label: typeof anchor.label === "string" ? anchor.label : "",
    };
  });
  const sorted = [...checked].sort((a, b) => a.sourceTime - b.sourceTime);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].sourceTime === sorted[i - 1].sourceTime)
      throw new Error("锚点的录音时间重复，无法形成有效区间");
    if (sorted[i].caseTime <= sorted[i - 1].caseTime)
      throw new Error(
        sorted[i].caseTime === sorted[i - 1].caseTime
          ? "锚点的案发时间重复，无法形成有效区间"
          : "锚点的案发时间倒序，无法形成有效区间",
      );
  }
  return sorted;
}

/** 录音时间 → 案发时间。超出锚点覆盖范围不外推，返回 null。 */
export function caseTimeAt(
  anchors: TimeAnchor[],
  sourceTime: number,
): number | null {
  if (anchors.length < 2 || !Number.isFinite(sourceTime)) return null;
  const first = anchors[0],
    last = anchors[anchors.length - 1];
  if (sourceTime < first.sourceTime || sourceTime > last.sourceTime)
    return null;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1],
      b = anchors[i];
    if (sourceTime <= b.sourceTime) {
      const span = b.sourceTime - a.sourceTime;
      if (span <= 0) return null;
      const ratio = (sourceTime - a.sourceTime) / span;
      return a.caseTime + ratio * (b.caseTime - a.caseTime);
    }
  }
  return last.caseTime;
}

/** 案发时间 → 录音时间。超出锚点覆盖范围不外推，返回 null。 */
export function sourceTimeAt(
  anchors: TimeAnchor[],
  caseTime: number,
): number | null {
  if (anchors.length < 2 || !Number.isFinite(caseTime)) return null;
  const first = anchors[0],
    last = anchors[anchors.length - 1];
  if (caseTime < first.caseTime || caseTime > last.caseTime) return null;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1],
      b = anchors[i];
    if (caseTime <= b.caseTime) {
      const span = b.caseTime - a.caseTime;
      if (span <= 0) return null;
      const ratio = (caseTime - a.caseTime) / span;
      return a.sourceTime + ratio * (b.sourceTime - a.sourceTime);
    }
  }
  return last.sourceTime;
}

export interface Coverage {
  start: number;
  end: number;
}

/** 映射在案发时间线上的覆盖区间；锚点不足时没有覆盖。 */
export function coverage(anchors: TimeAnchor[]): Coverage | null {
  if (anchors.length < 2) return null;
  return {
    start: anchors[0].caseTime,
    end: anchors[anchors.length - 1].caseTime,
  };
}

/** 映射在录音时间上的覆盖区间。 */
export function sourceCoverage(anchors: TimeAnchor[]): Coverage | null {
  if (anchors.length < 2) return null;
  return {
    start: anchors[0].sourceTime,
    end: anchors[anchors.length - 1].sourceTime,
  };
}

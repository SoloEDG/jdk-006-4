import type {
  CaseClockState,
  CaseContent,
  CompareSide,
  SceneId,
  SceneMapping,
} from "../../../shared/types";
import { validateAnchors } from "../model/anchors";
import { defaultSceneMapping, sceneDuration } from "../model/mapping";

type Obj = Record<string, unknown>;

function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}格式无效`);
  return value as Obj;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}必须是文字`);
  return value;
}

/**
 * 校验存档中的案件时钟。结构无效或锚点形成无效区间（倒序、重复、超界）
 * 都会抛错；校验通过则返回可安全复原的映射状态。
 */
export function validateClockState(
  input: unknown,
  content: CaseContent,
): CaseClockState {
  const root = object(input, "案件时钟");
  const rawScenes = root.scenes;
  if (!Array.isArray(rawScenes)) throw new Error("案件时钟缺少地点映射");
  const scenes = rawScenes.map((value) => {
    const s = object(value, "地点映射");
    const sceneId = string(s.sceneId, "地点");
    if (!content.scenes.some((scene) => scene.id === sceneId))
      throw new Error("案件时钟包含未知地点");
    const rawVariants = s.variants;
    if (!Array.isArray(rawVariants) || rawVariants.length === 0)
      throw new Error("地点映射缺少说法");
    const variants = rawVariants.map((item) => {
      const v = object(item, "映射说法");
      const id = string(v.id, "说法编号");
      if (!id) throw new Error("说法编号为空");
      const label = string(v.label, "说法名称");
      const rawAnchors = v.anchors;
      if (!Array.isArray(rawAnchors)) throw new Error("锚点必须是列表");
      const anchors = validateAnchors(
        rawAnchors.map((entry) => {
          const a = object(entry, "锚点");
          return {
            id: string(a.id, "锚点编号"),
            sourceTime:
              typeof a.sourceTime === "number"
                ? a.sourceTime
                : Number.NaN,
            caseTime:
              typeof a.caseTime === "number" ? a.caseTime : Number.NaN,
            label:
              typeof a.label === "string"
                ? a.label
                : string(a.label ?? "", "锚点备注"),
          };
        }),
        sceneDuration(content, sceneId as SceneId),
      );
      return { id, label, anchors };
    });
    const activeId = string(s.activeId, "当前说法");
    if (!variants.some((variant) => variant.id === activeId))
      throw new Error("当前说法不存在");
    if (new Set(variants.map((variant) => variant.id)).size !== variants.length)
      throw new Error("说法编号重复");
    return { sceneId: sceneId as SceneId, activeId, variants };
  });
  const ids = scenes.map((mapping) => mapping.sceneId);
  if (new Set(ids).size !== ids.length)
    throw new Error("案件时钟的地点重复");
  const byId = new Map<SceneId, SceneMapping>(
    scenes.map((mapping) => [mapping.sceneId, mapping]),
  );
  const merged = content.scenes.map(
    (scene) =>
      byId.get(scene.id) ??
      defaultSceneMapping(scene.id, sceneDuration(content, scene.id)),
  );
  const rawCompare = object(root.compare, "并排比较");
  const left = string(rawCompare.left, "左侧地点") as SceneId,
    right = string(rawCompare.right, "右侧地点") as SceneId,
    primary = string(rawCompare.primary, "主听视角") as CompareSide;
  if (
    !content.scenes.some((scene) => scene.id === left) ||
    !content.scenes.some((scene) => scene.id === right) ||
    (left === right && content.scenes.length > 1) ||
    (primary !== "left" && primary !== "right")
  )
    throw new Error("并排比较设置无效");
  return { scenes: merged, compare: { left, right, primary } };
}

import type {
  CaseContent,
  CaseClockState,
  CompareState,
  MappingVariant,
  SceneId,
  SceneMapping,
  TimeAnchor,
} from "../../../shared/types";
import { newId } from "../../../shared/time";
import { validateAnchors } from "./anchors";

/** 场景录音时长：同一地点可能有多个录音版本，取最长者。 */
export function sceneDuration(
  content: CaseContent,
  sceneId: SceneId,
): number {
  return Math.max(
    0,
    ...content.episodes
      .filter((episode) => episode.sceneId === sceneId)
      .map((episode) => episode.duration),
  );
}

interface DefaultVariant {
  label: string;
  anchors: [number, number, string?][];
}

/**
 * 出厂锚点来自剧情中的明确时间陈述（如“二十三点十七分”“磁带标签”），
 * 而不是录音时长。案发时间为相对 1998-11-07 20:00 的秒数。
 */
const DEFAULT_VARIANTS: Partial<Record<SceneId, DefaultVariant[]>> = {
  arrival: [
    {
      label: "电台时间记录",
      anchors: [
        [0, 11790, "开场旁白"],
        [6.623, 11820, "二十三点十七分，求救电话接入"],
        [15.19, 11940, "三声钟响"],
        [28.832, 12060, "线路中断"],
      ],
    },
  ],
  harbor: [
    {
      label: "阿渡的证词",
      anchors: [
        [0, 12540, "雨夜码头"],
        [5.182, 12660, "三长一短的雾笛"],
        [24.311, 12840, "证词结束"],
      ],
    },
    {
      label: "港务记录推断",
      anchors: [
        [0, 10440, "按港务记录回推"],
        [5.182, 10500, "雾笛（推断在来电之前）"],
        [24.311, 10560, "证词结束"],
      ],
    },
  ],
  interview: [
    {
      label: "周姨的说法",
      anchors: [
        [0, 11100, "询问开始"],
        [11.51, 11160, "收音机电流声"],
        [24.235, 11280, "询问结束"],
      ],
    },
  ],
  tower: [
    {
      label: "磁带标签",
      anchors: [
        [0, 11640, "控制室"],
        [13.782, 11820, "磁带标注：十一月七日 23:17"],
        [27.155, 11970, "磁带结束"],
      ],
    },
  ],
  finale: [
    {
      label: "结案广播",
      anchors: [
        [0, 32400, "天亮以前"],
        [26.19, 32580, "广播结束"],
      ],
    },
  ],
};

function buildVariant(
  variant: DefaultVariant,
  duration: number,
): MappingVariant {
  // 出厂锚点按完整录音设计；较短的音源只保留落在时长内的锚点，
  // 不足两个则视为未锚定，而不是硬凑出无效区间。
  const anchors = variant.anchors.filter(
    ([sourceTime]) => sourceTime <= duration,
  );
  return {
    id: newId(),
    label: variant.label,
    anchors:
      anchors.length < 2
        ? []
        : anchors.map(([sourceTime, caseTime, label]) => ({
            id: newId(),
            sourceTime,
            caseTime,
            label: label ?? "",
          })),
  };
}

export function defaultSceneMapping(
  sceneId: SceneId,
  duration: number,
): SceneMapping {
  const variants = (DEFAULT_VARIANTS[sceneId] ?? [
    { label: "初始映射", anchors: [] },
  ]).map((variant) => buildVariant(variant, duration));
  return { sceneId, activeId: variants[0].id, variants };
}

export function createCaseClock(content: CaseContent): CaseClockState {
  const left = content.scenes[0]?.id ?? "arrival",
    right = content.scenes[1]?.id ?? left;
  return {
    scenes: content.scenes.map((scene) =>
      defaultSceneMapping(scene.id, sceneDuration(content, scene.id)),
    ),
    compare: { left, right, primary: "left" },
  };
}

export function sceneMapping(
  state: CaseClockState,
  sceneId: SceneId,
): SceneMapping {
  const mapping = state.scenes.find((item) => item.sceneId === sceneId);
  if (!mapping) throw new Error("案件时钟不包含该地点");
  return mapping;
}

export function activeVariant(mapping: SceneMapping): MappingVariant {
  return (
    mapping.variants.find((variant) => variant.id === mapping.activeId) ??
    mapping.variants[0]
  );
}

export function primarySceneId(state: CaseClockState): SceneId {
  return state.compare.primary === "left"
    ? state.compare.left
    : state.compare.right;
}

function replaceScene(
  state: CaseClockState,
  sceneId: SceneId,
  next: SceneMapping,
): CaseClockState {
  return {
    ...state,
    scenes: state.scenes.map((item) => (item.sceneId === sceneId ? next : item)),
  };
}

/** 提交锚点：校验失败（倒序、重复、超界）会抛错，原状态保持不变。 */
export function commitAnchors(
  state: CaseClockState,
  content: CaseContent,
  sceneId: SceneId,
  variantId: string,
  anchors: TimeAnchor[],
): CaseClockState {
  const mapping = sceneMapping(state, sceneId);
  if (!mapping.variants.some((variant) => variant.id === variantId))
    throw new Error("映射版本不存在");
  const sorted = validateAnchors(anchors, sceneDuration(content, sceneId));
  return replaceScene(state, sceneId, {
    ...mapping,
    variants: mapping.variants.map((variant) =>
      variant.id === variantId ? { ...variant, anchors: sorted } : variant,
    ),
  });
}

/** 新增一套说法：复制当前映射作为起点，冲突的两套映射并存，不做合并。 */
export function addVariant(
  state: CaseClockState,
  sceneId: SceneId,
  label: string,
): CaseClockState {
  const mapping = sceneMapping(state, sceneId);
  const name = label.trim();
  if (!name) throw new Error("请为这套说法命名");
  if (name.length > 24) throw new Error("说法名称最多 24 个字");
  if (mapping.variants.some((variant) => variant.label === name))
    throw new Error("已存在同名说法");
  const source = activeVariant(mapping);
  const variant: MappingVariant = {
    id: newId(),
    label: name,
    anchors: source.anchors.map((anchor) => ({ ...anchor, id: newId() })),
  };
  return replaceScene(state, sceneId, {
    ...mapping,
    activeId: variant.id,
    variants: [...mapping.variants, variant],
  });
}

export function setActiveVariant(
  state: CaseClockState,
  sceneId: SceneId,
  variantId: string,
): CaseClockState {
  const mapping = sceneMapping(state, sceneId);
  if (!mapping.variants.some((variant) => variant.id === variantId))
    throw new Error("映射版本不存在");
  return replaceScene(state, sceneId, { ...mapping, activeId: variantId });
}

/** 恢复该地点的出厂映射，丢弃本地改动与额外说法。 */
export function resetScene(
  state: CaseClockState,
  content: CaseContent,
  sceneId: SceneId,
): CaseClockState {
  sceneMapping(state, sceneId);
  return replaceScene(
    state,
    sceneId,
    defaultSceneMapping(sceneId, sceneDuration(content, sceneId)),
  );
}

export function setCompare(
  state: CaseClockState,
  patch: Partial<CompareState>,
): CaseClockState {
  const compare = { ...state.compare, ...patch };
  if (compare.left === compare.right && state.scenes.length > 1)
    throw new Error("并排比较需要选择两个不同的地点");
  if (compare.primary !== "left" && compare.primary !== "right")
    throw new Error("主听视角无效");
  return { ...state, compare };
}

/** 打开案件时钟时，让当前收听的地点成为主听视角。 */
export function ensureCompare(
  state: CaseClockState,
  sceneId: SceneId,
): CaseClockState {
  if (state.compare.left === sceneId)
    return { ...state, compare: { ...state.compare, primary: "left" } };
  if (state.compare.right === sceneId)
    return { ...state, compare: { ...state.compare, primary: "right" } };
  return {
    ...state,
    compare: { ...state.compare, left: sceneId, primary: "left" },
  };
}

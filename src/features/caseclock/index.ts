export {
  validateAnchors,
  caseTimeAt,
  sourceTimeAt,
  coverage,
  sourceCoverage,
} from "./model/anchors";
export type { Coverage } from "./model/anchors";
export {
  createCaseClock,
  defaultSceneMapping,
  sceneDuration,
  sceneMapping,
  activeVariant,
  primarySceneId,
  commitAnchors,
  addVariant,
  setActiveVariant,
  resetScene,
  setCompare,
  ensureCompare,
} from "./model/mapping";
export {
  noteCaseRange,
  previewAnchorChange,
} from "./model/projection";
export type { CaseRange, NoteShift } from "./model/projection";
export { validateClockState } from "./lib/codec";
export { CaseClockDialog } from "./ui/CaseClockDialog";

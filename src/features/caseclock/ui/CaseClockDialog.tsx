import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Clock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type {
  CaseContent,
  CaseClockState,
  CompareSide,
  CompareState,
  Cue,
  Episode,
  EvidenceNote,
  HeardHistory,
  MappingVariant,
  Scene,
  SceneId,
  SceneMapping,
  TimeAnchor,
  TransportState,
} from "../../../shared/types";
import {
  formatClock,
  formatTime,
  newId,
  parseCaseClock,
  parseSourceClock,
} from "../../../shared/time";
import {
  caseTimeAt,
  coverage,
  sourceCoverage,
  sourceTimeAt,
  validateAnchors,
} from "../model/anchors";
import {
  activeVariant,
  primarySceneId,
  sceneDuration,
  sceneMapping,
} from "../model/mapping";
import {
  noteCaseRange,
  previewAnchorChange,
  type NoteShift,
} from "../model/projection";
import { resolveEpisode } from "../../story/lib/resolveEpisode";
import { currentCue, isCueHeard } from "../../transcript/lib/cues";

interface AudioPort {
  view: Omit<TransportState, "loadedId">;
  seek: (position: number) => void;
  pause: () => void;
  toggle: () => void;
}
interface Props {
  content: CaseContent;
  clock: CaseClockState;
  storySceneId: SceneId;
  clues: string[];
  notes: EvidenceNote[];
  heard: HeardHistory;
  audio: AudioPort;
  onGo: (scene: SceneId, position: number) => void;
  onCompare: (patch: Partial<CompareState>) => void;
  onVariant: (sceneId: SceneId, variantId: string) => void;
  onAddVariant: (sceneId: SceneId, label: string) => boolean;
  onCommit: (
    sceneId: SceneId,
    variantId: string,
    anchors: TimeAnchor[],
  ) => boolean;
  onResetScene: (sceneId: SceneId) => void;
  onClose: () => void;
}

const fmtSource = (n: number) => String(Math.round(n * 1000) / 1000);

export function CaseClockDialog({
  content,
  clock,
  storySceneId,
  clues,
  notes,
  heard,
  audio,
  onGo,
  onCompare,
  onVariant,
  onAddVariant,
  onCommit,
  onResetScene,
  onClose,
}: Props) {
  const compare = clock.compare,
    primarySide = compare.primary,
    primaryId = primarySceneId(clock);
  const anchorsOf = (sceneId: SceneId) =>
    activeVariant(sceneMapping(clock, sceneId)).anchors;
  const primaryAnchors = anchorsOf(primaryId);
  const [gapCursor, setGapCursor] = useState<number | null>(null);
  const [editorPick, setEditorPick] = useState<SceneId | null>(null);
  const editorScene = editorPick ?? primaryId;
  const position = audio.view.position,
    playing = audio.view.playing;
  const srcCov = sourceCoverage(primaryAnchors),
    cov = coverage(primaryAnchors);
  const covered =
    !!srcCov && position >= srcCov.start - 1e-6 && position <= srcCov.end + 1e-6;
  // 主声越过锚点覆盖边界时立即暂停，时间尺上显示为空档。
  useEffect(() => {
    if (playing && !covered) audio.pause();
  }, [playing, covered]);
  const previousPrimary = useRef(primaryId);
  useEffect(() => {
    if (previousPrimary.current !== primaryId) {
      previousPrimary.current = primaryId;
      setGapCursor(null);
    }
  }, [primaryId]);
  const liveCase = covered ? caseTimeAt(primaryAnchors, position) : null;
  const cursor = gapCursor ?? liveCase;
  const inGap = gapCursor !== null || !covered;
  const domain = useMemo<[number, number]>(() => {
    const ranges = [compare.left, compare.right]
      .flatMap((id) => sceneMapping(clock, id).variants)
      .map((variant) => coverage(variant.anchors))
      .filter((range): range is { start: number; end: number } => !!range);
    if (!ranges.length) return [9900, 13500];
    const start = Math.min(...ranges.map((range) => range.start)),
      end = Math.max(...ranges.map((range) => range.end));
    const pad = Math.max(300, (end - start) * 0.12);
    return [start - pad, end + pad];
  }, [clock, compare.left, compare.right]);
  const ticks = useMemo(() => {
    const span = domain[1] - domain[0],
      step = [300, 600, 900, 1800, 3600].find((s) => span / s <= 7) ?? 7200,
      out: number[] = [];
    for (let t = Math.ceil(domain[0] / step) * step; t <= domain[1]; t += step)
      out.push(t);
    return out;
  }, [domain]);
  const pct = (t: number) =>
    ((t - domain[0]) / (domain[1] - domain[0])) * 100;
  const scrub = (caseTime: number) => {
    const source = sourceTimeAt(primaryAnchors, caseTime);
    if (source === null) {
      // 空档：主听录音在该案发时刻没有覆盖，暂停主声并脱离跟随。
      audio.pause();
      setGapCursor(caseTime);
    } else {
      setGapCursor(null);
      audio.seek(source);
    }
  };
  const togglePlay = () => {
    if (!srcCov) return;
    if (gapCursor !== null || !covered) {
      const targetCase =
        gapCursor !== null && cov
          ? Math.min(cov.end, Math.max(cov.start, gapCursor))
          : position < srcCov.start
            ? cov!.start
            : cov!.end;
      const targetSource = sourceTimeAt(primaryAnchors, targetCase);
      setGapCursor(null);
      if (targetSource === null) return;
      audio.seek(targetSource);
      if (targetSource >= srcCov.end - 0.05) return;
      if (!playing) audio.toggle();
      return;
    }
    audio.toggle();
  };
  const switchPrimary = (side: CompareSide) => {
    if (side === primarySide) return;
    const sceneId = compare[side];
    onCompare({ primary: side });
    if (sceneId !== storySceneId) {
      const target =
        cursor !== null ? sourceTimeAt(anchorsOf(sceneId), cursor) : null;
      onGo(sceneId, target ?? 0);
    }
  };
  const ruler = useRef<HTMLDivElement>(null);
  const onRulerClick = (event: React.MouseEvent) => {
    const rect = ruler.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    scrub(
      domain[0] +
        ((event.clientX - rect.left) / rect.width) * (domain[1] - domain[0]),
    );
  };
  const renderLane = (side: CompareSide) => {
    const sceneId = compare[side],
      mapping = sceneMapping(clock, sceneId),
      active = activeVariant(mapping),
      laneCov = coverage(active.anchors),
      episode = resolveEpisode(content, sceneId, clues),
      scene = content.scenes.find((item) => item.id === sceneId)!;
    return (
      <div className="clock-lane" key={side}>
        <div className="clock-lane-label">
          <b>{scene.location}</b>
          <span>
            {active.label}
            {mapping.variants.length > 1 && (
              <em title="该地点保留了多套相互冲突的映射，未做合并">
                {mapping.variants.length} 套映射
              </em>
            )}
          </span>
        </div>
        <div className="clock-lane-track">
          {mapping.variants
            .filter((variant) => variant.id !== active.id)
            .map((variant) => {
              const range = coverage(variant.anchors);
              return range ? (
                <i
                  key={variant.id}
                  className="lane-ghost"
                  style={{
                    left: `${pct(range.start)}%`,
                    width: `${pct(range.end) - pct(range.start)}%`,
                  }}
                  title={`另一套映射：${variant.label}`}
                />
              ) : null;
            })}
          {laneCov && (
            <i
              className="lane-coverage"
              style={{
                left: `${pct(laneCov.start)}%`,
                width: `${pct(laneCov.end) - pct(laneCov.start)}%`,
              }}
              title={`${active.label} · 覆盖 ${formatClock(laneCov.start)} — ${formatClock(laneCov.end)}`}
            />
          )}
          {episode.cues.map((cue) => {
            const a = caseTimeAt(active.anchors, cue.start),
              b = caseTimeAt(active.anchors, cue.end);
            if (a === null || b === null) return null;
            return (
              <button
                key={cue.id}
                className="lane-cue"
                style={{
                  left: `${pct(a)}%`,
                  width: `${Math.max(0.8, pct(b) - pct(a))}%`,
                }}
                title={`${cue.speaker}：${cue.text}`}
                aria-label={`${formatClock(a)} ${cue.speaker}`}
                onClick={(event) => {
                  event.stopPropagation();
                  scrub(a);
                }}
              />
            );
          })}
          {episode.cues.map((cue) => {
            if (!cue.sound) return null;
            const t = caseTimeAt(active.anchors, cue.sound.start);
            return t === null ? null : (
              <span
                key={`sound-${cue.id}`}
                className="lane-sound"
                style={{ left: `${pct(t)}%` }}
                title={`声音线索 · ${cue.sound.description}`}
              />
            );
          })}
          {notes
            .filter((note) => note.anchor.sceneId === sceneId)
            .map((note) => {
              const range = noteCaseRange(active.anchors, note);
              return range ? (
                <button
                  key={note.id}
                  className="lane-note"
                  style={{ left: `${pct(range.start)}%` }}
                  title={`笔记 · ${note.title}（${formatClock(range.start)}）`}
                  aria-label={`笔记 ${note.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    scrub(range.start);
                  }}
                />
              ) : null;
            })}
        </div>
      </div>
    );
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="clock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clock-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">CASE CLOCK</span>
            <h2 id="clock-title">
              <Clock size={20} /> 案件时钟
            </h2>
            <p>
              三段录音各自从零开始；用锚点把它们插值到同一条案发时间线上对照。
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭案件时钟"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="clock-transport">
          <button
            className="clock-play"
            onClick={togglePlay}
            disabled={audio.view.loading || !srcCov}
            aria-label={playing ? "暂停主声" : "播放主声"}
            title={srcCov ? undefined : "主听地点尚未锚定，无法播放"}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <div className="clock-readout">
            <span className="mini-label">案发时间</span>
            <b>{cursor !== null ? formatClock(cursor) : "— : — : —"}</b>
            {inGap ? (
              <em className="gap-badge">
                空档 · 该时刻没有录音覆盖，主声已暂停
              </em>
            ) : (
              <em className="ok-badge">
                主听 ·{" "}
                {content.scenes.find((item) => item.id === primaryId)
                  ?.location ?? ""}
              </em>
            )}
          </div>
          <div className="clock-coverage">
            <span className="mini-label">主听覆盖</span>
            <b>
              {cov
                ? `${formatClock(cov.start)} — ${formatClock(cov.end)}`
                : "未锚定"}
            </b>
            <small>案发时间由锚点插值，与录音时长无关</small>
          </div>
        </div>
        <div className="clock-compare-bar">
          <label>
            左侧
            <SceneSelect
              content={content}
              value={compare.left}
              disabled={compare.right}
              onChange={(id) => onCompare({ left: id })}
            />
          </label>
          <button
            onClick={() =>
              onCompare({
                left: compare.right,
                right: compare.left,
                primary: primarySide === "left" ? "right" : "left",
              })
            }
          >
            <ArrowLeftRight size={13} /> 交换
          </button>
          <label>
            右侧
            <SceneSelect
              content={content}
              value={compare.right}
              disabled={compare.left}
              onChange={(id) => onCompare({ right: id })}
            />
          </label>
        </div>
        <div className="clock-ruler-wrap" onClick={onRulerClick}>
          <div className="clock-ruler" ref={ruler} role="presentation">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="clock-tick"
                style={{ left: `${pct(tick)}%` }}
              >
                {formatClock(tick, false)}
              </span>
            ))}
          </div>
          {renderLane("left")}
          {renderLane("right")}
          {cursor !== null && (
            <i
              className="clock-cursor"
              style={{ left: `${pct(cursor)}%` }}
              aria-hidden="true"
            >
              <b>{formatClock(cursor)}</b>
            </i>
          )}
        </div>
        <p className="clock-hint">
          点击时间尺或声纹块跳转共同时间；音轨空白区段即空档。◆ 为笔记落点，▲
          为声音线索。
        </p>
        <div className="clock-columns">
          {(["left", "right"] as CompareSide[]).map((side) => {
            const sceneId = compare[side],
              mapping = sceneMapping(clock, sceneId);
            return (
              <TestimonyColumn
                key={`${side}-${sceneId}`}
                side={side}
                scene={content.scenes.find((item) => item.id === sceneId)!}
                episode={resolveEpisode(content, sceneId, clues)}
                mapping={mapping}
                active={activeVariant(mapping)}
                isPrimary={side === primarySide}
                cursor={cursor}
                primaryPosition={position}
                heard={heard}
                onScrub={scrub}
                onSetPrimary={() => switchPrimary(side)}
              />
            );
          })}
        </div>
        <AnchorEditor
          key={`${editorScene}:${sceneMapping(clock, editorScene).activeId}`}
          content={content}
          sceneId={editorScene}
          mapping={sceneMapping(clock, editorScene)}
          notes={notes}
          storySceneId={storySceneId}
          position={position}
          liveCaseTime={liveCase}
          onSceneChange={setEditorPick}
          onVariant={(variantId) => onVariant(editorScene, variantId)}
          onAddVariant={(label) => onAddVariant(editorScene, label)}
          onCommit={(variantId, anchors) =>
            onCommit(editorScene, variantId, anchors)
          }
          onReset={() => onResetScene(editorScene)}
        />
      </section>
    </div>
  );
}

function SceneSelect({
  content,
  value,
  disabled,
  onChange,
}: {
  content: CaseContent;
  value: SceneId;
  disabled: SceneId;
  onChange: (id: SceneId) => void;
}) {
  return (
    <select
      value={value}
      aria-label="选择比较地点"
      onChange={(event) => onChange(event.target.value as SceneId)}
    >
      {content.scenes.map((scene) => (
        <option key={scene.id} value={scene.id} disabled={scene.id === disabled}>
          {scene.location}
        </option>
      ))}
    </select>
  );
}

function TestimonyColumn({
  side,
  scene,
  episode,
  mapping,
  active,
  isPrimary,
  cursor,
  primaryPosition,
  heard,
  onScrub,
  onSetPrimary,
}: {
  side: CompareSide;
  scene: Scene;
  episode: Episode;
  mapping: SceneMapping;
  active: MappingVariant;
  isPrimary: boolean;
  cursor: number | null;
  primaryPosition: number;
  heard: HeardHistory;
  onScrub: (caseTime: number) => void;
  onSetPrimary: () => void;
}) {
  const sourceAt =
    cursor !== null ? sourceTimeAt(active.anchors, cursor) : null;
  const localSource = isPrimary ? primaryPosition : sourceAt;
  const activeCue =
    localSource !== null ? currentCue(episode, localSource) : null;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeCue?.id]);
  const rows = episode.cues
    .map((cue) => ({ cue, at: caseTimeAt(active.anchors, cue.start) }))
    .filter((row): row is { cue: Cue; at: number } => row.at !== null)
    .sort((a, b) => a.at - b.at);
  const uncovered = episode.cues.length - rows.length;
  const cursorCovered = cursor !== null && sourceAt !== null;
  return (
    <section
      className={`clock-column ${isPrimary ? "primary" : ""}`}
      data-side={side}
    >
      <header>
        <div>
          <b>{scene.location}</b>
          <small>
            {episode.version} · {active.label}
          </small>
        </div>
        {isPrimary ? (
          <span className="primary-tag">主听中</span>
        ) : (
          <button onClick={onSetPrimary}>设为主听</button>
        )}
      </header>
      {cursor !== null && !cursorCovered && (
        <p className="column-gap">当前时刻不在这份录音的覆盖范围内。</p>
      )}
      {cursor === null && (
        <p className="column-gap">主听录音未锚定到案发时间。</p>
      )}
      <div className="column-cues" ref={list}>
        {rows.map(({ cue, at }) => {
          const live = activeCue?.id === cue.id,
            heardCue = isCueHeard(heard, episode, cue);
          return (
            <div
              key={cue.id}
              className={`column-cue ${live ? "current" : ""}`}
              data-active={live}
            >
              <button
                className="cue-time"
                onClick={() => onScrub(at)}
                aria-label={`跳到案发时间 ${formatClock(at)}`}
              >
                {formatClock(at, false)}
              </button>
              <div className="cue-body">
                <div className="cue-speaker">
                  {cue.speaker}
                  <span>{live ? "共同时间所在" : heardCue ? "已听" : ""}</span>
                </div>
                <p>
                  {heardCue || live
                    ? cue.text
                    : "尚未收听 · 这段对白还藏在声音里"}
                </p>
                {cue.sound && (heardCue || live) && (
                  <span className="column-sound">
                    ▲ {cue.sound.description}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <p className="empty-small">该地点尚未锚定，无法对齐到案发时间。</p>
        )}
      </div>
      {uncovered > 0 && (
        <footer className="column-foot">
          {uncovered} 段对白在锚点覆盖之外，未参与对齐。
        </footer>
      )}
    </section>
  );
}

interface DraftRow {
  id: string;
  source: string;
  caseTime: string;
  label: string;
}

function AnchorEditor({
  content,
  sceneId,
  mapping,
  notes,
  storySceneId,
  position,
  liveCaseTime,
  onSceneChange,
  onVariant,
  onAddVariant,
  onCommit,
  onReset,
}: {
  content: CaseContent;
  sceneId: SceneId;
  mapping: SceneMapping;
  notes: EvidenceNote[];
  storySceneId: SceneId;
  position: number;
  liveCaseTime: number | null;
  onSceneChange: (sceneId: SceneId) => void;
  onVariant: (variantId: string) => void;
  onAddVariant: (label: string) => boolean;
  onCommit: (variantId: string, anchors: TimeAnchor[]) => boolean;
  onReset: () => void;
}) {
  const active = activeVariant(mapping);
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [previewed, setPreviewed] = useState<TimeAnchor[] | null>(null);
  const [shifts, setShifts] = useState<NoteShift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const editing = rows !== null;
  const invalidate = () => {
    setPreviewed(null);
    setShifts(null);
    setError(null);
  };
  const startEditing = () => {
    setRows(
      active.anchors.map((anchor) => ({
        id: anchor.id,
        source: fmtSource(anchor.sourceTime),
        caseTime: formatClock(anchor.caseTime),
        label: anchor.label,
      })),
    );
    invalidate();
  };
  const changeRow = (id: string, patch: Partial<DraftRow>) => {
    setRows(
      (rows ?? []).map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    invalidate();
  };
  const addRow = (source?: number) => {
    const list = rows ?? [];
    const lastSource = list.length
      ? Math.max(...list.map((row) => parseSourceClock(row.source) ?? 0))
      : 0;
    const lastCase = list.length
      ? Math.max(...list.map((row) => parseCaseClock(row.caseTime) ?? 0))
      : 0;
    setRows([
      ...list,
      {
        id: newId(),
        source: fmtSource(source ?? lastSource + (list.length ? 1 : 0)),
        caseTime: formatClock(
          liveCaseTime ?? (lastCase ? lastCase + 60 : 10800),
        ),
        label: "",
      },
    ]);
    invalidate();
  };
  const runPreview = () => {
    if (!rows) return;
    const parsed: TimeAnchor[] = [];
    for (let i = 0; i < rows.length; i++) {
      const sourceTime = parseSourceClock(rows[i].source),
        caseTime = parseCaseClock(rows[i].caseTime);
      if (sourceTime === null || caseTime === null) {
        setError(
          `第 ${i + 1} 行时间格式无效：录音时间如 65.5 或 1:05，案发时间如 23:17 或 次日 00:03`,
        );
        setPreviewed(null);
        setShifts(null);
        return;
      }
      parsed.push({
        id: rows[i].id,
        sourceTime,
        caseTime,
        label: rows[i].label.trim(),
      });
    }
    try {
      const sorted = validateAnchors(parsed, sceneDuration(content, sceneId));
      setPreviewed(sorted);
      setShifts(previewAnchorChange(notes, sceneId, active.anchors, sorted));
      setError(null);
    } catch (e) {
      setPreviewed(null);
      setShifts(null);
      setError(e instanceof Error ? e.message : "锚点无效");
    }
  };
  const commit = () => {
    if (!previewed) return;
    if (onCommit(active.id, previewed)) {
      setRows(null);
      setPreviewed(null);
      setShifts(null);
    }
  };
  return (
    <section className="anchor-editor">
      <header className="anchor-editor-head">
        <div>
          <span className="eyebrow">ANCHORS</span>
          <h3>锚点与映射</h3>
        </div>
        <label>
          地点
          <select
            value={sceneId}
            aria-label="选择要编辑锚点的地点"
            onChange={(event) => onSceneChange(event.target.value as SceneId)}
          >
            {content.scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.location}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="variant-bar">
        {mapping.variants.map((variant) => (
          <button
            key={variant.id}
            className={`variant-tab ${variant.id === active.id ? "active" : ""}`}
            onClick={() => onVariant(variant.id)}
            title={
              mapping.variants.length > 1
                ? "切换到这套映射进行对照，另一套仍然保留"
                : undefined
            }
          >
            {variant.label}
            <small>{variant.anchors.length} 锚点</small>
          </button>
        ))}
        <form
          className="variant-new"
          onSubmit={(event) => {
            event.preventDefault();
            if (newLabel.trim() && onAddVariant(newLabel.trim()))
              setNewLabel("");
          }}
        >
          <input
            value={newLabel}
            maxLength={24}
            placeholder="新说法，如：港务记录推断"
            aria-label="新说法名称"
            onChange={(event) => setNewLabel(event.target.value)}
          />
          <button disabled={!newLabel.trim()}>
            <Plus size={12} /> 并列一套
          </button>
        </form>
      </div>
      {mapping.variants.length > 1 && (
        <p className="conflict-note">
          <AlertTriangle size={12} />
          该地点的证词存在冲突：{mapping.variants.length}
          套映射并列保留，可切换对照，系统不会自动把它们改成一致。
        </p>
      )}
      {!editing ? (
        <>
          <table className="anchor-table">
            <thead>
              <tr>
                <th>录音时间</th>
                <th>案发时间</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {active.anchors.map((anchor) => (
                <tr key={anchor.id}>
                  <td>{formatTime(anchor.sourceTime)}</td>
                  <td>{formatClock(anchor.caseTime)}</td>
                  <td>{anchor.label || "—"}</td>
                </tr>
              ))}
              {!active.anchors.length && (
                <tr>
                  <td colSpan={3}>尚未锚定，该地点不参与案发时间对齐。</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="anchor-actions">
            <button className="primary-button" onClick={startEditing}>
              调整锚点
            </button>
            {confirmReset ? (
              <>
                <button
                  className="danger-button"
                  onClick={() => {
                    onReset();
                    setConfirmReset(false);
                  }}
                >
                  确认恢复默认
                </button>
                <button onClick={() => setConfirmReset(false)}>取消</button>
              </>
            ) : (
              <button onClick={() => setConfirmReset(true)}>
                <RotateCcw size={12} /> 恢复默认映射
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <table className="anchor-table editing">
            <thead>
              <tr>
                <th>录音时间（秒 / 分:秒）</th>
                <th>案发时间（时:分[:秒]）</th>
                <th>备注</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      value={row.source}
                      aria-label="录音时间"
                      onChange={(event) =>
                        changeRow(row.id, { source: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.caseTime}
                      aria-label="案发时间"
                      placeholder="23:17"
                      onChange={(event) =>
                        changeRow(row.id, { caseTime: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={row.label}
                      aria-label="锚点备注"
                      placeholder="如：三声钟响"
                      onChange={(event) =>
                        changeRow(row.id, { label: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <button
                      aria-label="删除锚点"
                      onClick={() => {
                        setRows(rows.filter((item) => item.id !== row.id));
                        invalidate();
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="anchor-actions">
            <button onClick={() => addRow()}>
              <Plus size={12} /> 添加锚点
            </button>
            <button
              disabled={storySceneId !== sceneId}
              title={
                storySceneId !== sceneId
                  ? "当前播放的是其他地点的录音，请先切换主听"
                  : "以当前播放位置和案发时间新建锚点"
              }
              onClick={() => addRow(position)}
            >
              从播放位置取点
            </button>
            <span className="anchor-spacer" />
            <button className="primary-button" onClick={runPreview}>
              预览影响
            </button>
            <button
              className="primary-button"
              disabled={!previewed}
              title={previewed ? undefined : "请先预览受影响的笔记落点"}
              onClick={commit}
            >
              <Check size={13} /> 确认提交
            </button>
            <button
              onClick={() => {
                setRows(null);
                invalidate();
              }}
            >
              <X size={13} /> 放弃
            </button>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {previewed && shifts && (
            <div className="anchor-preview">
              <b>
                预览：{shifts.length ? `${shifts.length} 篇笔记的落点将变化` : "没有笔记受到影响"}
                ，确认后才会生效。
              </b>
              {shifts.length > 0 && (
                <ul>
                  {shifts.map((shift) => (
                    <li key={shift.note.id}>
                      <span>{shift.note.title}</span>
                      <em>
                        {shift.before
                          ? `${formatClock(shift.before.start)} — ${formatClock(shift.before.end)}`
                          : "未覆盖"}
                        {" → "}
                        {shift.after
                          ? `${formatClock(shift.after.start)} — ${formatClock(shift.after.end)}`
                          : "未覆盖"}
                      </em>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

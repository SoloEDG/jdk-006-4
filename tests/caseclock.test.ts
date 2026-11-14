import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAnchors,
  caseTimeAt,
  sourceTimeAt,
  coverage,
  createCaseClock,
  commitAnchors,
  addVariant,
  setActiveVariant,
  setCompare,
  ensureCompare,
  activeVariant,
  sceneMapping,
  noteCaseRange,
  previewAnchorChange,
  validateClockState,
} from "../src/features/caseclock/index";
import { createSnapshot, validateSnapshot } from "../src/features/profiles/index";
import { createEvidence, addNote } from "../src/features/evidence/index";
import { formatClock, parseCaseClock } from "../src/shared/time";
import type {
  CaseContent,
  Investigation,
  TimeAnchor,
} from "../src/shared/types";

const content: CaseContent = {
  id: "test",
  title: "test",
  scenes: [
    {
      id: "arrival",
      title: "来电",
      location: "电台",
      chapter: "1",
      description: "",
      choices: [],
    },
    {
      id: "harbor",
      title: "码头",
      location: "旧码头",
      chapter: "2",
      description: "",
      choices: [],
    },
  ],
  episodes: [
    {
      id: "arrival-main",
      sceneId: "arrival",
      title: "A",
      version: "main",
      description: "",
      audio: "a",
      duration: 30,
      wave: [],
      cues: [],
    },
    {
      id: "harbor-main",
      sceneId: "harbor",
      title: "B",
      version: "main",
      description: "",
      audio: "b",
      duration: 25,
      wave: [],
      cues: [],
    },
  ],
  clues: [],
};
const story: Investigation = {
  sceneId: "arrival",
  visited: ["arrival"],
  decisions: [],
  ending: null,
};
const anchor = (id: string, sourceTime: number, caseTime: number): TimeAnchor => ({
  id,
  sourceTime,
  caseTime,
  label: "",
});
const pair = () => [anchor("a", 0, 100), anchor("b", 10, 200)];

test("anchors: interpolation is linear and never extrapolates", () => {
  const anchors = pair();
  assert.equal(caseTimeAt(anchors, 0), 100);
  assert.equal(caseTimeAt(anchors, 5), 150);
  assert.equal(caseTimeAt(anchors, 10), 200);
  assert.equal(caseTimeAt(anchors, -0.1), null);
  assert.equal(caseTimeAt(anchors, 10.1), null);
  assert.equal(sourceTimeAt(anchors, 150), 5);
  assert.equal(sourceTimeAt(anchors, 99), null);
  assert.equal(sourceTimeAt(anchors, 201), null);
  assert.deepEqual(coverage(anchors), { start: 100, end: 200 });
  assert.equal(coverage([anchor("a", 0, 100)]), null);
});

test("anchors: reversed or duplicate times are rejected as invalid intervals", () => {
  assert.throws(
    () => validateAnchors([anchor("a", 0, 200), anchor("b", 10, 100)], 30),
    /倒序/,
  );
  assert.throws(
    () => validateAnchors([anchor("a", 0, 100), anchor("b", 10, 100)], 30),
    /重复/,
  );
  assert.throws(
    () => validateAnchors([anchor("a", 5, 100), anchor("b", 5, 200)], 30),
    /重复/,
  );
  assert.throws(() => validateAnchors([anchor("a", 0, 100)], 30), /两个锚点/);
  assert.throws(
    () => validateAnchors([anchor("a", 0, 100), anchor("b", 31, 200)], 30),
    /超出音频/,
  );
  assert.throws(
    () => validateAnchors([anchor("a", -1, 100), anchor("b", 10, 200)], 30),
  );
  const sorted = validateAnchors(
    [anchor("b", 10, 200), anchor("a", 0, 100)],
    30,
  );
  assert.deepEqual(
    sorted.map((a) => a.id),
    ["a", "b"],
  );
});

test("conflicting testimonies keep both mappings without reconciliation", () => {
  let clock = createCaseClock(content);
  clock = commitAnchors(
    clock,
    content,
    "arrival",
    activeVariant(sceneMapping(clock, "arrival")).id,
    [anchor("h1", 0, 1000), anchor("h2", 20, 1600)],
  );
  clock = addVariant(clock, "arrival", "巡夜人的说法");
  const secondId = activeVariant(sceneMapping(clock, "arrival")).id;
  clock = commitAnchors(clock, content, "arrival", secondId, [
    anchor("g1", 0, 100),
    anchor("g2", 20, 400),
  ]);
  const mapping = sceneMapping(clock, "arrival");
  assert.equal(mapping.variants.length, 2);
  const first = mapping.variants.find((v) => v.id !== secondId)!;
  const second = mapping.variants.find((v) => v.id === secondId)!;
  assert.equal(caseTimeAt(first.anchors, 10), 1300);
  assert.equal(caseTimeAt(second.anchors, 10), 250);
  assert.equal(mapping.activeId, secondId);
  clock = setActiveVariant(clock, "arrival", first.id);
  assert.equal(sceneMapping(clock, "arrival").activeId, first.id);
  assert.equal(caseTimeAt(second.anchors, 10), 250);
});

test("commit rejects invalid anchors and leaves state untouched", () => {
  const clock = createCaseClock(content);
  const variantId = activeVariant(sceneMapping(clock, "arrival")).id;
  assert.throws(() =>
    commitAnchors(clock, content, "arrival", variantId, [
      anchor("a", 0, 300),
      anchor("b", 10, 100),
    ]),
  );
  assert.throws(() =>
    commitAnchors(clock, content, "arrival", variantId, [
      anchor("a", 0, 100),
      anchor("b", 10, 100),
    ]),
  );
  assert.equal(sceneMapping(clock, "arrival"), sceneMapping(clock, "arrival"));
});

test("compare state keeps two distinct scenes and a valid primary side", () => {
  let clock = createCaseClock(content);
  assert.equal(clock.compare.left, "arrival");
  assert.equal(clock.compare.right, "harbor");
  clock = setCompare(clock, { primary: "right" });
  assert.equal(clock.compare.primary, "right");
  assert.throws(() => setCompare(clock, { left: "harbor" }));
  clock = ensureCompare(clock, "harbor");
  assert.equal(clock.compare.primary, "right");
  clock = ensureCompare(clock, "arrival");
  assert.equal(clock.compare.primary, "left");
});

test("note projection and preview expose moved and uncovered notes", () => {
  const evidence = addNote(
    addNote(createEvidence(), { sceneId: "arrival", start: 4, end: 6 }, "钟"),
    { sceneId: "harbor", start: 1, end: 2 }, "笛",
  );
  const before = [anchor("a", 0, 100), anchor("b", 10, 200)];
  const after = [anchor("a", 6, 1000), anchor("b", 10, 1100)];
  const bell = evidence.notes.find((n) => n.text === "钟")!;
  assert.deepEqual(noteCaseRange(before, bell), { start: 140, end: 160 });
  assert.equal(noteCaseRange(after, bell), null);
  const shifts = previewAnchorChange(
    evidence.notes,
    "arrival",
    before,
    after,
  );
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].note.id, bell.id);
  assert.deepEqual(shifts[0].before, { start: 140, end: 160 });
  assert.equal(shifts[0].after, null);
  assert.equal(
    previewAnchorChange(evidence.notes, "harbor", before, before).length,
    0,
  );
});

test("clock survives snapshot save/export/import round trip", () => {
  let clock = createCaseClock(content);
  clock = commitAnchors(
    clock,
    content,
    "arrival",
    activeVariant(sceneMapping(clock, "arrival")).id,
    pair(),
  );
  const snap = createSnapshot(
    content,
    story,
    createEvidence(),
    {},
    { sceneId: "arrival", position: 0, rate: 1 },
    clock,
  );
  const restored = validateSnapshot(JSON.parse(JSON.stringify(snap)), content);
  assert.deepEqual(
    activeVariant(sceneMapping(restored.clock, "arrival")).anchors,
    pair(),
  );
  assert.deepEqual(restored.clock.compare, clock.compare);
  const legacy = JSON.parse(JSON.stringify(snap));
  delete legacy.clock;
  const upgraded = validateSnapshot(legacy, content);
  assert.equal(upgraded.clock.scenes.length, content.scenes.length);
  const broken = JSON.parse(JSON.stringify(snap));
  broken.clock.scenes[0].variants[0].anchors = [
    { id: "x", sourceTime: 0, caseTime: 500, label: "" },
    { id: "y", sourceTime: 5, caseTime: 500, label: "" },
  ];
  assert.throws(() => validateSnapshot(broken, content), /重复/);
  const unknown = JSON.parse(JSON.stringify(snap));
  unknown.clock.scenes.push({
    sceneId: "nowhere",
    activeId: "v",
    variants: [{ id: "v", label: "x", anchors: [] }],
  });
  assert.throws(() => validateSnapshot(unknown, content), /未知地点/);
});

test("case clock formatting and parsing round trip across midnight", () => {
  assert.equal(formatClock(11820), "23:17:00");
  assert.equal(formatClock(11820, false), "23:17");
  assert.equal(formatClock(14580), "次日 00:03:00");
  assert.equal(parseCaseClock("23:17"), 11820);
  assert.equal(parseCaseClock("23:17:30"), 11850);
  assert.equal(parseCaseClock("次日 00:03"), 14580);
  assert.equal(parseCaseClock("25:10"), 18600);
  assert.equal(parseCaseClock("19:59"), null);
  assert.equal(parseCaseClock("abc"), null);
  assert.equal(parseCaseClock("23:99"), null);
});

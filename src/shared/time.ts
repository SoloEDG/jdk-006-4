export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
export const bounded = (n: number, a: number, b: number) =>
  Math.min(b, Math.max(a, n));
export const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
/** 案件时间零点：1998-11-07 20:00:00，案发时间以此为偏移秒数。 */
export const CASE_EPOCH_WALL_SECONDS = 20 * 3600;
export const CASE_TIME_MAX = 36 * 3600;
export function formatClock(caseTime: number, withSeconds = true): string {
  const wall = CASE_EPOCH_WALL_SECONDS + caseTime;
  const day = Math.floor(wall / 86400);
  const tod = ((wall % 86400) + 86400) % 86400;
  const h = Math.floor(tod / 3600),
    m = Math.floor((tod % 3600) / 60),
    s = Math.floor(tod % 60);
  const clock = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}${withSeconds ? `:${s.toString().padStart(2, "0")}` : ""}`;
  return day > 0 ? `次日 ${clock}` : clock;
}
export function parseCaseClock(text: string): number | null {
  const match =
    /^(次日\s*)?(\d{1,3}):([0-5]?\d)(?::([0-5]?\d(?:\.\d+)?))?$/.exec(
      text.trim(),
    );
  if (!match) return null;
  const wall =
    (match[1] ? 86400 : 0) +
    Number(match[2]) * 3600 +
    Number(match[3]) * 60 +
    Number(match[4] ?? 0);
  const caseTime = wall - CASE_EPOCH_WALL_SECONDS;
  return caseTime >= 0 && caseTime <= CASE_TIME_MAX ? caseTime : null;
}
export function parseSourceClock(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.includes(":")) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }
  const match = /^(\d{1,3}):([0-5]?\d(?:\.\d+)?)$/.exec(trimmed);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

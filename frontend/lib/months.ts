// Month formatting helpers shared by the timeline, chat panel, and detail sheet.
//
// Months are always "YYYY-MM" strings, which sort lexicographically in
// chronological order — every range comparison in the app relies on that.

import type { Snapshot } from "./api/types";

export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2020-03" → "Mar 2020". Returns the input unchanged if it isn't a month. */
export function formatMonth(m: string | null | undefined): string {
  if (!m) return "—";
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo || mo < 1 || mo > 12) return m;
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

/** "Mar 2020" for a single month, "Jan 2020 → Jun 2021" for a span. */
export function formatMonthRange(
  from: string | null | undefined,
  to: string | null | undefined
): string {
  if (!from && !to) return "—";
  if (!from || !to || from === to) return formatMonth(from ?? to);
  return `${formatMonth(from)} → ${formatMonth(to)}`;
}

/** Human label for whatever period a snapshot covers (single month or merged range). */
export function formatPeriod(snapshot: Snapshot | null | undefined): string {
  if (!snapshot) return "—";
  if (snapshot.range) {
    return formatMonthRange(snapshot.range.from, snapshot.range.to);
  }
  return formatMonth(snapshot.month);
}

/** Inclusive slice of `all` between `from` and `to`. */
export function monthsBetween(
  all: string[],
  from: string | null | undefined,
  to: string | null | undefined
): string[] {
  if (!from || !to) return [];
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  return all.filter((m) => m >= lo && m <= hi);
}

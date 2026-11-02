// Start with the month containing the first record; never project beyond asOf.
export function monthlyTrendDates(firstDate, asOf) {
  if (!firstDate || firstDate > asOf) return [];
  const [year, month] = firstDate.split("-").map(Number);
  const end = new Date(`${firstDate}T00:00:00Z`);
  end.setUTCFullYear(year, month, 0);
  const days = [];
  while (end.toISOString().slice(0, 10) < asOf) {
    days.push(end.toISOString().slice(0, 10));
    // Move to the end of the next month without overflowing short months.
    end.setUTCMonth(end.getUTCMonth() + 2, 0);
  }
  days.push(asOf);
  return days;
}

// Input is chronological. Keep endpoints and interior extremes, then choose
// remaining dates nearest evenly spaced time targets (not record indices).
export function sampleTrendPoints(points, limit = 36) {
  if (points.length <= limit) return points;
  const last = points.length - 1;
  let low = 1, high = 1;
  for (let i = 2; i < last; i++) {
    if (points[i].value < points[low].value) low = i;
    if (points[i].value > points[high].value) high = i;
  }
  const selected = new Set([0, last, low, high]);
  const times = points.map(p => Date.parse(`${p.day}T00:00:00Z`));
  const remaining = limit - selected.size;
  for (let slot = 1; slot <= remaining; slot++) {
    const target = times[0] + (times[last] - times[0]) * slot / (remaining + 1);
    let best = -1, distance = Infinity;
    for (let i = 1; i < last; i++) {
      if (selected.has(i)) continue;
      const delta = Math.abs(times[i] - target);
      if (delta < distance) { best = i; distance = delta; }
    }
    selected.add(best);
  }
  return [...selected].sort((a, b) => a - b).map(i => points[i]);
}

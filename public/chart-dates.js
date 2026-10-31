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

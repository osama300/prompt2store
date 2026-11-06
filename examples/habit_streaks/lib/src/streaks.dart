// Pure-Dart streak logic. No Flutter imports so it can be unit tested anywhere.

/// Strips the time-of-day so two [DateTime]s on the same calendar day compare equal.
DateTime dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

/// Previous calendar day (DST-safe, unlike subtracting 24 hours).
DateTime previousDay(DateTime d) => DateTime(d.year, d.month, d.day - 1);

/// Next calendar day (DST-safe).
DateTime nextDay(DateTime d) => DateTime(d.year, d.month, d.day + 1);

/// Stable `yyyy-MM-dd` key for a day.
String dayKey(DateTime d) {
  final m = d.month.toString().padLeft(2, '0');
  final day = d.day.toString().padLeft(2, '0');
  return '${d.year.toString().padLeft(4, '0')}-$m-$day';
}

/// Parses a key produced by [dayKey].
DateTime parseDayKey(String key) {
  final p = key.split('-');
  return DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
}

/// Number of consecutive completed days ending today or yesterday.
///
/// If today is not yet checked off the streak is still alive as long as
/// yesterday was completed, so users do not lose it before the day is over.
int currentStreak(Iterable<DateTime> completed, DateTime today) {
  final days = completed.map(dateOnly).toSet();
  var cursor = dateOnly(today);
  if (!days.contains(cursor)) {
    cursor = previousDay(cursor);
    if (!days.contains(cursor)) return 0;
  }
  var count = 0;
  while (days.contains(cursor)) {
    count++;
    cursor = previousDay(cursor);
  }
  return count;
}

/// Longest run of consecutive completed days ever recorded.
int bestStreak(Iterable<DateTime> completed) {
  final days = completed.map(dateOnly).toSet().toList()..sort();
  var best = 0;
  var run = 0;
  DateTime? prev;
  for (final d in days) {
    if (prev != null && nextDay(prev) == d) {
      run++;
    } else {
      run = 1;
    }
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

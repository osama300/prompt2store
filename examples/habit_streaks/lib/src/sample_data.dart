import 'models.dart';
import 'repository.dart';
import 'store.dart';
import 'streaks.dart';

/// Builds a set of days: every day in [daysBack] offsets before [today] that is not in [skip].
Set<DateTime> _run(
  DateTime today,
  int from,
  int to, {
  Set<int> skip = const {},
}) {
  final out = <DateTime>{};
  for (var i = from; i <= to; i++) {
    if (skip.contains(i)) continue;
    out.add(DateTime(today.year, today.month, today.day - i));
  }
  return out;
}

/// Realistic sample habits relative to [today], for screenshots, tests and demos.
List<Habit> sampleHabits(DateTime today) {
  final t = dateOnly(today);
  return [
    Habit(
      id: 'h1',
      name: 'Drink 2L of water',
      iconKey: 'water',
      colorValue: 0xFF2E9BEA,
      completions: _run(t, 0, 11),
    ),
    Habit(
      id: 'h2',
      name: 'Morning run',
      iconKey: 'run',
      colorValue: 0xFFEF6C4D,
      completions: _run(t, 1, 6)..addAll(_run(t, 9, 20, skip: {13, 17})),
    ),
    Habit(
      id: 'h3',
      name: 'Read 20 pages',
      iconKey: 'book',
      colorValue: 0xFF9B5DE5,
      completions: _run(t, 0, 3)..addAll(_run(t, 6, 15, skip: {8, 11})),
    ),
    Habit(
      id: 'h4',
      name: 'Meditate',
      iconKey: 'meditate',
      colorValue: 0xFF14A38B,
      completions: _run(t, 1, 1)..addAll(_run(t, 3, 8)),
    ),
    Habit(
      id: 'h5',
      name: 'Practice guitar',
      iconKey: 'music',
      colorValue: 0xFFF2A33A,
      completions: _run(t, 2, 4)
        ..addAll(_run(t, 7, 25, skip: {10, 12, 19, 21})),
    ),
  ];
}

/// A store pre-filled with [sampleHabits] and a fixed clock.
HabitStore sampleStore([DateTime? now]) {
  final clock = now ?? DateTime(2026, 11, 6, 9, 30);
  final habits = sampleHabits(clock);
  return HabitStore(
    InMemoryHabitRepository(habits),
    clock: () => clock,
    initial: habits,
  );
}

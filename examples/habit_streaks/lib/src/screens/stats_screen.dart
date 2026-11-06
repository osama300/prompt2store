import 'package:flutter/material.dart';

import '../store.dart';
import '../widgets/streak_badge.dart';
import 'habit_detail_screen.dart';

const _dayLetters = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// Overview across all habits: totals, a 7-day chart and a streak leaderboard.
class StatsScreen extends StatelessWidget {
  const StatsScreen({super.key, required this.store});

  final HabitStore store;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final habits = store.habits;
        final today = store.today;
        final days = [
          for (var i = 6; i >= 0; i--)
            DateTime(today.year, today.month, today.day - i),
        ];
        final perDay = [
          for (final d in days) habits.where((h) => h.isDone(d)).length,
        ];
        final possible = habits.length * 7;
        final rate = possible == 0
            ? 0
            : (perDay.fold<int>(0, (a, b) => a + b) * 100 / possible).round();
        final best = habits.fold<int>(
          0,
          (m, h) => h.bestStreak > m ? h.bestStreak : m,
        );
        final active = habits.fold<int>(0, (m, h) {
          final s = h.currentStreakAt(today);
          return s > m ? s : m;
        });
        final totalChecks = habits.fold<int>(
          0,
          (a, h) => a + h.completions.length,
        );
        final ranked = [...habits]
          ..sort(
            (a, b) =>
                b.currentStreakAt(today).compareTo(a.currentStreakAt(today)),
          );
        final maxBar = habits.isEmpty ? 1 : habits.length;

        return SafeArea(
          bottom: false,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            children: [
              Text(
                'YOUR PROGRESS',
                style: TextStyle(
                  fontSize: 12,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.w700,
                  color: scheme.primary,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Stats',
                style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: _Tile(
                      icon: Icons.local_fire_department,
                      color: const Color(0xFFFF8A3D),
                      value: '$active',
                      label: 'Longest active streak',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _Tile(
                      icon: Icons.emoji_events_outlined,
                      color: const Color(0xFFF2A33A),
                      value: '$best',
                      label: 'Best streak ever',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _Tile(
                      icon: Icons.percent,
                      color: scheme.primary,
                      value: '$rate%',
                      label: '7-day completion',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _Tile(
                      icon: Icons.task_alt,
                      color: const Color(0xFF14A38B),
                      value: '$totalChecks',
                      label: 'Total check-ins',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'This week',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Habits completed per day',
                        style: TextStyle(
                          fontSize: 13,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        height: 130,
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            for (var i = 0; i < 7; i++)
                              Expanded(
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    Text(
                                      '${perDay[i]}',
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700,
                                        color: scheme.onSurfaceVariant,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    AnimatedContainer(
                                      duration: const Duration(
                                        milliseconds: 400,
                                      ),
                                      width: 26,
                                      height: 6 + 74 * (perDay[i] / maxBar),
                                      decoration: BoxDecoration(
                                        color: i == 6
                                            ? scheme.primary
                                            : scheme.primary.withValues(
                                                alpha: 0.35,
                                              ),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      _dayLetters[days[i].weekday - 1],
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: i == 6
                                            ? FontWeight.w800
                                            : FontWeight.w500,
                                        color: i == 6
                                            ? scheme.onSurface
                                            : scheme.outline,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Streak leaderboard',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      for (final h in ranked)
                        InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => HabitDetailScreen(
                                store: store,
                                habitId: h.id,
                              ),
                            ),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            child: Row(
                              children: [
                                Container(
                                  width: 36,
                                  height: 36,
                                  decoration: BoxDecoration(
                                    color: h.color.withValues(alpha: 0.16),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: Icon(h.icon, color: h.color, size: 20),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    h.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                StreakBadge(count: h.currentStreakAt(today)),
                                const SizedBox(width: 12),
                                SizedBox(
                                  width: 52,
                                  child: Text(
                                    'best ${h.bestStreak}',
                                    textAlign: TextAlign.right,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: scheme.outline,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({
    required this.icon,
    required this.color,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final Color color;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(height: 14),
            Text(
              value,
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

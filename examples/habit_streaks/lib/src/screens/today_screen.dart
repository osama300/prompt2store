import 'package:flutter/material.dart';

import '../models.dart';
import '../store.dart';
import '../widgets/progress_ring.dart';
import '../widgets/streak_badge.dart';
import 'habit_detail_screen.dart';

const _weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const _months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

String formatLongDate(DateTime d) =>
    '${_weekdays[d.weekday - 1]}, ${_months[d.month - 1]} ${d.day}';

/// Body of the Today tab: day progress ring plus the list of habits to check off.
class TodayScreen extends StatelessWidget {
  const TodayScreen({super.key, required this.store});

  final HabitStore store;

  String _headline(int done, int total) {
    if (total == 0) return 'Add your first habit';
    if (done == total) return 'All done for today!';
    if (done == 0) return 'Let\'s get started';
    return '${total - done} left to go';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final habits = store.habits;
        final done = store.doneToday;
        final total = habits.length;
        return SafeArea(
          bottom: false,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        formatLongDate(store.today).toUpperCase(),
                        style: TextStyle(
                          fontSize: 12,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.w700,
                          color: scheme.primary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Today',
                        style: TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: _ProgressCard(
                    done: done,
                    total: total,
                    headline: _headline(done, total),
                    progress: store.progressToday,
                  ),
                ),
              ),
              if (habits.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: _EmptyState(scheme: scheme),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 112),
                  sliver: SliverList.separated(
                    itemCount: habits.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, i) =>
                        HabitTile(store: store, habit: habits[i]),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _ProgressCard extends StatelessWidget {
  const _ProgressCard({
    required this.done,
    required this.total,
    required this.headline,
    required this.progress,
  });

  final int done;
  final int total;
  final String headline;
  final double progress;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.primary,
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Row(
          children: [
            ProgressRing(
              progress: progress,
              size: 104,
              strokeWidth: 11,
              color: Colors.white,
              trackColor: Colors.white.withValues(alpha: 0.25),
              child: Text(
                '$done/$total',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: scheme.onPrimary,
                ),
              ),
            ),
            const SizedBox(width: 22),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    headline,
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: scheme.onPrimary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    total == 0
                        ? 'Tap the button below to begin.'
                        : '${(progress * 100).round()}% of today\'s habits complete. Keep your streaks alive.',
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.35,
                      color: scheme.onPrimary.withValues(alpha: 0.85),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.scheme});

  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.local_fire_department,
            size: 56,
            color: scheme.primary.withValues(alpha: 0.6),
          ),
          const SizedBox(height: 12),
          const Text(
            'No habits yet',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            'Small daily actions add up. Create a habit and build your first streak.',
            textAlign: TextAlign.center,
            style: TextStyle(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

/// One habit row: tap to open details, tap the circle to check off today.
class HabitTile extends StatelessWidget {
  const HabitTile({super.key, required this.store, required this.habit});

  final HabitStore store;
  final Habit habit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final done = habit.isDone(store.today);
    final streak = habit.currentStreakAt(store.today);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => HabitDetailScreen(store: store, habitId: habit.id),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: habit.color.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(habit.icon, color: habit.color, size: 26),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      habit.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 16.5,
                        fontWeight: FontWeight.w600,
                        decoration: done ? TextDecoration.lineThrough : null,
                        decorationColor: scheme.outline,
                        color: done
                            ? scheme.onSurfaceVariant
                            : scheme.onSurface,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        StreakBadge(count: streak),
                        const SizedBox(width: 6),
                        Text(
                          'day streak',
                          style: TextStyle(
                            fontSize: 12.5,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Semantics(
                button: true,
                label: done
                    ? 'Mark ${habit.name} as not done'
                    : 'Mark ${habit.name} as done',
                child: GestureDetector(
                  key: ValueKey('check-${habit.id}'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () => store.toggle(habit.id),
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 220),
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: done ? habit.color : Colors.transparent,
                        border: Border.all(
                          color: done ? habit.color : scheme.outlineVariant,
                          width: 2,
                        ),
                      ),
                      child: done
                          ? const Icon(
                              Icons.check,
                              color: Colors.white,
                              size: 24,
                            )
                          : null,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

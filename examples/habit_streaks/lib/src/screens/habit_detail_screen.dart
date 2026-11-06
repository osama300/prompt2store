import 'package:flutter/material.dart';

import '../store.dart';
import '../widgets/heatmap.dart';
import '../widgets/streak_badge.dart';
import 'habit_form_screen.dart';

/// Streaks and a five-week calendar for one habit.
class HabitDetailScreen extends StatelessWidget {
  const HabitDetailScreen({
    super.key,
    required this.store,
    required this.habitId,
  });

  final HabitStore store;
  final String habitId;

  Future<void> _confirmDelete(BuildContext context, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete habit?'),
        content: Text('"$name" and its history will be removed.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await store.delete(habitId);
      if (context.mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final habit = store.byId(habitId);
        if (habit == null) return const Scaffold(body: SizedBox.shrink());
        final today = store.today;
        final done = habit.isDone(today);
        final total = habit.completions.length;
        return Scaffold(
          appBar: AppBar(
            actions: [
              IconButton(
                tooltip: 'Edit',
                icon: const Icon(Icons.edit_outlined),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => HabitFormScreen(store: store, habit: habit),
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Delete',
                icon: const Icon(Icons.delete_outline),
                onPressed: () => _confirmDelete(context, habit.name),
              ),
            ],
          ),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
              children: [
                Row(
                  children: [
                    Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        color: habit.color.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Icon(habit.icon, color: habit.color, size: 34),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            habit.name,
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                              height: 1.15,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '$total ${total == 1 ? 'day' : 'days'} completed',
                            style: TextStyle(color: scheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                Row(
                  children: [
                    Expanded(
                      child: _StatCard(
                        title: 'Current streak',
                        value: StreakBadge(
                          count: habit.currentStreakAt(today),
                          large: true,
                        ),
                        caption: 'days in a row',
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _StatCard(
                        title: 'Best streak',
                        value: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.emoji_events_outlined,
                              size: 28,
                              color: habit.color,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              '${habit.bestStreak}',
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                        caption: 'personal record',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(left: 4, bottom: 12),
                          child: Text(
                            'Last 5 weeks',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: scheme.onSurface,
                            ),
                          ),
                        ),
                        Heatmap(
                          completed: habit.completions,
                          today: today,
                          color: habit.color,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  key: const ValueKey('detail-toggle'),
                  style: FilledButton.styleFrom(
                    backgroundColor: done
                        ? scheme.surfaceContainerHighest
                        : habit.color,
                    foregroundColor: done ? scheme.onSurface : Colors.white,
                  ),
                  onPressed: () => store.toggle(habit.id),
                  icon: Icon(done ? Icons.undo : Icons.check),
                  label: Text(done ? 'Undo today' : 'Mark done for today'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.title,
    required this.value,
    required this.caption,
  });

  final String title;
  final Widget value;
  final String caption;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 10),
            value,
            const SizedBox(height: 4),
            Text(
              caption,
              style: TextStyle(fontSize: 12.5, color: scheme.outline),
            ),
          ],
        ),
      ),
    );
  }
}

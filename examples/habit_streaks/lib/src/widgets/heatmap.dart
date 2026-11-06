import 'package:flutter/material.dart';

import '../streaks.dart';

/// Calendar heatmap for the last [weeks] weeks (Monday first), ending with the current week.
class Heatmap extends StatelessWidget {
  const Heatmap({
    super.key,
    required this.completed,
    required this.today,
    required this.color,
    this.weeks = 5,
  });

  final Set<DateTime> completed;
  final DateTime today;
  final Color color;
  final int weeks;

  static const _labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final t = dateOnly(today);
    final mondayThisWeek = DateTime(t.year, t.month, t.day - (t.weekday - 1));
    final start = DateTime(
      mondayThisWeek.year,
      mondayThisWeek.month,
      mondayThisWeek.day - 7 * (weeks - 1),
    );

    Widget cell(DateTime day) {
      final future = day.isAfter(t);
      final done = completed.contains(day);
      final isToday = day == t;
      return Expanded(
        child: Padding(
          padding: const EdgeInsets.all(3),
          child: AspectRatio(
            aspectRatio: 1,
            child: Container(
              decoration: BoxDecoration(
                color: done
                    ? color
                    : future
                    ? Colors.transparent
                    : scheme.onSurface.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(10),
                border: isToday
                    ? Border.all(color: color, width: 2)
                    : future
                    ? Border.all(
                        color: scheme.outlineVariant.withValues(alpha: 0.6),
                      )
                    : null,
              ),
              alignment: Alignment.center,
              child: Text(
                '${day.day}',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: done
                      ? Colors.white
                      : future
                      ? scheme.outline.withValues(alpha: 0.6)
                      : scheme.onSurfaceVariant,
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Column(
      children: [
        Row(
          children: [
            for (final l in _labels)
              Expanded(
                child: Center(
                  child: Text(
                    l,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: scheme.outline,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 4),
        for (var w = 0; w < weeks; w++)
          Row(
            children: [
              for (var d = 0; d < 7; d++)
                cell(DateTime(start.year, start.month, start.day + w * 7 + d)),
            ],
          ),
      ],
    );
  }
}

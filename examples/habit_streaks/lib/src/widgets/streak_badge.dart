import 'package:flutter/material.dart';

import '../theme.dart';

/// Flame icon with a streak count. Greys out when the streak is zero.
class StreakBadge extends StatelessWidget {
  const StreakBadge({super.key, required this.count, this.large = false});

  final int count;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final active = count > 0;
    final color = active ? flameColor : scheme.outline;
    final size = large ? 28.0 : 18.0;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.local_fire_department, size: size, color: color),
        const SizedBox(width: 2),
        Text(
          '$count',
          style: TextStyle(
            fontSize: large ? 24 : 14,
            fontWeight: FontWeight.w700,
            color: active ? scheme.onSurface : scheme.outline,
          ),
        ),
      ],
    );
  }
}

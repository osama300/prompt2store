import 'package:flutter/material.dart';

import 'streaks.dart' as streaks;

/// Icons a habit can use, keyed by a stable string for persistence.
const Map<String, IconData> habitIcons = {
  'water': Icons.water_drop_outlined,
  'run': Icons.directions_run,
  'book': Icons.menu_book_outlined,
  'meditate': Icons.self_improvement,
  'sleep': Icons.bedtime_outlined,
  'fitness': Icons.fitness_center,
  'food': Icons.restaurant_outlined,
  'code': Icons.code,
  'music': Icons.music_note_outlined,
  'art': Icons.brush_outlined,
  'write': Icons.edit_note,
  'walk': Icons.directions_walk,
  'plant': Icons.eco_outlined,
  'savings': Icons.savings_outlined,
  'clean': Icons.cleaning_services_outlined,
  'heart': Icons.favorite_border,
};

/// Accent colors a habit can use.
const List<Color> habitColors = [
  Color(0xFF5B5BD6),
  Color(0xFF2E9BEA),
  Color(0xFF14A38B),
  Color(0xFF45B26B),
  Color(0xFFF2A33A),
  Color(0xFFEF6C4D),
  Color(0xFFE5508F),
  Color(0xFF9B5DE5),
];

IconData iconForKey(String key) =>
    habitIcons[key] ?? Icons.check_circle_outline;

class Habit {
  Habit({
    required this.id,
    required this.name,
    this.iconKey = 'heart',
    this.colorValue = 0xFF5B5BD6,
    Set<DateTime>? completions,
  }) : completions = (completions ?? <DateTime>{})
           .map(streaks.dateOnly)
           .toSet();

  final String id;
  final String name;
  final String iconKey;
  final int colorValue;

  /// Days (date-only) on which the habit was completed.
  final Set<DateTime> completions;

  Color get color => Color(colorValue);
  IconData get icon => iconForKey(iconKey);

  bool isDone(DateTime day) => completions.contains(streaks.dateOnly(day));
  int currentStreakAt(DateTime today) =>
      streaks.currentStreak(completions, today);
  int get bestStreak => streaks.bestStreak(completions);

  Habit copyWith({
    String? name,
    String? iconKey,
    int? colorValue,
    Set<DateTime>? completions,
  }) {
    return Habit(
      id: id,
      name: name ?? this.name,
      iconKey: iconKey ?? this.iconKey,
      colorValue: colorValue ?? this.colorValue,
      completions: completions ?? this.completions,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'icon': iconKey,
    'color': colorValue,
    'days': (completions.toList()..sort()).map(streaks.dayKey).toList(),
  };

  factory Habit.fromJson(Map<String, dynamic> json) {
    return Habit(
      id: json['id'] as String,
      name: json['name'] as String,
      iconKey: (json['icon'] as String?) ?? 'heart',
      colorValue: (json['color'] as int?) ?? 0xFF5B5BD6,
      completions: ((json['days'] as List<dynamic>?) ?? const [])
          .map((e) => streaks.parseDayKey(e as String))
          .toSet(),
    );
  }
}

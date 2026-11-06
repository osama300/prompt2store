import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';

/// Storage abstraction so screens and tests never touch the platform directly.
abstract class HabitRepository {
  Future<List<Habit>> load();
  Future<void> save(List<Habit> habits);
}

/// Keeps habits in memory. Used for tests and screenshots.
class InMemoryHabitRepository implements HabitRepository {
  InMemoryHabitRepository([List<Habit> initial = const []])
    : _habits = List.of(initial);

  List<Habit> _habits;

  @override
  Future<List<Habit>> load() async => List.of(_habits);

  @override
  Future<void> save(List<Habit> habits) async => _habits = List.of(habits);
}

/// Persists habits as a JSON string in shared_preferences.
class PrefsHabitRepository implements HabitRepository {
  static const _key = 'habits.v1';

  @override
  Future<List<Habit>> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return [];
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return list
          .map((e) => Habit.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }

  @override
  Future<void> save(List<Habit> habits) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _key,
      jsonEncode(habits.map((h) => h.toJson()).toList()),
    );
  }
}

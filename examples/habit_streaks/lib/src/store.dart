import 'package:flutter/foundation.dart';

import 'models.dart';
import 'repository.dart';
import 'streaks.dart';

/// App state: the list of habits plus operations that persist through a [HabitRepository].
class HabitStore extends ChangeNotifier {
  HabitStore(
    this._repository, {
    DateTime Function()? clock,
    List<Habit>? initial,
  }) : _clock = clock ?? DateTime.now,
       _habits = List.of(initial ?? const []);

  final HabitRepository _repository;
  final DateTime Function() _clock;
  List<Habit> _habits;

  List<Habit> get habits => List.unmodifiable(_habits);
  DateTime get today => dateOnly(_clock());

  Habit? byId(String id) {
    for (final h in _habits) {
      if (h.id == id) return h;
    }
    return null;
  }

  int get doneToday => _habits.where((h) => h.isDone(today)).length;
  double get progressToday => _habits.isEmpty ? 0 : doneToday / _habits.length;

  Future<void> load() async {
    _habits = await _repository.load();
    notifyListeners();
  }

  Future<void> _commit() async {
    notifyListeners();
    await _repository.save(_habits);
  }

  Future<void> add({
    required String name,
    required String iconKey,
    required int colorValue,
  }) {
    _habits.add(
      Habit(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        name: name.trim(),
        iconKey: iconKey,
        colorValue: colorValue,
      ),
    );
    return _commit();
  }

  Future<void> update(
    String id, {
    required String name,
    required String iconKey,
    required int colorValue,
  }) {
    final i = _habits.indexWhere((h) => h.id == id);
    if (i < 0) return Future.value();
    _habits[i] = _habits[i].copyWith(
      name: name.trim(),
      iconKey: iconKey,
      colorValue: colorValue,
    );
    return _commit();
  }

  Future<void> delete(String id) {
    _habits.removeWhere((h) => h.id == id);
    return _commit();
  }

  Future<void> toggle(String id, [DateTime? day]) {
    final i = _habits.indexWhere((h) => h.id == id);
    if (i < 0) return Future.value();
    final d = dateOnly(day ?? today);
    final next = Set<DateTime>.of(_habits[i].completions);
    if (!next.remove(d)) next.add(d);
    _habits[i] = _habits[i].copyWith(completions: next);
    return _commit();
  }
}

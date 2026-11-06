import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:habit_streaks/main.dart';
import 'package:habit_streaks/src/models.dart';
import 'package:habit_streaks/src/repository.dart';
import 'package:habit_streaks/src/store.dart';

void main() {
  final now = DateTime(2026, 11, 6, 10);

  HabitStore makeStore(List<Habit> habits) => HabitStore(
    InMemoryHabitRepository(habits),
    clock: () => now,
    initial: habits,
  );

  testWidgets('checking off a habit updates progress and streak', (
    tester,
  ) async {
    final habit = Habit(
      id: 'a',
      name: 'Stretch',
      iconKey: 'fitness',
      completions: {DateTime(2026, 11, 5), DateTime(2026, 11, 4)},
    );
    final store = makeStore([habit, Habit(id: 'b', name: 'Read')]);
    await tester.pumpWidget(MyApp(store: store));
    await tester.pumpAndSettle();

    expect(find.text('0/2'), findsOneWidget);
    expect(find.text('2'), findsOneWidget); // existing streak

    await tester.tap(find.byKey(const ValueKey('check-a')));
    await tester.pumpAndSettle();

    expect(find.text('1/2'), findsOneWidget);
    expect(find.text('3'), findsOneWidget); // streak extended
    expect(store.byId('a')!.isDone(DateTime(2026, 11, 6)), isTrue);

    await tester.tap(find.byKey(const ValueKey('check-a')));
    await tester.pumpAndSettle();
    expect(find.text('0/2'), findsOneWidget);
  });

  testWidgets('adding a habit from the form', (tester) async {
    final store = makeStore([]);
    await tester.pumpWidget(MyApp(store: store));
    await tester.pumpAndSettle();
    expect(find.text('No habits yet'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('add-habit')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Journal');
    await tester.tap(find.text('Create habit'));
    await tester.pumpAndSettle();

    expect(store.habits.single.name, 'Journal');
    expect(find.text('Journal'), findsOneWidget);
  });

  test('habit JSON round trip', () {
    final h = Habit(
      id: 'x',
      name: 'Run',
      iconKey: 'run',
      colorValue: 0xFF123456,
      completions: {DateTime(2026, 1, 2)},
    );
    final back = Habit.fromJson(h.toJson());
    expect(back.name, 'Run');
    expect(back.completions, {DateTime(2026, 1, 2)});
    expect(back.colorValue, 0xFF123456);
  });
}

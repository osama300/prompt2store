import 'package:flutter_test/flutter_test.dart';
import 'package:habit_streaks/src/streaks.dart';

void main() {
  final today = DateTime(2026, 11, 6);
  DateTime ago(int n) => DateTime(2026, 11, 6 - n);

  group('currentStreak', () {
    test('empty is zero', () => expect(currentStreak(<DateTime>{}, today), 0));
    test('today only is one', () => expect(currentStreak({today}, today), 1));
    test('consecutive days ending today', () {
      expect(currentStreak({today, ago(1), ago(2), ago(3)}, today), 4);
    });
    test('ending yesterday keeps the streak alive', () {
      expect(currentStreak({ago(1), ago(2), ago(3)}, today), 3);
    });
    test('gap yesterday resets to zero when today is not done', () {
      expect(currentStreak({ago(2), ago(3), ago(4)}, today), 0);
    });
    test('gap stops the count', () {
      expect(currentStreak({today, ago(1), ago(3), ago(4)}, today), 2);
    });
    test('ignores time of day', () {
      expect(
        currentStreak({
          DateTime(2026, 11, 6, 23, 59),
          DateTime(2026, 11, 5, 1),
        }, DateTime(2026, 11, 6, 8)),
        2,
      );
    });
    test('works across month and year boundaries', () {
      final t = DateTime(2026, 1, 1);
      expect(
        currentStreak({t, DateTime(2025, 12, 31), DateTime(2025, 12, 30)}, t),
        3,
      );
    });
  });

  group('bestStreak', () {
    test('empty is zero', () => expect(bestStreak(<DateTime>{}), 0));
    test('single day is one', () => expect(bestStreak({today}), 1));
    test('picks the longest run', () {
      expect(bestStreak({ago(10), ago(9), ago(8), ago(7), ago(3), ago(2)}), 4);
    });
    test('unsorted input is fine', () {
      expect(bestStreak([ago(1), today, ago(5), ago(2)]), 3);
    });
    test('duplicates are ignored', () {
      expect(bestStreak([today, DateTime(2026, 11, 6, 12)]), 1);
    });
  });

  group('day keys', () {
    test('round trip', () {
      expect(dayKey(DateTime(2026, 3, 4)), '2026-03-04');
      expect(parseDayKey('2026-03-04'), DateTime(2026, 3, 4));
    });
  });
}

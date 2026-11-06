import 'package:flutter/material.dart';

import 'repository.dart';
import 'screens/habit_form_screen.dart';
import 'screens/stats_screen.dart';
import 'screens/today_screen.dart';
import 'store.dart';
import 'theme.dart';

/// Root widget. Pass a [store] to inject sample data (tests, screenshots);
/// otherwise habits are loaded from shared_preferences.
class MyApp extends StatefulWidget {
  const MyApp({super.key, this.store, this.initialTab = 0});

  final HabitStore? store;
  final int initialTab;

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  late final HabitStore _store =
      widget.store ?? HabitStore(PrefsHabitRepository());
  late bool _ready = widget.store != null;

  @override
  void initState() {
    super.initState();
    if (!_ready) {
      _store.load().whenComplete(() {
        if (mounted) setState(() => _ready = true);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Habit Streaks',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: _ready
          ? HomeShell(store: _store, initialTab: widget.initialTab)
          : const Scaffold(body: Center(child: CircularProgressIndicator())),
    );
  }
}

/// Bottom navigation between Today and Stats, with a FAB to add habits.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.store, this.initialTab = 0});

  final HabitStore store;
  final int initialTab;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  late int _index = widget.initialTab;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: [
          TodayScreen(store: widget.store),
          StatsScreen(store: widget.store),
        ],
      ),
      floatingActionButton: _index == 0
          ? FloatingActionButton.extended(
              key: const ValueKey('add-habit'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => HabitFormScreen(store: widget.store),
                ),
              ),
              icon: const Icon(Icons.add),
              label: const Text('New habit'),
            )
          : null,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.today_outlined),
            selectedIcon: Icon(Icons.today),
            label: 'Today',
          ),
          NavigationDestination(
            icon: Icon(Icons.bar_chart_outlined),
            selectedIcon: Icon(Icons.bar_chart),
            label: 'Stats',
          ),
        ],
      ),
    );
  }
}

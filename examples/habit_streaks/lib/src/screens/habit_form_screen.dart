import 'package:flutter/material.dart';

import '../models.dart';
import '../store.dart';

/// Add a new habit, or edit an existing one when [habit] is provided.
class HabitFormScreen extends StatefulWidget {
  const HabitFormScreen({
    super.key,
    required this.store,
    this.habit,
    this.initialName = '',
  });

  final HabitStore store;
  final Habit? habit;
  final String initialName;

  @override
  State<HabitFormScreen> createState() => _HabitFormScreenState();
}

class _HabitFormScreenState extends State<HabitFormScreen> {
  late final TextEditingController _name = TextEditingController(
    text: widget.habit?.name ?? widget.initialName,
  );
  late String _iconKey = widget.habit?.iconKey ?? 'water';
  late int _colorValue =
      widget.habit?.colorValue ?? habitColors.first.toARGB32();
  String? _error;

  bool get _editing => widget.habit != null;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Give your habit a name');
      return;
    }
    if (_editing) {
      await widget.store.update(
        widget.habit!.id,
        name: name,
        iconKey: _iconKey,
        colorValue: _colorValue,
      );
    } else {
      await widget.store.add(
        name: name,
        iconKey: _iconKey,
        colorValue: _colorValue,
      );
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = Color(_colorValue);

    Widget label(String text) => Padding(
      padding: const EdgeInsets.only(bottom: 10, top: 24),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 13,
          letterSpacing: 0.6,
          fontWeight: FontWeight.w700,
          color: scheme.onSurfaceVariant,
        ),
      ),
    );

    return Scaffold(
      appBar: AppBar(title: Text(_editing ? 'Edit habit' : 'New habit')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Row(
                  children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Icon(iconForKey(_iconKey), color: color, size: 30),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: ValueListenableBuilder<TextEditingValue>(
                        valueListenable: _name,
                        builder: (_, v, _) => Text(
                          v.text.trim().isEmpty ? 'Your habit' : v.text.trim(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: v.text.trim().isEmpty
                                ? scheme.outline
                                : scheme.onSurface,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            label('NAME'),
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.sentences,
              textInputAction: TextInputAction.done,
              decoration: InputDecoration(
                hintText: 'e.g. Read 20 pages',
                errorText: _error,
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
              onSubmitted: (_) => _save(),
            ),
            label('ICON'),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final e in habitIcons.entries)
                  _Choice(
                    key: ValueKey('icon-${e.key}'),
                    selected: e.key == _iconKey,
                    color: color,
                    onTap: () => setState(() => _iconKey = e.key),
                    child: Icon(
                      e.value,
                      color: e.key == _iconKey
                          ? color
                          : scheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
            label('COLOR'),
            Wrap(
              spacing: 14,
              runSpacing: 14,
              children: [
                for (final c in habitColors)
                  GestureDetector(
                    key: ValueKey('color-${c.toARGB32()}'),
                    onTap: () => setState(() => _colorValue = c.toARGB32()),
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: c,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: c.toARGB32() == _colorValue
                              ? scheme.onSurface
                              : Colors.transparent,
                          width: 3,
                        ),
                      ),
                      child: c.toARGB32() == _colorValue
                          ? const Icon(
                              Icons.check,
                              color: Colors.white,
                              size: 20,
                            )
                          : null,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 32),
            FilledButton(
              onPressed: _save,
              child: Text(_editing ? 'Save changes' : 'Create habit'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({
    super.key,
    required this.selected,
    required this.color,
    required this.onTap,
    required this.child,
  });

  final bool selected;
  final Color color;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 52,
        height: 52,
        decoration: BoxDecoration(
          color: selected
              ? color.withValues(alpha: 0.16)
              : scheme.surfaceContainerHighest.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? color : Colors.transparent,
            width: 2,
          ),
        ),
        child: child,
      ),
    );
  }
}

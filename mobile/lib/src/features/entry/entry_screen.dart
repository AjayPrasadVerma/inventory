import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_exception.dart';
import '../../format.dart' as fmt;
import '../../models/karigar.dart';
import '../../theme.dart';
import 'entry_controller.dart';
import 'widgets/search_field.dart';

/// Recording material going out to a karigar, or goods coming back in.
///
/// The website does this as a spreadsheet: a grid of Item / Size / Design /
/// Quantity rows, which is right on a desktop and wrong on a phone — four
/// fields per line, thirty-five times, on a keyboard.
///
/// The shape of the real data is what makes a faster form possible. A big entry
/// here is **one item, in one size, in many colours**: thirty-five lines of Silk
/// in meters that differ only by design and quantity. So the karigar, the item
/// and the size are searched for once and then stay put, collapsed to a line of
/// text, and every line after that is a colour and a number.
///
/// Nothing here assumes a short list. The karigar and item fields are searches,
/// because the shop's catalogue runs to thousands of names; only the sizes and
/// colours of the one item already picked are small enough to show as chips.
class EntryScreen extends ConsumerStatefulWidget {
  const EntryScreen({super.key, required this.direction});

  final EntryDirection direction;

  @override
  ConsumerState<EntryScreen> createState() => _EntryScreenState();
}

class _EntryScreenState extends ConsumerState<EntryScreen> {
  final _design = TextEditingController();
  final _qty = TextEditingController();
  final _designFocus = FocusNode();
  final _qtyFocus = FocusNode();
  final _remark = TextEditingController();

  /// The repeating part of the form — design, colours, quantity, Add. Keyed so
  /// it can be pulled to the top of the screen when the keyboard opens.
  final _repeatKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    // A phone keyboard takes a third of the screen. Without this the colours and
    // the Add button sit underneath it, which breaks the one thing this form is
    // for: adding line after line without looking away.
    _designFocus.addListener(_keepRepeatBlockVisible);
    _qtyFocus.addListener(_keepRepeatBlockVisible);
  }

  void _keepRepeatBlockVisible() {
    if (!_designFocus.hasFocus && !_qtyFocus.hasFocus) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _repeatKey.currentContext;
      if (target == null || !mounted) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  void dispose() {
    _design.dispose();
    _qty.dispose();
    _designFocus.dispose();
    _qtyFocus.dispose();
    _remark.dispose();
    super.dispose();
  }

  EntryDraftController get _draft =>
      ref.read(entryDraftProvider(widget.direction).notifier);

  void _add() {
    final qty = double.tryParse(_qty.text.trim());
    if (qty == null || qty <= 0) {
      _toast('Enter a quantity above 0');
      _qtyFocus.requestFocus();
      return;
    }
    _draft.addLine(design: _design.text, qty: qty);
    setState(() {
      _qty.clear();
      // The colour changes every line; the item and size do not. Clearing only
      // this leaves the next line one tap away.
      _design.clear();
    });
    _qtyFocus.requestFocus();
  }

  Future<void> _save() async {
    try {
      await _draft.save();
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      _toast(e.message);
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  /// Karigars come down once and are filtered here; the item catalogue is far
  /// too large for that and is searched on the server.
  Future<List<String>> _searchKarigars(String q) async {
    final all = await ref.read(karigarOptionsProvider.future);
    final term = q.toLowerCase();
    return all
        .where(
          (k) =>
              term.isEmpty ||
              k.name.toLowerCase().contains(term) ||
              (k.phone ?? '').contains(term),
        )
        .map((k) => k.name)
        .toList(growable: false);
  }

  Future<List<String>> _searchItems(String q) async {
    final found = await ref
        .read(entryCatalogueProvider)
        .searchItems(widget.direction, q);
    _lastItemSearch = found;
    return found.map((s) => s.name).toList(growable: false);
  }

  /// The last search's full rows, so picking a name keeps the sizes and colours
  /// that came down with it instead of asking for them again.
  List<ItemSuggestion> _lastItemSearch = const [];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final direction = widget.direction;
    final draft = ref.watch(entryDraftProvider(direction));
    final tone = direction == EntryDirection.materialIn
        ? scheme.inColor
        : scheme.outColor;
    // While the keyboard is up the save bar is only taking room from the rows
    // being typed into; the button is one tap away again the moment it closes.
    final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(direction.title),
        actions: [
          if (draft.lines.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: AppTheme.gap * 2),
              child: Center(
                child: Text(
                  '${draft.lines.length} ${draft.lines.length == 1 ? 'line' : 'lines'}',
                  style: theme.textTheme.labelLarge?.copyWith(color: tone),
                ),
              ),
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: AppTheme.gap * 2),
              children: [
                _Field(
                  label: 'Karigar',
                  child: SearchField(
                    label: 'karigar',
                    value: draft.karigarName,
                    hint: 'Search by name or phone',
                    tone: scheme.primary,
                    search: _searchKarigars,
                    // A karigar has to exist as an account before goods can be
                    // booked against them, so this is the one field that cannot
                    // create what it does not find.
                    onPickedNew: null,
                    emptyPrompt: 'Start typing a name',
                    onPicked: (name) async {
                      final all = await ref.read(karigarOptionsProvider.future);
                      final k = all.where((x) => x.name == name);
                      if (k.isNotEmpty) _draft.pickKarigar(k.first);
                    },
                  ),
                ),

                // Chosen once, then left alone.
                _Field(
                  label: direction == EntryDirection.materialOut
                      ? 'Material'
                      : 'Item',
                  child: SearchField(
                    label: direction == EntryDirection.materialOut
                        ? 'material'
                        : 'item',
                    value: draft.item.isEmpty ? null : draft.item,
                    hint: direction == EntryDirection.materialOut
                        ? 'Search material — Silk, Velvet, Board…'
                        : 'Search item — Ring Box, Tray…',
                    tone: tone,
                    search: _searchItems,
                    onPicked: (name) {
                      final s = _lastItemSearch.where((x) => x.name == name);
                      if (s.isEmpty) {
                        _draft.pickNewItem(name);
                      } else {
                        _draft.pickItem(s.first);
                      }
                      setState(_design.clear);
                    },
                    onPickedNew: (name) {
                      _draft.pickNewItem(name);
                      setState(_design.clear);
                    },
                  ),
                ),

                if (draft.item.isNotEmpty)
                  _Field(
                    label: 'Size',
                    child: _Options(
                      options: draft.itemSizes,
                      selected: draft.size,
                      tone: tone,
                      emptyNote:
                          'No size recorded for this item — add one, or leave '
                          'it blank.',
                      newLabel: 'New size',
                      onNew: () async {
                        final v = await _askFor('Size');
                        if (v != null) _draft.pickSize(v);
                      },
                      onPicked: (v) =>
                          _draft.pickSize(v == draft.size ? null : v),
                    ),
                  ),

                Divider(height: AppTheme.gap * 3, color: scheme.outlineVariant),

                // The part that repeats, kept together so it can be scrolled
                // clear of the keyboard as one block.
                Column(
                  key: _repeatKey,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _Field(
                      label: 'Design',
                      child: _DesignPicker(
                        controller: _design,
                        focusNode: _designFocus,
                        known: draft.itemDesigns,
                        tone: tone,
                        enabled: draft.canAddLine,
                        onChanged: () => setState(() {}),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                        AppTheme.gap * 2,
                        AppTheme.gap * 1.5,
                        AppTheme.gap * 2,
                        0,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _qty,
                              focusNode: _qtyFocus,
                              enabled: draft.canAddLine,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                    decimal: true,
                                  ),
                              textInputAction: TextInputAction.done,
                              onSubmitted: (_) => _add(),
                              inputFormatters: [
                                FilteringTextInputFormatter.allow(
                                  RegExp(r'[0-9.]'),
                                ),
                              ],
                              decoration: InputDecoration(
                                labelText: 'Quantity',
                                hintText: '0',
                                suffixText: draft.size,
                              ),
                            ),
                          ),
                          const SizedBox(width: AppTheme.gap * 1.5),
                          SizedBox(
                            height: 56,
                            child: FilledButton.icon(
                              onPressed: draft.canAddLine ? _add : null,
                              icon: const Icon(Icons.add_rounded),
                              label: const Text('Add'),
                              style: FilledButton.styleFrom(
                                backgroundColor: tone,
                                foregroundColor: _onTone(tone),
                                minimumSize: const Size(108, 56),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                if (draft.lines.isNotEmpty) ...[
                  const SizedBox(height: AppTheme.gap * 2.5),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.gap * 2,
                    ),
                    child: _AddedLines(
                      lines: draft.lines,
                      total: draft.total,
                      tone: tone,
                      onRemove: _draft.removeLine,
                    ),
                  ),
                ],

                const SizedBox(height: AppTheme.gap * 2.5),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.gap * 2,
                  ),
                  child: TextField(
                    controller: _remark,
                    onChanged: _draft.setRemark,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Remark',
                      hintText: 'What is this for…',
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (!keyboardUp)
            _SaveBar(
              enabled: draft.canSave,
              saving: draft.saving,
              label: direction == EntryDirection.materialOut
                  ? 'Save out'
                  : 'Save in',
              total: draft.total,
              tone: tone,
              onSave: _save,
            ),
        ],
      ),
    );
  }

  /// A small prompt for a size the catalogue does not have yet. The entry route
  /// creates an unknown one rather than refusing it — the same as the website.
  Future<String?> _askFor(String label) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('New $label'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          decoration: InputDecoration(labelText: label),
          onSubmitted: (v) => Navigator.of(dialogContext).pop(v.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('Use'),
          ),
        ],
      ),
    );
    controller.dispose();
    return (value == null || value.isEmpty) ? null : value;
  }
}

Color _onTone(Color tone) =>
    ThemeData.estimateBrightnessForColor(tone) == Brightness.dark
    ? Colors.white
    : const Color(0xFF1A1D23);

/// A labelled row. The label sits above rather than beside its control, so the
/// field gets the full width of the screen.
class _Field extends StatelessWidget {
  const _Field({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.gap * 2,
            AppTheme.gap * 1.5,
            AppTheme.gap * 2,
            AppTheme.gap,
          ),
          child: Text(
            label.toUpperCase(),
            style: theme.textTheme.labelSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        child,
      ],
    );
  }
}

/// The handful of values that belong to the one item already picked.
///
/// Chips are right here and nowhere else on this form: an item comes in one or
/// two sizes, so the whole choice is visible and costs a single tap.
class _Options extends StatelessWidget {
  const _Options({
    required this.options,
    required this.selected,
    required this.tone,
    required this.onPicked,
    required this.onNew,
    required this.newLabel,
    required this.emptyNote,
  });

  final List<String> options;
  final String? selected;
  final Color tone;
  final ValueChanged<String> onPicked;
  final VoidCallback onNew;
  final String newLabel;
  final String emptyNote;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    // Whatever is selected is always shown, even when it was typed in and is not
    // in the catalogue at all.
    final all = <String>[
      if (selected != null && !options.contains(selected)) selected!,
      ...options,
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (all.isEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.gap * 2,
              0,
              AppTheme.gap * 2,
              AppTheme.gap,
            ),
            child: Text(
              emptyNote,
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ),
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.gap * 2),
            children: [
              for (final o in all) ...[
                _Chip(
                  label: o,
                  selected: o == selected,
                  tone: tone,
                  onTap: () => onPicked(o),
                ),
                const SizedBox(width: AppTheme.gap * 0.75),
              ],
              _Chip(
                label: newLabel,
                selected: false,
                tone: tone,
                icon: Icons.add_rounded,
                onTap: onNew,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The design: a box to type in, and the colours this item has already been
/// recorded in underneath it.
///
/// Both halves are needed. A bolt of silk runs to dozens of colours, too many to
/// hunt through by eye, so typing two letters narrows them; and a colour the shop
/// has never used before has to be recordable, which chips alone can never do.
class _DesignPicker extends StatelessWidget {
  const _DesignPicker({
    required this.controller,
    required this.focusNode,
    required this.known,
    required this.tone,
    required this.enabled,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final List<String> known;
  final Color tone;
  final bool enabled;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final text = controller.text.trim();
    final lower = text.toLowerCase();

    // An exact match is a choice, not a search: keep the whole list on screen so
    // the next colour is still one tap away.
    final exact = known.any((d) => d.toLowerCase() == lower);
    final shown = (text.isEmpty || exact)
        ? known
        : known.where((d) => d.toLowerCase().contains(lower)).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.gap * 2),
          child: TextField(
            controller: controller,
            focusNode: focusNode,
            enabled: enabled,
            textCapitalization: TextCapitalization.words,
            onChanged: (_) => onChanged(),
            decoration: InputDecoration(
              hintText: enabled
                  ? 'Type a colour, or tap one below'
                  : 'Choose an item first',
              prefixIcon: const Icon(Icons.palette_outlined),
              suffixIcon: text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close_rounded),
                      tooltip: 'Clear',
                      onPressed: () {
                        controller.clear();
                        onChanged();
                      },
                    ),
            ),
          ),
        ),
        if (!enabled)
          const SizedBox.shrink()
        else if (known.isEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppTheme.gap * 2,
              AppTheme.gap,
              AppTheme.gap * 2,
              0,
            ),
            child: Text(
              'No colours recorded for this item yet — type one, or leave it '
              'blank.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          )
        else ...[
          const SizedBox(height: AppTheme.gap),
          SizedBox(
            height: 48,
            child: shown.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.gap * 2,
                    ),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '"$text" will be recorded as a new colour.',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  )
                : ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.gap * 2,
                    ),
                    children: [
                      for (final d in shown) ...[
                        _Chip(
                          label: d,
                          selected: d.toLowerCase() == lower,
                          tone: tone,
                          onTap: () {
                            controller.text = d.toLowerCase() == lower ? '' : d;
                            onChanged();
                          },
                        ),
                        const SizedBox(width: AppTheme.gap * 0.75),
                      ],
                    ],
                  ),
          ),
        ],
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.selected,
    required this.tone,
    required this.onTap,
    this.icon,
  });

  final String label;
  final bool selected;
  final Color tone;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final foreground = selected ? _onTone(tone) : scheme.onSurface;

    return Material(
      color: selected ? tone : scheme.surface,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          // 44 high: these are tapped over and over, and a chip sized to its text
          // is a target you miss when you are holding something else.
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.gap * 2),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: selected ? tone : scheme.outlineVariant),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: selected ? foreground : tone),
                const SizedBox(width: AppTheme.gap * 0.5),
              ],
              Text(
                label,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: foreground,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// What has been added so far, newest first — the last line typed is the one
/// most likely to be wrong, so it should not be at the bottom of thirty-five.
class _AddedLines extends StatelessWidget {
  const _AddedLines({
    required this.lines,
    required this.total,
    required this.tone,
    required this.onRemove,
  });

  final List<DraftLine> lines;
  final String total;
  final Color tone;
  final void Function(int index) onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Text(
              'ADDED',
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                letterSpacing: 1.2,
                fontWeight: FontWeight.w700,
              ),
            ),
            const Spacer(),
            Text(
              total,
              style: theme.textTheme.labelLarge?.copyWith(
                color: tone,
                fontWeight: FontWeight.w700,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.gap),
        Container(
          decoration: BoxDecoration(
            color: scheme.surface,
            borderRadius: BorderRadius.circular(AppTheme.gap * 1.75),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var i = lines.length - 1; i >= 0; i--) ...[
                if (i < lines.length - 1)
                  Divider(height: 1, color: scheme.outlineVariant),
                ListTile(
                  dense: true,
                  title: Text(
                    lines[i].design ?? lines[i].name,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    lines[i].design == null
                        ? lines[i].subtitle
                        : '${lines[i].name}${lines[i].size == null ? '' : ' · ${lines[i].size}'}',
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        fmt.qty(lines[i].qty),
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: tone,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                      IconButton(
                        onPressed: () => onRemove(i),
                        icon: const Icon(Icons.close_rounded),
                        iconSize: 18,
                        tooltip: 'Remove',
                        color: scheme.onSurfaceVariant,
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SaveBar extends StatelessWidget {
  const _SaveBar({
    required this.enabled,
    required this.saving,
    required this.label,
    required this.total,
    required this.tone,
    required this.onSave,
  });

  final bool enabled;
  final bool saving;
  final String label;
  final String total;
  final Color tone;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppTheme.gap * 2,
          AppTheme.gap,
          AppTheme.gap * 2,
          AppTheme.gap,
        ),
        child: FilledButton(
          onPressed: enabled ? onSave : null,
          style: FilledButton.styleFrom(
            backgroundColor: tone,
            foregroundColor: _onTone(tone),
            disabledBackgroundColor: scheme.outlineVariant,
          ),
          child: saving
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(total.isEmpty ? label : '$label  ·  $total'),
        ),
      ),
    );
  }
}

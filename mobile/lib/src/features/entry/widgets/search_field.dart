import 'dart:async';

import 'package:flutter/material.dart';

import '../../../theme.dart';

/// One "chosen once" field: the karigar, the item.
///
/// Both lists are too long to show — two hundred karigars, thousands of items —
/// so the field is a box you type into and the matches appear under it, capped
/// at what fits on a phone without scrolling. That is the same shape the website
/// uses, and it behaves identically whether the catalogue holds four names or
/// four thousand.
///
/// Once something is chosen the field collapses to the name, because it is
/// chosen once and then read thirty-five times.
class SearchField extends StatefulWidget {
  const SearchField({
    super.key,
    required this.label,
    required this.value,
    required this.hint,
    required this.tone,
    required this.search,
    required this.onPicked,
    this.onPickedNew,
    this.newHint = 'will be created on save',
    this.emptyPrompt = 'Type to search',
  });

  final String label;
  final String? value;
  final String hint;
  final Color tone;

  /// Runs on every settled keystroke. Local lists filter in place; the item
  /// catalogue goes to the server, which is why this is async.
  final Future<List<String>> Function(String query) search;

  final ValueChanged<String> onPicked;

  /// Free text. Null means the value has to come from the list — a karigar has
  /// to exist as an account before goods can be booked against them.
  final ValueChanged<String>? onPickedNew;

  final String newHint;
  final String emptyPrompt;

  @override
  State<SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<SearchField> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  Timer? _debounce;
  bool _open = false;
  bool _loading = false;
  List<String> _matches = const [];

  /// Guards against a slow response for an old query landing after a fast one
  /// for a newer query and overwriting it.
  int _generation = 0;

  static const _shown = 6;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _openSearch() {
    setState(() {
      _open = true;
      _controller.clear();
      _matches = const [];
    });
    _focus.requestFocus();
    _run('');
  }

  void _close() {
    _debounce?.cancel();
    _focus.unfocus();
    setState(() => _open = false);
  }

  void _onTyped(String value) {
    _debounce?.cancel();
    // Long enough that a word typed at speed is one request, short enough that
    // the list is there by the time you have stopped.
    _debounce = Timer(const Duration(milliseconds: 220), () => _run(value));
  }

  Future<void> _run(String query) async {
    final generation = ++_generation;
    setState(() => _loading = true);
    try {
      final found = await widget.search(query.trim());
      if (!mounted || generation != _generation) return;
      setState(() {
        _matches = found;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _matches = const [];
        _loading = false;
      });
    }
  }

  void _accept(String value) {
    widget.onPicked(value);
    _close();
  }

  void _acceptNew() {
    final typed = _controller.text.trim();
    if (typed.isEmpty) return;
    widget.onPickedNew!(typed);
    _close();
  }

  @override
  Widget build(BuildContext context) {
    if (!_open) return _closed(context);
    return _searching(context);
  }

  /// The resting state: the name, and a way back to the search.
  Widget _closed(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final chosen = widget.value != null && widget.value!.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.gap * 2),
      child: Material(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
        child: InkWell(
          onTap: _openSearch,
          borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
          child: Container(
            constraints: const BoxConstraints(minHeight: 56),
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.gap * 2,
              vertical: AppTheme.gap,
            ),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
              border: Border.all(
                color: chosen
                    ? widget.tone.withValues(alpha: 0.55)
                    : scheme.outlineVariant,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  chosen ? Icons.check_circle_rounded : Icons.search_rounded,
                  size: 20,
                  color: chosen ? widget.tone : scheme.onSurfaceVariant,
                ),
                const SizedBox(width: AppTheme.gap * 1.5),
                Expanded(
                  child: Text(
                    chosen ? widget.value! : widget.hint,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontWeight: chosen ? FontWeight.w600 : FontWeight.w400,
                      color: chosen
                          ? scheme.onSurface
                          : scheme.onSurfaceVariant,
                    ),
                  ),
                ),
                if (chosen)
                  Text(
                    'Change',
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: widget.tone,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _searching(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final typed = _controller.text.trim();
    final shown = _matches.take(_shown).toList();
    // Offering to create what is already there would be two rows meaning the
    // same thing.
    final canCreate =
        widget.onPickedNew != null &&
        typed.isNotEmpty &&
        !_matches.any((m) => m.toLowerCase() == typed.toLowerCase());

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.gap * 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _controller,
            focusNode: _focus,
            textCapitalization: TextCapitalization.words,
            textInputAction: TextInputAction.search,
            onChanged: (v) => setState(() => _onTyped(v)),
            onSubmitted: (_) {
              if (shown.isNotEmpty) {
                _accept(shown.first);
              } else if (canCreate) {
                _acceptNew();
              }
            },
            decoration: InputDecoration(
              hintText: 'Search ${widget.label.toLowerCase()}…',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: IconButton(
                icon: const Icon(Icons.close_rounded),
                tooltip: 'Cancel',
                onPressed: _close,
              ),
            ),
          ),
          const SizedBox(height: AppTheme.gap),
          Container(
            decoration: BoxDecoration(
              color: scheme.surface,
              borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
              border: Border.all(color: scheme.outlineVariant),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_loading)
                  const Padding(
                    padding: EdgeInsets.all(AppTheme.gap * 2),
                    child: SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                else if (shown.isEmpty && !canCreate)
                  Padding(
                    padding: const EdgeInsets.all(AppTheme.gap * 2),
                    child: Text(
                      typed.isEmpty
                          ? widget.emptyPrompt
                          : 'Nothing matches "$typed".',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                for (final m in shown)
                  ListTile(
                    dense: true,
                    title: _Highlighted(
                      text: m,
                      term: typed,
                      tone: widget.tone,
                    ),
                    trailing: m == widget.value
                        ? Icon(Icons.check_rounded, color: widget.tone)
                        : null,
                    onTap: () => _accept(m),
                  ),
                if (canCreate)
                  ListTile(
                    dense: true,
                    leading: Icon(Icons.add_rounded, color: widget.tone),
                    title: Text('Use "$typed"'),
                    subtitle: Text('New — ${widget.newHint}'),
                    onTap: _acceptNew,
                  ),
                if (_matches.length > shown.length)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppTheme.gap * 2,
                      0,
                      AppTheme.gap * 2,
                      AppTheme.gap * 1.5,
                    ),
                    child: Text(
                      '${_matches.length - shown.length} more — keep typing to '
                      'narrow it down.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The typed part of a match, in the field's own colour. With six near-identical
/// names on screen it is what tells you which one you are looking at.
class _Highlighted extends StatelessWidget {
  const _Highlighted({
    required this.text,
    required this.term,
    required this.tone,
  });

  final String text;
  final String term;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyLarge;
    final at = term.isEmpty
        ? -1
        : text.toLowerCase().indexOf(term.toLowerCase());
    if (at < 0) return Text(text, style: style);

    return Text.rich(
      TextSpan(
        children: [
          TextSpan(text: text.substring(0, at)),
          TextSpan(
            text: text.substring(at, at + term.length),
            style: TextStyle(color: tone, fontWeight: FontWeight.w800),
          ),
          TextSpan(text: text.substring(at + term.length)),
        ],
      ),
      style: style,
    );
  }
}

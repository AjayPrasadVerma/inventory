import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_exception.dart';
import '../../format.dart' as fmt;
import '../../models/party.dart';
import '../../theme.dart';
import '../../widgets/search_field.dart';
import 'pay_controller.dart';

/// Recording money paid out, from the dashboard.
///
/// The khata pages each have a pay form of their own, but those are for paying
/// the party whose page you are on. This one answers a different question: the
/// owner wants to record a payment and has not said to whom — so who is a field
/// in the form rather than a dialog in front of it, exactly as on the website.
///
/// Karigars and vendors are searched together and shown as one list. The owner
/// is thinking of a person, not of which of two menus that person lives under;
/// the row carries the type so the two Rameshes stay apart, and so the route
/// knows which account to move.
class PayScreen extends ConsumerStatefulWidget {
  const PayScreen({super.key});

  @override
  ConsumerState<PayScreen> createState() => _PayScreenState();
}

class _PayScreenState extends ConsumerState<PayScreen> {
  final _amount = TextEditingController();
  final _amountFocus = FocusNode();
  final _note = TextEditingController();

  @override
  void dispose() {
    _amount.dispose();
    _amountFocus.dispose();
    _note.dispose();
    super.dispose();
  }

  PayDraftController get _draft => ref.read(payDraftProvider.notifier);

  Future<void> _save() async {
    try {
      await _draft.save();
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final draft = ref.watch(payDraftProvider);
    final tone = scheme.payColor;
    final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;

    return Scaffold(
      appBar: AppBar(title: const Text('Record a payment')),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: AppTheme.gap * 2),
              children: [
                _Label('Paying'),
                SearchField<Party>(
                  label: 'karigar or vendor',
                  value: draft.party?.name,
                  hint: 'Search a karigar or vendor',
                  tone: tone,
                  search: ref.read(partyDirectoryProvider).search,
                  labelOf: (p) => p.name,
                  subtitleOf: (p) => p.subtitle,
                  // Money can only be paid to an account that already exists;
                  // there is nothing sensible to create from this screen.
                  onPickedNew: null,
                  emptyPrompt: 'Start typing a name',
                  onPicked: (p) {
                    _draft.pickParty(p);
                    // The amount is always the next thing typed, and picking a
                    // name closes the keyboard on its way out. Without this the
                    // first digits go nowhere.
                    _amountFocus.requestFocus();
                  },
                ),

                _Label('Amount'),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.gap * 2,
                  ),
                  child: TextField(
                    controller: _amount,
                    focusNode: _amountFocus,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    textInputAction: TextInputAction.done,
                    onChanged: (v) =>
                        _draft.setAmount(double.tryParse(v.trim()) ?? 0),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                    ],
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                    // A leading widget rather than `prefixText`, which Material
                    // only paints once the field has focus — leaving the field
                    // reading "4500" with no sign of what the number is.
                    decoration: InputDecoration(
                      hintText: '0',
                      prefixIcon: Padding(
                        padding: const EdgeInsets.only(
                          left: AppTheme.gap * 2,
                          right: AppTheme.gap,
                        ),
                        child: Text(
                          '₹',
                          style: theme.textTheme.headlineSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      prefixIconConstraints: const BoxConstraints(minWidth: 0),
                    ),
                  ),
                ),

                _Label('Mode'),
                SizedBox(
                  height: 48,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.gap * 2,
                    ),
                    children: [
                      for (final m in paymentMethods) ...[
                        _Chip(
                          label: m,
                          selected: m == draft.method,
                          tone: tone,
                          onTap: () => _draft.setMethod(m),
                        ),
                        const SizedBox(width: AppTheme.gap * 0.75),
                      ],
                    ],
                  ),
                ),

                _Label('Reference'),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.gap * 2,
                  ),
                  child: TextField(
                    controller: _note,
                    onChanged: _draft.setNote,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      hintText: 'Against bill 402, weekly settlement…',
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (!keyboardUp)
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(AppTheme.gap * 2),
                child: FilledButton(
                  onPressed: draft.canSave ? _save : null,
                  style: FilledButton.styleFrom(
                    backgroundColor: tone,
                    foregroundColor:
                        ThemeData.estimateBrightnessForColor(tone) ==
                            Brightness.dark
                        ? Colors.white
                        : const Color(0xFF1A1D23),
                    disabledBackgroundColor: scheme.outlineVariant,
                  ),
                  child: draft.saving
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          draft.amount > 0
                              ? 'Pay ${fmt.rupees(draft.amount)}'
                              : 'Record payment',
                        ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.gap * 2,
        AppTheme.gap * 2,
        AppTheme.gap * 2,
        AppTheme.gap,
      ),
      child: Text(
        text.toUpperCase(),
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          letterSpacing: 1.2,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.selected,
    required this.tone,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final Color tone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final foreground = selected
        ? (ThemeData.estimateBrightnessForColor(tone) == Brightness.dark
              ? Colors.white
              : const Color(0xFF1A1D23))
        : scheme.onSurface;

    return Material(
      color: selected ? tone : scheme.surface,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.gap * 2.5),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: selected ? tone : scheme.outlineVariant),
          ),
          child: Text(
            label,
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: foreground,
            ),
          ),
        ),
      ),
    );
  }
}

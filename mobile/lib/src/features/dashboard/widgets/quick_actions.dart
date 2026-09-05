import 'package:flutter/material.dart';

import '../../../theme.dart';

/// IN, OUT and PAY — the three things done while walking around the shop.
///
/// These are the reason the app exists (MOBILE.md: "the standing up in the shop
/// flows"), so they get the largest targets on the screen and the only fully
/// saturated colour on it. Everything above and below them is something to read;
/// these are the things to press, and they should look like it from across a
/// room.
///
/// Solid blocks rather than tinted outlines. The reference palettes spend their
/// colour exactly this way — a quiet ground with a few blocks that commit — and
/// a bordered pastel tile reads as disabled next to a filled one.
class QuickActions extends StatelessWidget {
  const QuickActions({super.key, required this.onAction});

  final void Function(QuickAction action) onAction;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Row(
      children: [
        for (final (index, action) in QuickAction.values.indexed) ...[
          if (index > 0) const SizedBox(width: AppTheme.gap * 1.25),
          Expanded(
            child: _ActionTile(
              action: action,
              color: switch (action) {
                QuickAction.materialIn => scheme.inColor,
                QuickAction.materialOut => scheme.outColor,
                QuickAction.pay => scheme.payColor,
              },
              onTap: () => onAction(action),
            ),
          ),
        ],
      ],
    );
  }
}

enum QuickAction {
  materialIn('IN', 'From a karigar', Icons.south_west_rounded),
  materialOut('OUT', 'To a karigar', Icons.north_east_rounded),
  pay('PAY', 'Karigar or vendor', Icons.currency_rupee_rounded);

  const QuickAction(this.label, this.hint, this.icon);

  final String label;
  final String hint;
  final IconData icon;
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.action,
    required this.color,
    required this.onTap,
  });

  final QuickAction action;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Black or white text, whichever the block can actually carry. Orange needs
    // dark text; violet needs light. Computed rather than chosen, so a colour
    // change later cannot quietly leave one tile unreadable.
    final onColor =
        ThemeData.estimateBrightnessForColor(color) == Brightness.dark
        ? Colors.white
        : const Color(0xFF1A1D23);

    return Semantics(
      button: true,
      label: '${action.label} — ${action.hint}',
      child: Material(
        color: color,
        borderRadius: BorderRadius.circular(AppTheme.gap * 1.75),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppTheme.gap * 1.75),
          child: SizedBox(
            // 56 tall, with the icon beside the label rather than above it. The
            // stacked version was 86 and looked like it was holding something
            // back — a button does not need to be a card. Still comfortably over
            // Material's 48 minimum, which is what actually matters for a thumb
            // in a hurry.
            height: 56,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(action.icon, color: onColor, size: 19),
                const SizedBox(width: AppTheme.gap * 0.75),
                Text(
                  action.label,
                  style: TextStyle(
                    color: onColor,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

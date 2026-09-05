import 'package:flutter/material.dart';

import '../../../theme.dart';

/// IN, OUT and PAY — the three things done while walking around the shop.
///
/// These are the reason the app exists (MOBILE.md: "the standing up in the shop
/// flows"), so they get the largest targets on the screen and sit low, where a
/// thumb reaches without the hand shifting its grip. Everything above them is
/// something to read; these are the things to press.
class QuickActions extends StatelessWidget {
  const QuickActions({super.key, required this.onAction});

  final void Function(QuickAction action) onAction;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Row(
      children: [
        for (final (index, action) in QuickAction.values.indexed) ...[
          if (index > 0) const SizedBox(width: AppTheme.gap * 1.5),
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
    final theme = Theme.of(context);

    return Semantics(
      button: true,
      label: '${action.label} — ${action.hint}',
      child: Material(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.gap * 2),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppTheme.gap * 2),
          child: Container(
            // 96 tall. Far above Material's 48 minimum, and on purpose: this is
            // pressed with one thumb, in a hurry, sometimes without looking.
            height: 96,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppTheme.gap * 2),
              border: Border.all(color: color.withValues(alpha: 0.35)),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(action.icon, color: color, size: 26),
                const SizedBox(height: AppTheme.gap * 0.75),
                Text(
                  action.label,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
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

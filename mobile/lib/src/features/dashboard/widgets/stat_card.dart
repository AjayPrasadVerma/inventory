import 'package:flutter/material.dart';

import '../../../theme.dart';

/// One number, big enough to read at arm's length.
///
/// The shop reads these while holding the phone in one hand and something else
/// in the other, so the value is the loudest thing on the card and the label is
/// quiet above it. The reverse — a heavy label with a small number — is the
/// common mistake and it makes a dashboard useless at a glance.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.hint,
    this.tone,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final String? hint;

  /// Colours the icon and the value. Left null for ordinary counts — if every
  /// card shouts, the one that matters cannot.
  final Color? tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final accent = tone ?? scheme.onSurface;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppTheme.gap * 2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Icon(icon, size: 18, color: accent),
                  const SizedBox(width: AppTheme.gap),
                  Expanded(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.gap * 1.5),
              Text(
                value,
                maxLines: 1,
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -1,
                  color: accent,
                  // Digits of equal width, so a number changing on refresh does
                  // not shuffle the ones next to it.
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              if (hint != null) ...[
                const SizedBox(height: AppTheme.gap * 0.5),
                Text(
                  hint!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The card's shape while the first load is still in flight.
///
/// A skeleton rather than a spinner: the layout does not move when the numbers
/// arrive, so the screen settles once instead of twice.
class StatCardSkeleton extends StatelessWidget {
  const StatCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.onSurface
        .withValues(alpha: 0.06);
    Widget bar(double width, double height) => Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: base,
        borderRadius: BorderRadius.circular(4),
      ),
    );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.gap * 2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            bar(90, 12),
            const SizedBox(height: AppTheme.gap * 2),
            bar(64, 28),
            const SizedBox(height: AppTheme.gap),
            bar(72, 10),
          ],
        ),
      ),
    );
  }
}

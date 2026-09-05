import 'package:flutter/material.dart';

import '../../../format.dart' as fmt;
import '../../../models/dashboard.dart';
import '../../../theme.dart';

/// Stock that is low, or that has gone past zero.
///
/// The one part of this screen that is a list of work rather than a record of
/// what happened, so it reads as rows to get through. Oversold is separated from
/// low by colour and wording because they are different problems: low means
/// order more, oversold means the books disagree with the shelf.
class AttentionList extends StatelessWidget {
  const AttentionList({super.key, required this.rows});

  final List<AttentionRow> rows;

  /// If forty things need attention, a phone is not where that gets worked
  /// through — the website has the full report.
  static const _visibleLimit = 6;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (rows.isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.gap * 1.5,
          vertical: AppTheme.gap * 2,
        ),
        decoration: BoxDecoration(
          color: scheme.tintOf(scheme.inColor),
          borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
        ),
        child: Row(
          children: [
            Icon(Icons.check_circle_rounded, color: scheme.inColor, size: 20),
            const SizedBox(width: AppTheme.gap * 1.5),
            Expanded(
              child: Text(
                'Nothing low or oversold — stock levels look healthy.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: scheme.inColor,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      );
    }

    final shown = rows.take(_visibleLimit).toList();
    final hidden = rows.length - shown.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final row in shown) ...[
          _AttentionTile(row: row),
          const SizedBox(height: AppTheme.gap * 0.75),
        ],
        if (hidden > 0)
          Padding(
            padding: const EdgeInsets.only(top: AppTheme.gap * 0.5),
            child: Text(
              '$hidden more on the website',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ),
      ],
    );
  }
}

class _AttentionTile extends StatelessWidget {
  const _AttentionTile({required this.row});

  final AttentionRow row;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    // Oversold is danger, low is warning — the same split the website makes
    // (tone={a.status === "Oversold" ? "danger" : "warning"} in its dashboard).
    final tone = row.isOversold ? scheme.warnColor : scheme.lowColor;

    return Container(
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
        border: Border(left: BorderSide(color: tone, width: 4)),
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.gap * 1.5,
        vertical: AppTheme.gap * 1.25,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    // Raw or Finished. Two things can share a name across the
                    // two catalogues, so the kind is not decoration.
                    _KindBadge(kind: row.kind),
                    const SizedBox(width: AppTheme.gap),
                    Flexible(
                      child: Text(
                        row.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                if (row.subtitle.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    row.subtitle,
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
          const SizedBox(width: AppTheme.gap * 1.5),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                fmt.qty(row.onHand),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: tone,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(height: 2),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: scheme.tintOf(tone),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  row.status,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: tone,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _KindBadge extends StatelessWidget {
  const _KindBadge({required this.kind});

  final String kind;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    // The route sends "Raw" / "Finished" already capitalised.
    final isRaw = kind.toLowerCase().startsWith('raw');
    final colour = isRaw ? scheme.onSurfaceVariant : scheme.primary;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: scheme.tintOf(colour),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        kind,
        style: theme.textTheme.labelSmall?.copyWith(
          color: colour,
          fontWeight: FontWeight.w700,
          fontSize: 10,
        ),
      ),
    );
  }
}

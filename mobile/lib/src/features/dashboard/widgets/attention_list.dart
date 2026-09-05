import 'package:flutter/material.dart';

import '../../../format.dart' as fmt;
import '../../../models/dashboard.dart';
import '../../../theme.dart';

/// Stock that is low, or that has gone past zero.
///
/// The only part of the dashboard that is a to-do list rather than a number, so
/// it reads as rows to work through. Oversold is separated from low by colour
/// and wording because they are different problems: low means order more,
/// oversold means the books disagree with the shelf.
class AttentionList extends StatelessWidget {
  const AttentionList({super.key, required this.rows});

  final List<AttentionRow> rows;

  /// Long lists are cut here rather than scrolled inside a scrolling page. If
  /// forty things need attention, a phone is not where that gets worked through.
  static const _visibleLimit = 6;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (rows.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppTheme.gap * 2,
            vertical: AppTheme.gap * 3,
          ),
          child: Row(
            children: [
              Icon(Icons.check_circle_rounded, color: scheme.inColor, size: 22),
              const SizedBox(width: AppTheme.gap * 1.5),
              Expanded(
                child: Text(
                  'Nothing low or oversold — stock levels look healthy.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final shown = rows.take(_visibleLimit).toList();
    final hidden = rows.length - shown.length;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (final (index, row) in shown.indexed) ...[
            if (index > 0) const Divider(),
            _AttentionTile(row: row),
          ],
          if (hidden > 0) ...[
            const Divider(),
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.gap * 2,
                vertical: AppTheme.gap * 1.5,
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.more_horiz_rounded,
                    size: 18,
                    color: scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: AppTheme.gap),
                  Text(
                    '$hidden more on the website',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
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
    final bad = row.isOversold;
    final tone = bad ? scheme.warnColor : scheme.outColor;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.gap * 2,
        vertical: AppTheme.gap * 1.5,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  row.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
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
                  color: tone.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  row.status,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: tone,
                    fontWeight: FontWeight.w600,
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

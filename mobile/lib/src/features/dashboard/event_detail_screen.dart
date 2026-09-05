import 'package:flutter/material.dart';

import '../../format.dart' as fmt;
import '../../models/activity.dart';
import '../../theme.dart';
import 'activity_style.dart';

/// One entry from the day's feed, opened in full.
///
/// A purchase or a karigar entry routinely carries thirty to forty lines here.
/// Folding that open inside the dashboard pushed everything below it off the
/// screen and made the feed jump as rows opened, so the detail gets its own
/// page: the dashboard stays a dashboard, and this is where what moved is read.
///
/// The lines are **grouped by item**, because a big entry here is nearly always
/// one item in many colours. Thirty-five rows that each begin "Silk" put the
/// repeated word first and the thing that actually differs second; grouped, the
/// name is said once with its total and each row carries only its variant.
class EventDetailScreen extends StatelessWidget {
  const EventDetailScreen({super.key, required this.event, required this.date});

  final ActivityEvent event;

  /// The day the feed was showing. The event does not carry one — it came from a
  /// request that was already scoped to a date.
  final String date;

  static const _months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  String get _prettyDate {
    final p = date.split('-');
    if (p.length != 3) return date;
    final m = int.tryParse(p[1]) ?? 1;
    return '${int.tryParse(p[2]) ?? p[2]} ${_months[(m - 1).clamp(0, 11)]} ${p[0]}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final colour = colourOfSide(scheme, event.side);
    final groups = _group(event.lines);

    return Scaffold(
      appBar: AppBar(
        title: Text(event.party ?? event.kind.label),
        titleTextStyle: theme.textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w700,
          color: scheme.onSurface,
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppTheme.gap * 2,
          0,
          AppTheme.gap * 2,
          AppTheme.gap * 4,
        ),
        children: [
          _Summary(event: event, colour: colour, date: _prettyDate),
          if (groups.isEmpty) ...[
            const SizedBox(height: AppTheme.gap * 4),
            Center(
              child: Text(
                'No goods on this entry.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ),
          ] else
            for (final g in groups) ...[
              const SizedBox(height: AppTheme.gap * 2.5),
              _Group(group: g, colour: colour),
            ],
        ],
      ),
    );
  }

  /// One entry per item name, in the order the lines arrived.
  List<_LineGroup> _group(List<ActivityLine> lines) {
    final byName = <String, _LineGroup>{};
    final order = <String>[];
    for (final line in lines) {
      final g = byName.putIfAbsent(line.name, () {
        order.add(line.name);
        return _LineGroup(line.name);
      });
      g.lines.add(line);
    }
    return [for (final name in order) byName[name]!];
  }
}

class _LineGroup {
  _LineGroup(this.name);

  final String name;
  final List<ActivityLine> lines = [];

  /// Totals kept per unit. Metres and sheets do not add up, and one number that
  /// quietly mixed them would be worse than showing none.
  String get total {
    final sums = <String, double>{};
    for (final l in lines) {
      final unit = lineParts(l).unit;
      sums[unit] = (sums[unit] ?? 0) + l.qty;
    }
    return sums.entries
        .map((e) => '${fmt.qty(e.value)}${e.key.isEmpty ? '' : ' ${e.key}'}')
        .join('  ·  ');
  }
}

/// What this entry was, in the colour of the khata column it belongs to.
class _Summary extends StatelessWidget {
  const _Summary({
    required this.event,
    required this.colour,
    required this.date,
  });

  final ActivityEvent event;
  final Color colour;
  final String date;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.all(AppTheme.gap * 2),
      decoration: BoxDecoration(
        color: scheme.tintOf(colour),
        borderRadius: BorderRadius.circular(AppTheme.gap * 2),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: colour,
              borderRadius: BorderRadius.circular(AppTheme.gap * 1.25),
            ),
            child: Icon(
              iconOfKind(event.kind),
              color:
                  ThemeData.estimateBrightnessForColor(colour) ==
                      Brightness.dark
                  ? Colors.white
                  : const Color(0xFF1A1D23),
              size: 20,
            ),
          ),
          const SizedBox(width: AppTheme.gap * 1.5),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.kind.label,
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: colour,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  '$date  ·  ${event.ref}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          if (event.amount != null)
            Text(
              fmt.rupees(event.amount!),
              style: theme.textTheme.titleMedium?.copyWith(
                color: colour,
                fontWeight: FontWeight.w800,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
        ],
      ),
    );
  }
}

/// One item, with every variant of it that moved.
class _Group extends StatelessWidget {
  const _Group({required this.group, required this.colour});

  final _LineGroup group;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    // One line is not a group. Giving it a header would print the same quantity
    // twice — once as the total and once as the only row under it — and number
    // it "1 of 1". So a lone line is just a row, with the item name on it.
    if (group.lines.length == 1) {
      return Container(
        decoration: BoxDecoration(
          color: scheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.gap * 1.75),
        ),
        child: _VariantRow(
          line: group.lines.first,
          colour: colour,
          leading: group.name,
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // The name once, with what it adds up to — not repeated down every row.
        Padding(
          padding: const EdgeInsets.only(
            left: AppTheme.gap * 0.5,
            right: AppTheme.gap * 0.5,
            bottom: AppTheme.gap,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Text(
                  group.name,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
                ),
              ),
              const SizedBox(width: AppTheme.gap),
              Text(
                group.total,
                style: theme.textTheme.labelLarge?.copyWith(
                  color: colour,
                  fontWeight: FontWeight.w700,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: scheme.surface,
            borderRadius: BorderRadius.circular(AppTheme.gap * 1.75),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (final (i, line) in group.lines.indexed) ...[
                if (i > 0)
                  Padding(
                    // Indented so the rule separates the variants and does not
                    // cut across the numbering column.
                    padding: const EdgeInsets.only(left: AppTheme.gap * 5.5),
                    child: Divider(height: 1, color: scheme.outlineVariant),
                  ),
                _VariantRow(index: i + 1, line: line, colour: colour),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _VariantRow extends StatelessWidget {
  const _VariantRow({
    this.index,
    required this.line,
    required this.colour,
    this.leading,
  });

  /// Position within its group. Null for a group of one, where numbering says
  /// nothing.
  final int? index;
  final ActivityLine line;
  final Color colour;

  /// The item name, shown only when this row is standing in for a whole group.
  final String? leading;

  /// What this row is called.
  ///
  /// Inside a group: the variant alone, because the item name is the header
  /// above it. Standing in for a whole group: the item name, plus the variant
  /// when there is one — an item with no colour would otherwise read as "—".
  String _label() {
    final label = lineParts(line).label;
    if (leading == null) return label.isEmpty ? '—' : label;
    return label.isEmpty ? leading! : '$leading · $label';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final unit = lineParts(line).unit;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.gap * 1.75,
        vertical: AppTheme.gap * 1.25,
      ),
      child: Row(
        children: [
          // A running number, so "the twelfth one" can be found again by eye in a
          // list of thirty-five without counting from the top. Absent for a lone
          // line, where "1 of 1" says nothing.
          if (index != null)
            SizedBox(
              width: 26,
              child: Text(
                '$index',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
          Expanded(
            child: Text(
              // Inside a group the name is already in the header, so the row
              // carries only the variant. Standing alone it has to say both.
              _label(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: AppTheme.gap),
          // The quantity says what it is measured in. On its own, "45" beside a
          // colour name is just a number.
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: fmt.qty(line.qty),
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: colour,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                if (unit.isNotEmpty)
                  TextSpan(
                    text: ' $unit',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
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

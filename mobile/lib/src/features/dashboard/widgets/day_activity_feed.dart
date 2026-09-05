import 'package:flutter/material.dart';

import '../../../format.dart' as fmt;
import '../../../models/activity.dart';
import '../../../theme.dart';
import '../activity_style.dart';
import '../event_detail_screen.dart';

/// What happened on one day.
///
/// Each event is a row with a coloured rail down its left edge rather than a box
/// of its own — a feed of twelve bordered cards reads as twelve separate things
/// to deal with, when it is really one list. The rail says which of the three
/// columns the event belongs to (in / out / money) at a glance, which is the
/// same language the shop's khata uses.
class DayActivityFeed extends StatelessWidget {
  const DayActivityFeed({
    super.key,
    required this.activity,
    required this.date,
  });

  final DayActivity activity;

  /// The day being shown, passed through to the detail page.
  final String date;

  /// A day with thirty entries is not worked through on a phone. Enough to see
  /// what today looks like, and the website for the rest.
  static const _visibleLimit = 8;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (activity.isEmpty) {
      return _Empty(
        icon: Icons.wb_sunny_rounded,
        text: 'Nothing recorded on this day yet.',
        color: scheme.onSurfaceVariant,
      );
    }

    final shown = activity.events.take(_visibleLimit).toList();
    final hidden = activity.events.length - shown.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final event in shown) ...[
          _EventRow(event: event, date: date),
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

/// One thing that happened, as a single row.
///
/// A purchase or a karigar entry routinely carries thirty to forty lines here.
/// Two of them fit on the row, so two is what it shows, with the rest as a count
/// — and the whole row opens [EventDetailScreen] for the full list.
///
/// This used to fold open in place. It looked wrong: the feed jumped as rows
/// grew, and one opened entry pushed everything else off the screen, which is
/// the opposite of what a dashboard is for.
class _EventRow extends StatelessWidget {
  const _EventRow({required this.event, required this.date});

  final ActivityEvent event;
  final String date;

  /// How many of the goods fit on the row before it turns into a count. Two,
  /// because a third chip wraps to a second line on a narrow phone.
  static const _inlineChips = 2;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final colour = colourOfSide(scheme, event.side);
    final lines = event.lines;
    final extra = lines.length - _inlineChips;

    return Container(
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
        border: Border(left: BorderSide(color: colour, width: 4)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => EventDetailScreen(event: event, date: date),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.gap * 1.5,
              vertical: AppTheme.gap * 1.25,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: scheme.tintOf(colour),
                        borderRadius: BorderRadius.circular(AppTheme.gap),
                      ),
                      child: Icon(
                        iconOfKind(event.kind),
                        size: 17,
                        color: colour,
                      ),
                    ),
                    const SizedBox(width: AppTheme.gap * 1.25),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            event.party ?? event.kind.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyLarge?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          Text(
                            '${event.kind.label} · ${event.ref}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (event.amount != null) ...[
                      const SizedBox(width: AppTheme.gap),
                      Text(
                        fmt.rupees(event.amount!),
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: colour,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                    const SizedBox(width: AppTheme.gap * 0.5),
                    Icon(
                      Icons.chevron_right_rounded,
                      size: 20,
                      color: scheme.onSurfaceVariant,
                    ),
                  ],
                ),
                if (lines.isNotEmpty) ...[
                  const SizedBox(height: AppTheme.gap),
                  Row(
                    children: [
                      for (final line in lines.take(_inlineChips)) ...[
                        Flexible(
                          child: _LineChip(line: line, colour: colour),
                        ),
                        const SizedBox(width: AppTheme.gap * 0.75),
                      ],
                      if (extra > 0)
                        Text(
                          '+$extra more',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LineChip extends StatelessWidget {
  const _LineChip({required this.line, required this.colour});

  final ActivityLine line;
  final Color colour;

  /// "Silk · Maroon  20 meter". The unit belongs next to the number it measures,
  /// not buried in the middle of the label — on its own, "20" is just a digit.
  static String _chipLabel(ActivityLine line) {
    final parts = lineParts(line);
    final name = parts.label.isEmpty
        ? line.name
        : '${line.name} · ${parts.label}';
    final qty = parts.unit.isEmpty
        ? fmt.qty(line.qty)
        : '${fmt.qty(line.qty)} ${parts.unit}';
    return '$name  $qty';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.gap,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: scheme.tintOf(colour),
        borderRadius: BorderRadius.circular(999),
      ),
      // One line, always. A chip that wraps makes its neighbour look shorter
      // and the row ragged; the full text is on the detail page anyway.
      child: Text(
        _chipLabel(line),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        softWrap: false,
        style: theme.textTheme.labelSmall?.copyWith(
          color: colour,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.text, required this.color});

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTheme.gap * 3),
      child: Row(
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: AppTheme.gap * 1.5),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodyMedium?.copyWith(color: color),
            ),
          ),
        ],
      ),
    );
  }
}

/// The date control: a day at a time with the arrows, any day with the calendar.
///
/// The website puts a real date field here so yesterday is one click away rather
/// than a different report. Same idea, shaped for a thumb — the arrows cover
/// "the day before this one", which is most of the use, and tapping the date
/// itself opens the calendar for anything further back.
class ActivityDateBar extends StatelessWidget {
  const ActivityDateBar({
    super.key,
    required this.date,
    required this.isToday,
    required this.selected,
    required this.onShift,
    required this.onToday,
    required this.onPick,
  });

  final String date;
  final bool isToday;

  /// The selected day, for the calendar to open on.
  final DateTime selected;

  final void Function(int days) onShift;
  final VoidCallback onToday;
  final void Function(DateTime day) onPick;

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

  String get _label {
    final parts = date.split('-');
    if (parts.length != 3) return date;
    final month = int.tryParse(parts[1]) ?? 1;
    final day = int.tryParse(parts[2]) ?? 0;
    final year = int.tryParse(parts[0]) ?? DateTime.now().year;
    final base = '$day ${_months[(month - 1).clamp(0, 11)]}';
    // The year only earns its place when it is not the current one.
    return year == DateTime.now().year ? base : '$base $year';
  }

  Future<void> _openCalendar(BuildContext context) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: selected,
      // Two years back covers anything worth opening on a phone; the website has
      // the full history. Forward stops at today — nothing is recorded ahead.
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year, now.month, now.day),
      helpText: 'Show activity for',
    );
    if (picked != null) onPick(picked);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          onPressed: () => onShift(-1),
          icon: const Icon(Icons.chevron_left_rounded),
          tooltip: 'Previous day',
          visualDensity: VisualDensity.compact,
        ),
        // The label is the calendar button. It is the thing you would reach for,
        // so it is what opens the picker rather than a separate icon beside it.
        InkWell(
          onTap: () => _openCalendar(context),
          borderRadius: BorderRadius.circular(AppTheme.gap),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.gap,
              vertical: AppTheme.gap * 0.75,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  isToday ? 'Today' : _label,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: AppTheme.gap * 0.5),
                Icon(
                  Icons.calendar_today_rounded,
                  size: 14,
                  color: scheme.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
        IconButton(
          // Tomorrow holds nothing, so forward stops at today rather than
          // walking into empty days.
          onPressed: isToday ? null : () => onShift(1),
          icon: const Icon(Icons.chevron_right_rounded),
          tooltip: 'Next day',
          visualDensity: VisualDensity.compact,
        ),
        // "Back to today" as an icon, not a text button, and no Spacer pushing
        // it away. This bar shares a row with the section title, so it has to
        // take only the width it needs — a Spacer inside it claimed the rest and
        // overflowed the row.
        if (!isToday)
          IconButton(
            onPressed: onToday,
            icon: const Icon(Icons.today_rounded),
            iconSize: 18,
            tooltip: 'Back to today',
            visualDensity: VisualDensity.compact,
            color: scheme.primary,
          ),
      ],
    );
  }
}

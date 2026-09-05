import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/activity.dart';
import '../auth/auth_controller.dart';

/// Which day the activity feed is showing. Today by default; the arrows on the
/// feed move it. Kept as a plain `YYYY-MM-DD` string because that is what the
/// route takes and what Postgres compares against — turning it into a DateTime
/// and back is where timezone bugs get in, and this repo has shipped one before
/// (see the UTC date-only rule in scripts/guards.mjs).
final activityDateProvider = NotifierProvider<ActivityDate, String>(
  ActivityDate.new,
);

class ActivityDate extends Notifier<String> {
  @override
  String build() => _iso(DateTime.now());

  /// Moves by whole days using local-time arithmetic, so a shop in IST that
  /// taps "yesterday" at 1am gets yesterday rather than two days ago.
  void shift(int days) {
    final parts = state.split('-').map(int.parse).toList();
    state = _iso(DateTime(parts[0], parts[1], parts[2] + days));
  }

  void reset() => state = _iso(DateTime.now());

  /// Jump straight to a day, from the calendar. Refuses the future: nothing has
  /// been recorded there, so it would only ever show an empty feed.
  void set(DateTime day) {
    final today = DateTime.now();
    final capped = day.isAfter(today) ? today : day;
    state = _iso(capped);
  }

  bool get isToday => state == _iso(DateTime.now());

  /// The selected day as a [DateTime], for the calendar to open on.
  DateTime get asDate {
    final p = state.split('-').map(int.parse).toList();
    return DateTime(p[0], p[1], p[2]);
  }

  static String _iso(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// The feed for whichever day is selected. Re-fetches when the date changes,
/// because it watches the date provider.
final activityProvider = AsyncNotifierProvider<ActivityController, DayActivity>(
  ActivityController.new,
);

class ActivityController extends AsyncNotifier<DayActivity> {
  @override
  Future<DayActivity> build() async {
    final date = ref.watch(activityDateProvider);
    final body = await ref
        .watch(apiClientProvider)
        .get('/reports/activity', query: {'date': date});
    return DayActivity.fromEnvelope(body);
  }

  Future<void> refresh() async {
    final date = ref.read(activityDateProvider);
    state = await AsyncValue.guard(() async {
      final body = await ref
          .read(apiClientProvider)
          .get('/reports/activity', query: {'date': date});
      return DayActivity.fromEnvelope(body);
    });
  }
}

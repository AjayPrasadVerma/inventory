import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/dashboard.dart';
import '../auth/auth_controller.dart';

/// The dashboard's data, in one request.
///
/// Refreshing keeps the numbers that are already on screen. That is the
/// cache-first rule from MOBILE.md — "show what you have, refresh behind it" —
/// and on the shop's link it is the difference between a screen that blinks
/// empty every time it is pulled and one that just updates. [AsyncValue] holds
/// the previous value through a reload, so the widget reads `.value` and only
/// shows a spinner when there is genuinely nothing yet.
final dashboardProvider =
    AsyncNotifierProvider<DashboardController, DashboardSummary>(
      DashboardController.new,
    );

class DashboardController extends AsyncNotifier<DashboardSummary> {
  @override
  Future<DashboardSummary> build() async {
    final body = await ref.watch(apiClientProvider).get('/reports/dashboard');
    return DashboardSummary.fromEnvelope(body);
  }

  /// Pull-to-refresh. Errors land in [state] rather than being thrown at the
  /// gesture, so a failed pull can leave the old numbers up and say so, instead
  /// of replacing a working screen with an error page.
  Future<void> refresh() async {
    state = await AsyncValue.guard(() async {
      final body = await ref.read(apiClientProvider).get('/reports/dashboard');
      return DashboardSummary.fromEnvelope(body);
    });
  }
}

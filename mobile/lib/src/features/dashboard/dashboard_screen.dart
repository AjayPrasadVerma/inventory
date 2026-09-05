import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_exception.dart';
import '../../models/auth.dart';
import '../../theme.dart';
import '../auth/auth_controller.dart';
import 'activity_controller.dart';
import 'dashboard_controller.dart';
import 'widgets/attention_list.dart';
import 'widgets/day_activity_feed.dart';
import 'widgets/quick_actions.dart';

/// The home screen: the three things done while walking around the shop, what
/// has happened today, and what needs restocking.
///
/// The KPI tiles the website leads with are deliberately **not** here. On a
/// desktop they are a summary you glance at; on a phone they filled the first
/// screen with numbers nobody had come to read, and pushed the actions — the
/// reason the app exists — below the fold. The website keeps them.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key, required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboard = ref.watch(dashboardProvider);
    final activity = ref.watch(activityProvider);
    final date = ref.watch(activityDateProvider);
    final isToday = ref.watch(activityDateProvider.notifier).isToday;
    final data = dashboard.value;
    final lowCount = data?.lowStockCount;

    Future<void> refreshAll() async {
      await Future.wait([
        ref.read(dashboardProvider.notifier).refresh(),
        ref.read(activityProvider.notifier).refresh(),
      ]);
    }

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: refreshAll,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: _Header(user: user, lowCount: lowCount),
            ),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppTheme.gap * 2,
                AppTheme.gap * 1.5,
                AppTheme.gap * 2,
                AppTheme.gap * 3,
              ),
              sliver: SliverList.list(
                children: [
                  QuickActions(onAction: (a) => _notBuiltYet(context, a)),

                  // The date control sits on the title's own row rather than
                  // under it. Two stacked rows of chrome above a feed is most of
                  // a phone's first screen spent on neither.
                  const SizedBox(height: AppTheme.gap * 2),
                  _SectionHeader(
                    title: "Today's activity",
                    trailing: ActivityDateBar(
                      date: date,
                      isToday: isToday,
                      selected: ref.read(activityDateProvider.notifier).asDate,
                      onShift: (d) =>
                          ref.read(activityDateProvider.notifier).shift(d),
                      onToday: () =>
                          ref.read(activityDateProvider.notifier).reset(),
                      onPick: (day) =>
                          ref.read(activityDateProvider.notifier).set(day),
                    ),
                  ),
                  const SizedBox(height: AppTheme.gap),
                  _AsyncSection(
                    state: activity,
                    onRetry: () =>
                        ref.read(activityProvider.notifier).refresh(),
                    builder: (value) =>
                        DayActivityFeed(activity: value, date: date),
                  ),

                  const SizedBox(height: AppTheme.gap * 2.5),
                  _SectionHeader(
                    title: 'Needs attention',
                    badge: lowCount == null || lowCount == 0
                        ? null
                        : '$lowCount',
                  ),
                  const SizedBox(height: AppTheme.gap),
                  _AsyncSection(
                    state: dashboard,
                    onRetry: () =>
                        ref.read(dashboardProvider.notifier).refresh(),
                    builder: (value) => AttentionList(rows: value.attention),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _notBuiltYet(BuildContext context, QuickAction action) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('${action.label} is the next screen to be built.'),
        ),
      );
  }
}

/// The greeting, on the page's own background.
///
/// No coloured band. A gradient header is the easy way to make a screen look
/// designed, and it spends the loudest colour on the one part nobody presses —
/// which then leaves the actions underneath competing with it. The reference
/// palettes do the opposite: a quiet dark ground, colour saved for the blocks
/// that matter. So the top is just the shop's name, who is signed in, and how
/// the stock is doing.
class _Header extends ConsumerWidget {
  const _Header({required this.user, required this.lowCount});

  final AuthUser user;
  final int? lowCount;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hour = DateTime.now().hour;
    final part = hour < 12
        ? 'Good morning'
        : (hour < 17 ? 'Good afternoon' : 'Good evening');
    final needs = lowCount != null && lowCount! > 0;

    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppTheme.gap * 2,
          AppTheme.gap * 1.5,
          AppTheme.gap * 2,
          0,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // The whole header is two rows: who you are, and how the shop is.
            // The greeting used to take three — a label line, a big name, and
            // then the status — which is a third of a phone screen spent on
            // something read once and then ignored.
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'ACRONIX',
                        style: TextStyle(
                          color: scheme.primary,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.5,
                        ),
                      ),
                      Text(
                        '$part, ${user.name.split(' ').first}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.4,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppTheme.gap),
                _UserMenu(user: user),
              ],
            ),
            const SizedBox(height: AppTheme.gap * 1.25),
            // One line of state, coloured only when it is asking for something.
            Row(
              children: [
                Icon(
                  needs ? Icons.error_rounded : Icons.check_circle_rounded,
                  size: 15,
                  color: needs ? scheme.warnColor : scheme.inColor,
                ),
                const SizedBox(width: AppTheme.gap * 0.75),
                Text(
                  switch (lowCount) {
                    null => 'Loading the shop…',
                    0 => 'Everything is stocked',
                    final n => '$n item${n == 1 ? '' : 's'} need restocking',
                  },
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: needs ? scheme.warnColor : scheme.onSurfaceVariant,
                    fontWeight: needs ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Renders one async section: its value, a skeleton while it first loads, or an
/// error that does not take the rest of the screen with it.
class _AsyncSection<T> extends StatelessWidget {
  const _AsyncSection({
    required this.state,
    required this.onRetry,
    required this.builder,
  });

  final AsyncValue<T> state;
  final VoidCallback onRetry;
  final Widget Function(T value) builder;

  @override
  Widget build(BuildContext context) {
    final value = state.value;

    // A failed refresh with data already up is a strip above it, not a takeover:
    // on the shop's link, stale rows beat an error page.
    if (state.hasError) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SectionError(
            error: state.error!,
            stale: value != null,
            onRetry: onRetry,
          ),
          if (value != null) ...[
            const SizedBox(height: AppTheme.gap * 1.5),
            builder(value),
          ],
        ],
      );
    }
    if (value == null) return const _SectionSkeleton();
    return builder(value);
  }
}

class _SectionSkeleton extends StatelessWidget {
  const _SectionSkeleton();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Rows the size of the real ones, so the layout settles once rather than
    // jumping when the data lands.
    return Column(
      children: [
        for (var i = 0; i < 3; i++) ...[
          Container(
            height: 58,
            decoration: BoxDecoration(
              color: scheme.onSurface.withValues(alpha: 0.05),
              borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
            ),
          ),
          const SizedBox(height: AppTheme.gap),
        ],
      ],
    );
  }
}

class _SectionError extends StatelessWidget {
  const _SectionError({
    required this.error,
    required this.stale,
    required this.onRetry,
  });

  final Object error;
  final bool stale;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final message = error is ApiException
        ? (error as ApiException).message
        : 'Could not reach the server.';

    return Container(
      padding: const EdgeInsets.all(AppTheme.gap * 1.5),
      decoration: BoxDecoration(
        color: scheme.tintOf(scheme.warnColor),
        borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_off_rounded, size: 20, color: scheme.warnColor),
          const SizedBox(width: AppTheme.gap * 1.5),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  stale ? 'Showing the last update' : 'Could not load',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: scheme.warnColor,
                  ),
                ),
                Text(
                  message,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: onRetry,
            style: TextButton.styleFrom(foregroundColor: scheme.warnColor),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

/// A section title with its controls on the same line.
///
/// The count sits in the title rather than under it, and any control (the date
/// picker) sits to the right of it. Stacking title, subtitle and control down
/// the page spends three rows on chrome before the first row of content.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.badge, this.trailing});

  final String title;
  final String? badge;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Row(
      children: [
        Text(
          title,
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w700,
            letterSpacing: -0.2,
          ),
        ),
        if (badge != null) ...[
          const SizedBox(width: AppTheme.gap),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
            decoration: BoxDecoration(
              color: scheme.tintOf(scheme.warnColor),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              badge!,
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.warnColor,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
        if (trailing != null) ...[const Spacer(), trailing!],
      ],
    );
  }
}

class _UserMenu extends ConsumerWidget {
  const _UserMenu({required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PopupMenuButton<String>(
      tooltip: user.name,
      offset: const Offset(0, 44),
      onSelected: (value) {
        if (value == 'signout') {
          ref.read(authControllerProvider.notifier).signOut();
        }
      },
      itemBuilder: (context) => [
        PopupMenuItem(
          enabled: false,
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(user.name),
            subtitle: Text(user.isOwner ? 'Owner' : 'Staff'),
          ),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem(
          value: 'signout',
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.logout_rounded),
            title: Text('Sign out'),
          ),
        ),
      ],
      child: Builder(
        builder: (context) {
          final scheme = Theme.of(context).colorScheme;
          return Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: scheme.tintOf(scheme.primary),
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              user.name.isEmpty
                  ? '?'
                  : user.name.characters.first.toUpperCase(),
              style: TextStyle(
                color: scheme.primary,
                fontWeight: FontWeight.w800,
                fontSize: 15,
              ),
            ),
          );
        },
      ),
    );
  }
}

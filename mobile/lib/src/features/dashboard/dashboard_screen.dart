import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_exception.dart';
import '../../format.dart' as fmt;
import '../../models/auth.dart';
import '../../models/dashboard.dart';
import '../../theme.dart';
import '../auth/auth_controller.dart';
import 'dashboard_controller.dart';
import 'widgets/attention_list.dart';
import 'widgets/quick_actions.dart';
import 'widgets/stat_card.dart';

/// The home screen: what the shop looks like right now, and the three things
/// most often done to it.
///
/// Reading order is deliberate. Stock counts first, because that is the question
/// the phone gets pulled out to answer. Then IN / OUT / PAY, low on the screen
/// where a thumb reaches. Then what needs attention, which is the only part that
/// is a list of work rather than a number.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key, required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(dashboardProvider);
    final data = async.value;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Acronix'),
        actions: [
          // A quiet refresh next to the menu. Pull-to-refresh is the real
          // gesture; this is for anyone who does not know that yet.
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
            onPressed: () => ref.read(dashboardProvider.notifier).refresh(),
          ),
          _UserMenu(user: user),
          const SizedBox(width: AppTheme.gap),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(dashboardProvider.notifier).refresh(),
        child: ListView(
          // Always scrollable, so pull-to-refresh works even when the content
          // is short enough to fit — otherwise the gesture silently does nothing
          // on exactly the screens with the least on them.
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            AppTheme.gap * 2,
            AppTheme.gap,
            AppTheme.gap * 2,
            AppTheme.gap * 4,
          ),
          children: [
            _Greeting(name: user.name, data: data),
            const SizedBox(height: AppTheme.gap * 2),

            // An error only takes over the screen when there is nothing to show.
            // With numbers already up, a failed refresh is a strip above them —
            // stale data beats an error page when the link drops mid-shop.
            if (async.hasError) ...[
              _RefreshFailed(
                error: async.error!,
                showing: data != null,
                onRetry: () => ref.read(dashboardProvider.notifier).refresh(),
              ),
              const SizedBox(height: AppTheme.gap * 2),
            ],

            if (data == null && !async.hasError)
              const _StatGrid(
                children: [
                  StatCardSkeleton(),
                  StatCardSkeleton(),
                  StatCardSkeleton(),
                  StatCardSkeleton(),
                ],
              )
            else if (data != null)
              _StatGrid(children: _cards(context, data)),

            const SizedBox(height: AppTheme.gap * 3),
            _SectionLabel('Record'),
            const SizedBox(height: AppTheme.gap * 1.5),
            QuickActions(onAction: (a) => _notBuiltYet(context, a)),

            const SizedBox(height: AppTheme.gap * 3),
            _SectionLabel(
              'Needs attention',
              trailing: data == null ? null : '${data.lowStockCount}',
            ),
            const SizedBox(height: AppTheme.gap * 1.5),
            if (data != null)
              AttentionList(rows: data.attention)
            else
              const Card(
                child: SizedBox(
                  height: 96,
                  child: Center(child: CircularProgressIndicator()),
                ),
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _cards(BuildContext context, DashboardSummary d) {
    final scheme = Theme.of(context).colorScheme;
    final healthy = d.lowStockCount == 0;
    return [
      StatCard(
        label: 'FINISHED GOODS',
        value: fmt.count(d.finishedTotal),
        hint: 'across ${d.products} products',
        icon: Icons.inventory_2_rounded,
        tone: scheme.primary,
      ),
      StatCard(
        label: 'RAW MATERIALS',
        value: fmt.count(d.rawMaterials),
        hint: '${d.vendors} vendors',
        icon: Icons.category_rounded,
      ),
      StatCard(
        label: 'LOW / OVERSOLD',
        value: fmt.count(d.lowStockCount),
        hint: healthy ? 'All healthy' : 'Needs restocking',
        icon: healthy
            ? Icons.check_circle_rounded
            : Icons.warning_amber_rounded,
        tone: healthy ? scheme.inColor : scheme.warnColor,
      ),
      StatCard(
        label: 'OPEN JOBS',
        value: fmt.count(d.openJobs),
        hint: '${d.karigars} karigars',
        icon: Icons.engineering_rounded,
      ),
    ];
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

/// Two columns, sized by content rather than a fixed aspect ratio, so a long
/// hint wraps instead of being clipped.
class _StatGrid extends StatelessWidget {
  const _StatGrid({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var row = 0; row < children.length; row += 2) ...[
          if (row > 0) const SizedBox(height: AppTheme.gap * 1.5),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: children[row]),
                if (row + 1 < children.length) ...[
                  const SizedBox(width: AppTheme.gap * 1.5),
                  Expanded(child: children[row + 1]),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.name, required this.data});

  final String name;
  final DashboardSummary? data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hour = DateTime.now().hour;
    final part = hour < 12
        ? 'Good morning'
        : (hour < 17 ? 'Good afternoon' : 'Good evening');

    // Today's activity as a sentence rather than two more cards. It is context
    // for the numbers below, not something to act on.
    final String today;
    if (data == null) {
      today = '';
    } else if (data!.isQuietToday) {
      today = 'Nothing recorded today yet';
    } else {
      today = [
        if (data!.purchasesToday > 0)
          '${data!.purchasesToday} purchase${data!.purchasesToday == 1 ? '' : 's'}',
        if (data!.issuesToday > 0) '${data!.issuesToday} issued',
      ].join(' · ');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$part, ${name.split(' ').first}',
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        if (today.isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(
            today,
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text, {this.trailing});

  final String text;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Text(
          text.toUpperCase(),
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            letterSpacing: 1,
            fontWeight: FontWeight.w600,
          ),
        ),
        if (trailing != null) ...[
          const SizedBox(width: AppTheme.gap),
          Text(
            trailing!,
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

/// A refresh that failed. Wording depends on whether anything is still on screen,
/// because "showing what was here before" and "nothing loaded" are different
/// situations and only one of them is alarming.
class _RefreshFailed extends StatelessWidget {
  const _RefreshFailed({
    required this.error,
    required this.showing,
    required this.onRetry,
  });

  final Object error;
  final bool showing;
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
        color: scheme.warnColor.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppTheme.gap * 1.5),
        border: Border.all(color: scheme.warnColor.withValues(alpha: 0.3)),
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
                  showing ? 'Showing the last update' : 'Could not load',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
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
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class _UserMenu extends ConsumerWidget {
  const _UserMenu({required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;

    return PopupMenuButton<String>(
      tooltip: user.name,
      offset: const Offset(0, 48),
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
      child: CircleAvatar(
        radius: 16,
        backgroundColor: scheme.primaryContainer,
        child: Text(
          user.name.isEmpty ? '?' : user.name.characters.first.toUpperCase(),
          style: TextStyle(
            color: scheme.onPrimaryContainer,
            fontWeight: FontWeight.w700,
            fontSize: 14,
          ),
        ),
      ),
    );
  }
}

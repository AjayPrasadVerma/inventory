import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/auth.dart';
import '../auth/auth_controller.dart';

/// A placeholder, and deliberately nothing more.
///
/// The screens this app is actually for — dashboard, karigar IN / OUT / Pay,
/// stock lookup — are the next steps in MOBILE.md. What this proves is the part
/// underneath them: the session survived, an authenticated call reached the API,
/// and signing out reaches the server.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key, required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Acronix'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () =>
                ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(
                radius: 32,
                child: Text(
                  user.name.isEmpty
                      ? '?'
                      : user.name.characters.first.toUpperCase(),
                  style: theme.textTheme.headlineMedium,
                ),
              ),
              const SizedBox(height: 16),
              Text(user.name, style: theme.textTheme.titleLarge),
              Text(
                user.isOwner ? 'Owner' : 'Staff',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 32),
              Text(
                'Signed in. Dashboard, karigar IN / OUT / Pay and stock lookup come next.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

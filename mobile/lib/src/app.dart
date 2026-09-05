import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/auth/auth_controller.dart';
import 'features/auth/login_screen.dart';
import 'features/home/home_screen.dart';

/// One decision, in one place: who is signed in decides what is on screen.
///
/// No router yet. Adding one before there is more than one destination would be
/// guessing at the shape of navigation this app has not grown yet.
class AcronixApp extends ConsumerWidget {
  const AcronixApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);

    return MaterialApp(
      title: 'Acronix Inventory',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)),
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF2563EB),
          brightness: Brightness.dark,
        ),
      ),
      home: auth.when(
        // The first frame is the session being restored, which needs a network
        // round trip on a slow link. A spinner is honest here; a login screen
        // would flash and then replace itself.
        loading: () => const _Splash(),
        error: (err, _) => _StartupFailure(
          message: '$err',
          onRetry: () => ref.invalidate(authControllerProvider),
        ),
        data: (user) =>
            user == null ? const LoginScreen() : HomeScreen(user: user),
      ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}

/// Restoring the session failed for a reason that is not "signed out" — almost
/// always the API being unreachable. Worth showing rather than silently
/// returning to the login screen, which would look like the password was wrong.
class _StartupFailure extends StatelessWidget {
  const _StartupFailure({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, size: 48),
              const SizedBox(height: 16),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 24),
              FilledButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ),
        ),
      ),
    );
  }
}

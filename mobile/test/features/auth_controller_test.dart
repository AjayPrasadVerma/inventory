/// How the app behaves when the session is over.
///
/// This is the wiring between the client and the controller, not either one
/// alone, so the providers are built for real and only the socket and the token
/// store are swapped. The bug it exists for was invisible to both unit suites:
/// the client reached back into `AuthController` to end the session, which is a
/// loop when the controller is what asked for the client in the first place. On
/// a launch holding a refresh token the server had already dropped, the app
/// opened on `CircularDependencyError` instead of the login screen.
library;

import 'package:acronix_inventory/src/features/auth/auth_controller.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fakes.dart';

void main() {
  /// A container wired as the app wires it, answering every request with [status].
  ({ProviderContainer container, InMemoryTokenStore tokens}) appWith({
    required int status,
    String? refresh = 'refresh-1',
  }) {
    final tokens = InMemoryTokenStore(
      access: 'expired-access',
      refresh: refresh,
    );
    final container = ProviderContainer(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        httpClientProvider.overrideWithValue(
          FakeHttpClient((_) => (status, const {'error': 'Unauthorized'})),
        ),
      ],
    );
    addTearDown(container.dispose);
    return (container: container, tokens: tokens);
  }

  /// Run the controller and hand back where it came to rest.
  ///
  /// Reads the AsyncValue, which is what the widget tree watches, rather than
  /// the future — a build that ends in an error leaves that future unresolved,
  /// and the screen it produces is the one this is checking.
  Future<AsyncValue<Object?>> settle(ProviderContainer container) async {
    final sub = container.listen(authControllerProvider, (_, _) {});
    for (var i = 0; i < 100 && sub.read().isLoading; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    return sub.read();
  }

  test('a session the server has dropped lands on the login screen', () async {
    // 401 everywhere: /auth/me fails, the refresh that follows fails too, and
    // the client gives up and says the session is over — from inside the very
    // build that is asking who is signed in.
    final app = appWith(status: 401);

    final user = await app.container.read(authControllerProvider.future);

    expect(
      user,
      isNull,
      reason: 'no user means the app shows the login screen',
    );
    expect(
      app.tokens.clears,
      greaterThan(0),
      reason: 'the dead tokens are gone',
    );
    expect(
      app.container.read(sessionEndedProvider),
      greaterThan(0),
      reason: 'the client raised the signal rather than calling the controller',
    );
  });

  test('a dropped link is an error to show, not a silent sign-out', () async {
    // 500 is the server being unwell, not the session being over. Signing the
    // shop out for that would be a lie, and it would lose an entry half-typed.
    final app = appWith(status: 500);

    // Asserted on the AsyncValue rather than the future, because that is what
    // the app watches: an error here is the "Try again" screen, not a sign-out.
    final settled = await settle(app.container);

    expect(
      settled.hasError,
      isTrue,
      reason: 'the failure is shown, not hidden',
    );
    expect(app.tokens.clears, 0, reason: 'the session is still good');
    expect(app.container.read(sessionEndedProvider), 0);
  });

  test(
    'no refresh token at all asks for a password without a round trip',
    () async {
      final app = appWith(status: 200, refresh: null);

      expect(await app.container.read(authControllerProvider.future), isNull);
    },
  );

  test(
    'the session-ended signal sends a signed-in user back to login',
    () async {
      // The other way this fires: the session dies while the app is in use,
      // because the owner was removed or a refresh token was replayed.
      final app = appWith(status: 401);
      await app.container.read(authControllerProvider.future);

      app.tokens.refresh = 'refresh-2';
      app.container.read(sessionEndedProvider.notifier).raise();

      expect(await app.container.read(authControllerProvider.future), isNull);
    },
  );
}

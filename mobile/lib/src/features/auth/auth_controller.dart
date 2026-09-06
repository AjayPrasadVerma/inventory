import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../api/api_client.dart';
import '../../api/api_exception.dart';
import '../../api/token_store.dart';
import '../../config/app_config.dart';
import '../../models/auth.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

/// Bumped by the client when refreshing was tried and the session is over.
///
/// The client cannot call the controller directly. The controller reaches the
/// client on the way *down* — `build()` watches it to ask who is signed in — so
/// a client that reads the controller back closes a loop, and Riverpod refuses
/// it. That is not theoretical: a launch holding a refresh token the server has
/// already dropped hits exactly this path, and the app opened on
/// `CircularDependencyError` instead of the login screen.
///
/// A counter breaks it. The client only ever writes here, the controller only
/// ever reads, and the dependency runs one way again.
final sessionEndedProvider = NotifierProvider<SessionEnded, int>(
  SessionEnded.new,
);

class SessionEnded extends Notifier<int> {
  @override
  int build() => 0;

  void raise() => state = state + 1;
}

/// The socket underneath the client, as its own provider so a test can hand the
/// app a scripted one and exercise the real wiring above it rather than a copy
/// of it. [ApiClient] leaves a client it was given open, so this owns the close.
final httpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    baseUrl: AppConfig.apiBaseUrl,
    tokens: ref.watch(tokenStoreProvider),
    httpClient: ref.watch(httpClientProvider),
    onSessionEnded: () => ref.read(sessionEndedProvider.notifier).raise(),
  );
  ref.onDispose(client.close);
  return client;
});

/// Who is signed in, or null. The whole app routes off this one value.
final authControllerProvider = AsyncNotifierProvider<AuthController, AuthUser?>(
  AuthController.new,
);

class AuthController extends AsyncNotifier<AuthUser?> {
  /// Restore the session on launch.
  ///
  /// A stored access token is usually expired by now — it lasts fifteen minutes
  /// and the app was last open yesterday. That is not a reason to ask for a
  /// password: [ApiClient] refreshes and repeats this call, so only a session the
  /// server actually refuses reaches the catch below. This is the entire reason
  /// the API grew refresh tokens.
  @override
  Future<AuthUser?> build() async {
    // Listened to rather than watched, and ignored until this build has settled.
    //
    // A raise *during* this build needs no action: the 401 that caused it is
    // about to make this build return null on its own, which is the sign-out.
    // Reacting anyway would invalidate a build that is still running, and its
    // future then never resolves — the app would sit on a spinner forever.
    // After it has settled, a raise is the session dying under a signed-in user,
    // and that does need another pass.
    var building = true;
    ref.listen(sessionEndedProvider, (_, _) {
      if (!building) ref.invalidateSelf();
    });

    try {
      final tokens = ref.watch(tokenStoreProvider);
      if (await tokens.refreshToken() == null) return null;

      try {
        final body = await ref.watch(apiClientProvider).get('/auth/me');
        return AuthUser.fromJson(
          body['user'] as Map<String, dynamic>? ?? const {},
        );
      } on ApiException catch (err) {
        if (err.isUnauthorized) return null;
        rethrow; // a network failure is worth showing, not a silent sign-out
      }
    } finally {
      building = false;
    }
  }

  Future<void> signIn({
    required String mobile,
    required String password,
  }) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      final body = await ref
          .read(apiClientProvider)
          .post('/auth/login', body: {'mobile': mobile, 'password': password});
      final session = Session.fromJson(body);
      await ref
          .read(tokenStoreProvider)
          .save(
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
          );
      return session.user;
    });
  }

  /// Sign out, telling the server so the refresh token stops working.
  ///
  /// The refresh token outlives the app, so dropping it locally would leave a
  /// session the API would still renew for ninety days. The call is awaited but
  /// never allowed to fail the sign-out — the tokens go either way, and someone
  /// who asked to leave must not be held on the screen by a dropped request.
  Future<void> signOut() async {
    final tokens = ref.read(tokenStoreProvider);
    final refreshToken = await tokens.refreshToken();
    if (refreshToken != null) {
      try {
        await ref
            .read(apiClientProvider)
            .post('/auth/logout', body: {'refreshToken': refreshToken});
      } on ApiException {
        // Already gone, or unreachable. Either way the session ends here.
      }
    }
    await tokens.clear();
    state = const AsyncValue.data(null);
  }
}

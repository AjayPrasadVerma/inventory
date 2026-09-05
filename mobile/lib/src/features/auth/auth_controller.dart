import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../api/api_exception.dart';
import '../../api/token_store.dart';
import '../../config/app_config.dart';
import '../../models/auth.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    baseUrl: AppConfig.apiBaseUrl,
    tokens: ref.watch(tokenStoreProvider),
    // Reached when refreshing was tried and the session is over anyway. Read
    // lazily — by the time this fires both providers exist, so there is no cycle
    // between the client and the controller that uses it.
    onSessionEnded: () =>
        ref.read(authControllerProvider.notifier).forgetSession(),
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

  /// The session ended underneath us — the owner removed this user, or a refresh
  /// token was replayed and the API ended every session. Tokens are already
  /// cleared by the client; this is only the app catching up.
  void forgetSession() {
    if (state.value != null || state.hasError) {
      state = const AsyncValue.data(null);
    }
  }
}

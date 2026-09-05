import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the two tokens live between launches.
///
/// An interface rather than the plugin directly, for two reasons. The tests need
/// a store that works on a plain Dart VM — `flutter_secure_storage` talks to the
/// Android Keystore and has nothing to talk to there. And the refresh logic in
/// [ApiClient] is the part worth testing hard, so it must not be welded to a
/// platform channel.
abstract class TokenStore {
  Future<String?> accessToken();
  Future<String?> refreshToken();

  /// Written together, always. A refresh token without its access token — or the
  /// reverse — is half a session, and the half that is missing is discovered at
  /// the worst moment.
  Future<void> save({
    required String accessToken,
    required String refreshToken,
  });

  Future<void> clear();
}

/// The real one: Android Keystore / iOS Keychain.
///
/// MOBILE.md is explicit that this must not be `SharedPreferences`. A refresh
/// token is good for ninety days and buys new access tokens the whole time;
/// `SharedPreferences` is a plain XML file, readable on a rooted phone by
/// anything that asks.
class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _accessKey = 'dbw_access_token';
  static const _refreshKey = 'dbw_refresh_token';

  final FlutterSecureStorage _storage;

  @override
  Future<String?> accessToken() => _storage.read(key: _accessKey);

  @override
  Future<String?> refreshToken() => _storage.read(key: _refreshKey);

  @override
  Future<void> save({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  @override
  Future<void> clear() async {
    // Not deleteAll: this app is the only writer today, but a store wiped by key
    // cannot take something else's data with it tomorrow.
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}

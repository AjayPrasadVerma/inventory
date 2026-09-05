/// Where the app looks for the API.
///
/// The default is the Android emulator's address for the host machine, because
/// that is where this gets run while it is being written. `localhost` inside the
/// emulator is the emulator itself, not the developer's laptop — MOBILE.md calls
/// this out because it costs an afternoon the first time.
///
/// Override without editing anything:
///
///   flutter run --dart-define=API_BASE_URL=https://inventory.acronix.in/api
///
/// A release build should always pass the real one; see the cleartext note in
/// `android/app/src/debug/AndroidManifest.xml` for why plain http only works in
/// debug anyway.
class AppConfig {
  const AppConfig._();

  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/api',
  );
}

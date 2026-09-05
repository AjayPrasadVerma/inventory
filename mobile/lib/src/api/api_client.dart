import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/auth.dart';
import '../models/json.dart';
import 'api_exception.dart';
import 'token_store.dart';

/// The HTTP client every screen goes through.
///
/// Hand-rolled over `package:http` rather than built on dio's interceptors, and
/// deliberately: `frontend/lib/api.ts` solves exactly this problem on the web,
/// MOBILE.md names it the reference implementation, and keeping the two shaped
/// alike means a fix to one is obviously portable to the other. It also stays
/// testable with an ordinary [http.Client] stub, which is what makes the
/// single-flight rule below provable rather than hoped for.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.tokens,
    http.Client? httpClient,
    this.onSessionEnded,
  }) : _baseUrl = baseUrl.endsWith('/')
           ? baseUrl.substring(0, baseUrl.length - 1)
           : baseUrl,
       _http = httpClient ?? http.Client(),
       _ownsHttpClient = httpClient == null;

  /// Paths that must never trigger a refresh: `/auth/refresh` would recurse, and
  /// a 401 from login or logout means what it says rather than "token expired".
  static const _authPaths = ['/auth/login', '/auth/refresh', '/auth/logout'];

  final String _baseUrl;
  final TokenStore tokens;
  final http.Client _http;
  final bool _ownsHttpClient;

  /// Called when the session is over for good — refreshing was tried and did not
  /// help. The app uses it to drop the signed-in user and show the login screen,
  /// wherever in the app the request happened to come from.
  final void Function()? onSessionEnded;

  void close() {
    if (_ownsHttpClient) _http.close();
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, Object?>? query,
  }) => _request('GET', path, query: query);

  Future<Map<String, dynamic>> post(String path, {Object? body}) =>
      _request('POST', path, body: body);

  Future<Map<String, dynamic>> patch(String path, {Object? body}) =>
      _request('PATCH', path, body: body);

  Uri _uri(String path, [Map<String, Object?>? query]) {
    final uri = Uri.parse('$_baseUrl$path');
    if (query == null || query.isEmpty) return uri;
    final params = <String, String>{};
    for (final entry in query.entries) {
      final value = entry.value;
      if (value == null || value == '') continue;
      params[entry.key] = '$value';
    }
    return uri.replace(queryParameters: {...uri.queryParameters, ...params});
  }

  Future<http.Response> _send(
    String method,
    String path, {
    Object? body,
    Map<String, Object?>? query,
  }) async {
    // Read inside _send, not once per request: a retry after a refresh has to
    // pick up the new token rather than repeat the expired one.
    final token = await tokens.accessToken();
    final request = http.Request(method, _uri(path, query))
      ..headers['Content-Type'] = 'application/json'
      ..headers['Accept'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) request.body = jsonEncode(body);

    try {
      return await http.Response.fromStream(await _http.send(request));
    } on ApiException {
      rethrow;
    } catch (err) {
      throw ApiException.network(err);
    }
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Object? body,
    Map<String, Object?>? query,
  }) async {
    final isAuthPath = _authPaths.any(path.startsWith);
    var response = await _send(method, path, body: body, query: query);

    // An expired access token is an ordinary event, not the end of the session:
    // refresh once and repeat the request. Only once — if the second attempt is
    // refused too, the problem is not the token's age.
    if (response.statusCode == 401 && !isAuthPath) {
      if (await _refreshSession()) {
        response = await _send(method, path, body: body, query: query);
      }
    }

    return _decode(response, path: path, isAuthPath: isAuthPath);
  }

  /// One refresh at a time, shared by everyone waiting on it.
  ///
  /// This is the part that has to be right, and MOBILE.md says so outright.
  /// Refresh tokens rotate — using one spends it — so a screen that fires four
  /// requests and lets all four refresh on their 401s would spend the same token
  /// four times. The API reads a spent token as a replay it cannot tell apart
  /// from theft, and answers by ending **every** session that user has. Four
  /// parallel refreshes would sign the shop out of every device it owns.
  ///
  /// So the first caller starts the refresh and the rest await the same future.
  Future<bool>? _inFlight;

  Future<bool> _refreshSession() {
    final existing = _inFlight;
    if (existing != null) return existing;

    final started = _runRefresh();
    _inFlight = started;
    return started.whenComplete(() => _inFlight = null);
  }

  Future<bool> _runRefresh() async {
    final refreshToken = await tokens.refreshToken();
    if (refreshToken == null) return false;

    late final http.Response response;
    try {
      response = await _send(
        'POST',
        '/auth/refresh',
        body: {'refreshToken': refreshToken},
      );
    } on ApiException {
      // The link dropped mid-refresh. Report failure without deciding anything
      // else — the caller's 401 handling takes it from here, and a dropped
      // socket must not look like a revoked session.
      return false;
    }
    if (response.statusCode != 200) return false;

    try {
      final session = Session.fromJson(_json(response, '/auth/refresh'));
      await tokens.save(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      );
      return true;
    } on ApiContractException {
      rethrow; // a changed payload is a bug to see, not a sign-out to swallow
    }
  }

  Map<String, dynamic> _json(http.Response response, String path) {
    if (response.body.isEmpty) return const {};
    final Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw ApiContractException(
        '$path: reply was not JSON (${response.statusCode}).',
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw ApiContractException(
        '$path: expected a JSON object, got ${decoded.runtimeType}.',
      );
    }
    return decoded;
  }

  Future<Map<String, dynamic>> _decode(
    http.Response response, {
    required String path,
    required bool isAuthPath,
  }) async {
    final body = _json(response, path);

    if (response.statusCode == 401) {
      // Refreshing was tried and did not help, so the session is genuinely over.
      // Not for the auth paths: a 401 from login means the credentials were
      // wrong, and clearing a session the user never had helps nobody.
      if (!isAuthPath) {
        // Awaited, so nothing can read a token this call has already decided is
        // dead — a fire-and-forget clear leaves that to luck.
        await tokens.clear();
        onSessionEnded?.call();
      }
      throw ApiException(401, _error(body) ?? 'Please sign in again.');
    }

    if (response.statusCode >= 400) {
      throw ApiException(
        response.statusCode,
        _error(body) ?? 'Something went wrong. Please try again.',
      );
    }

    return body;
  }

  String? _error(Map<String, dynamic> body) {
    final error = body['error'];
    return error is String && error.isNotEmpty ? error : null;
  }
}

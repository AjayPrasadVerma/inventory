import 'dart:async';
import 'dart:convert';

import 'package:acronix_inventory/src/api/token_store.dart';
import 'package:http/http.dart' as http;

/// A store that works on the Dart VM. The real one talks to the Android
/// Keystore, which is not there in a unit test.
class InMemoryTokenStore implements TokenStore {
  InMemoryTokenStore({this.access, this.refresh});

  String? access;
  String? refresh;
  int clears = 0;

  @override
  Future<String?> accessToken() async => access;

  @override
  Future<String?> refreshToken() async => refresh;

  @override
  Future<void> save({
    required String accessToken,
    required String refreshToken,
  }) async {
    access = accessToken;
    refresh = refreshToken;
  }

  @override
  Future<void> clear() async {
    clears++;
    access = null;
    refresh = null;
  }
}

/// One recorded request, so a test can assert what actually went over the wire.
class SentRequest {
  SentRequest(this.method, this.url, this.authorization, this.body);

  final String method;
  final Uri url;
  final String? authorization;
  final String body;

  String get path => url.path;
}

/// A scripted http.Client.
///
/// [handler] receives each request and returns the status and JSON body to
/// answer with. Every request is recorded in [sent]. [gate], when set, is
/// awaited before any response is produced — which is how a test holds several
/// requests in flight at once.
class FakeHttpClient extends http.BaseClient {
  FakeHttpClient(this.handler);

  final (int, Map<String, Object?>) Function(SentRequest request) handler;
  final List<SentRequest> sent = [];
  Completer<void>? gate;

  /// Paths where the socket dies instead of answering, the way the shop's link
  /// does. The request is still recorded — it was sent, it just got nothing back.
  final Set<String> failPaths = {};

  List<SentRequest> requestsTo(String path) =>
      sent.where((r) => r.path == path).toList();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final body = request is http.Request ? request.body : '';
    final record = SentRequest(
      request.method,
      request.url,
      request.headers['Authorization'],
      body,
    );
    sent.add(record);

    if (failPaths.contains(record.path)) {
      throw const SocketFailure();
    }
    if (gate != null) await gate!.future;

    final (status, payload) = handler(record);
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(payload))),
      status,
      request: request,
      headers: {'content-type': 'application/json'},
    );
  }
}

/// What a dropped connection looks like to the client.
class SocketFailure implements Exception {
  const SocketFailure();

  @override
  String toString() => 'connection closed';
}

Map<String, Object?> sessionPayload({
  required String access,
  required String refresh,
  String name = 'Dev Owner',
  String role = 'owner',
  int id = 1,
}) => {
  'token': access,
  'accessToken': access,
  'refreshToken': refresh,
  'user': {'id': id, 'name': name, 'role': role},
};

/// The refresh interceptor.
///
/// Three things are worth holding down, and they are the three that would be
/// expensive to discover in the shop.
///
/// One: an expired access token is renewed and the request repeated, rather than
/// throwing the user back to the login screen. That is the whole reason the API
/// grew refresh tokens.
///
/// Two, and this is the one MOBILE.md calls out: several requests hitting 401
/// together must produce exactly ONE refresh. Refresh tokens rotate, so a second
/// use of the same one is read by the API as a replay it cannot tell apart from
/// theft — and it answers by ending every session that user has. A broken
/// single-flight here signs the shop out of every device it owns, and it would
/// only show up on a screen that happens to make parallel calls.
///
/// Three: when refreshing genuinely does not help, the tokens are cleared and
/// the app is told once, so it can return to the login screen.
library;

import 'dart:async';

import 'package:acronix_inventory/src/api/api_client.dart';
import 'package:acronix_inventory/src/api/api_exception.dart';
import 'package:acronix_inventory/src/models/json.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fakes.dart';

void main() {
  late InMemoryTokenStore tokens;
  late int sessionEndedCalls;

  ApiClient clientFor(FakeHttpClient http) => ApiClient(
    baseUrl: 'http://api.test/api',
    tokens: tokens,
    httpClient: http,
    onSessionEnded: () => sessionEndedCalls++,
  );

  setUp(() {
    tokens = InMemoryTokenStore(access: 'expired-access', refresh: 'refresh-1');
    sessionEndedCalls = 0;
  });

  group('ordinary requests', () {
    test('sends the access token and returns the decoded body', () async {
      final http = FakeHttpClient(
        (r) => (
          200,
          {
            'user': {'id': 1},
          },
        ),
      );
      final body = await clientFor(http).get('/auth/me');

      expect(body['user'], {'id': 1});
      expect(http.sent.single.authorization, 'Bearer expired-access');
    });

    test('puts query parameters on the URL, dropping the empty ones', () async {
      final http = FakeHttpClient((r) => (200, const {}));
      await clientFor(http).get(
        '/items',
        query: {'q': 'velvet', 'page': 2, 'colour': null, 'size': ''},
      );

      final url = http.sent.single.url;
      expect(url.path, '/api/items');
      // A null or empty filter means "not filtering", so it must not go on the
      // URL as `colour=` — the backend would read that as a real empty value.
      expect(url.queryParameters, {'q': 'velvet', 'page': '2'});
    });

    test('surfaces the sentence the API sent, not a generic one', () async {
      final http = FakeHttpClient(
        (r) => (409, {'error': 'Ramesh already uses this mobile number.'}),
      );

      await expectLater(
        clientFor(http).post('/auth/users', body: const {}),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'statusCode', 409)
              .having(
                (e) => e.message,
                'message',
                'Ramesh already uses this mobile number.',
              ),
        ),
      );
    });
  });

  group('an expired access token', () {
    test('refreshes and repeats the request', () async {
      final http = FakeHttpClient((r) {
        if (r.path == '/api/auth/refresh') {
          return (
            200,
            sessionPayload(access: 'access-2', refresh: 'refresh-2'),
          );
        }
        // Refused while the old token is presented, fine once it is renewed.
        return r.authorization == 'Bearer access-2'
            ? (
                200,
                {
                  'user': {'id': 7, 'name': 'Dev Owner', 'role': 'owner'},
                },
              )
            : (401, {'error': 'Session expired, please log in again.'});
      });

      final body = await clientFor(http).get('/auth/me');

      expect((body['user']! as Map)['id'], 7);
      expect(http.requestsTo('/api/auth/refresh'), hasLength(1));
      expect(http.requestsTo('/api/auth/me'), hasLength(2));
      expect(sessionEndedCalls, 0);
    });

    test('stores the rotated refresh token, not the spent one', () async {
      final http = FakeHttpClient((r) {
        if (r.path == '/api/auth/refresh') {
          return (
            200,
            sessionPayload(access: 'access-2', refresh: 'refresh-2'),
          );
        }
        return r.authorization == 'Bearer access-2'
            ? (200, const {})
            : (401, const {});
      });

      await clientFor(http).get('/auth/me');

      expect(await tokens.accessToken(), 'access-2');
      // Keeping refresh-1 would replay a spent token on the next refresh, which
      // the API reads as theft.
      expect(await tokens.refreshToken(), 'refresh-2');
    });

    test(
      'tries exactly once — a second 401 is not the token being old',
      () async {
        final http = FakeHttpClient((r) {
          if (r.path == '/api/auth/refresh') {
            return (
              200,
              sessionPayload(access: 'access-2', refresh: 'refresh-2'),
            );
          }
          return (
            401,
            {
              'error':
                  'Your access has been removed. Please contact the owner.',
            },
          );
        });

        await expectLater(
          clientFor(http).get('/auth/me'),
          throwsA(
            isA<ApiException>().having((e) => e.statusCode, 'statusCode', 401),
          ),
        );
        expect(http.requestsTo('/api/auth/refresh'), hasLength(1));
        expect(http.requestsTo('/api/auth/me'), hasLength(2));
      },
    );
  });

  group('parallel requests refresh only once', () {
    test('four simultaneous 401s produce a single refresh call', () async {
      final http = FakeHttpClient((r) {
        if (r.path == '/api/auth/refresh') {
          return (
            200,
            sessionPayload(access: 'access-2', refresh: 'refresh-2'),
          );
        }
        return r.authorization == 'Bearer access-2'
            ? (200, const {'ok': true})
            : (401, const {});
      });
      final client = clientFor(http);

      // Held open so all four reach their 401 before any refresh can finish —
      // which is exactly the dashboard loading its cards on a slow link.
      http.gate = Completer<void>();
      final calls = Future.wait([
        client.get('/vendors'),
        client.get('/karigars'),
        client.get('/items'),
        client.get('/products'),
      ]);
      await Future<void>.delayed(Duration.zero);
      http.gate!.complete();
      http.gate = null;

      await calls;

      // The assertion the whole file exists for. Four would spend the same
      // refresh token four times and end every session this user has.
      expect(http.requestsTo('/api/auth/refresh'), hasLength(1));
      expect(await tokens.refreshToken(), 'refresh-2');
      expect(sessionEndedCalls, 0);
    });

    test('a later refresh is allowed — single-flight is per burst, not once ever', () async {
      // The guard must reset once a burst finishes. Latching it permanently
      // would look fine all morning and then strand the app the first time the
      // second access token expired.
      var issued = 1;
      final http = FakeHttpClient((r) {
        if (r.path == '/api/auth/refresh') {
          issued++;
          return (
            200,
            sessionPayload(
              access: 'access-$issued',
              refresh: 'refresh-$issued',
            ),
          );
        }
        return r.authorization == 'Bearer access-$issued'
            ? (200, const {})
            : (401, const {});
      });
      final client = clientFor(http);

      await client.get('/vendors');
      expect(http.requestsTo('/api/auth/refresh'), hasLength(1));

      // Time passes and the token minted by that refresh expires too.
      tokens.access = 'expired-again';
      await client.get('/karigars');

      expect(http.requestsTo('/api/auth/refresh'), hasLength(2));
      expect(await tokens.accessToken(), 'access-3');
    });
  });

  group('when the session is really over', () {
    test('clears the tokens and reports it once', () async {
      final http = FakeHttpClient((r) {
        if (r.path == '/api/auth/refresh') {
          return (
            401,
            {'error': 'Your session has ended. Please sign in again.'},
          );
        }
        return (401, {'error': 'Session expired, please log in again.'});
      });

      await expectLater(
        clientFor(http).get('/auth/me'),
        throwsA(isA<ApiException>()),
      );

      expect(await tokens.refreshToken(), isNull);
      expect(await tokens.accessToken(), isNull);
      expect(sessionEndedCalls, 1);
    });

    test('does not refresh, clear or report for a failed sign-in', () async {
      // A 401 from login means the password was wrong. Clearing a session the
      // user does not have yet, or announcing that one ended, would be nonsense.
      tokens = InMemoryTokenStore();
      final http = FakeHttpClient(
        (r) => (401, {'error': 'Incorrect mobile number or password.'}),
      );

      await expectLater(
        clientFor(http)
            .post('/auth/login', body: const {'mobile': '1', 'password': 'x'}),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'Incorrect mobile number or password.',
          ),
        ),
      );
      expect(http.requestsTo('/api/auth/refresh'), isEmpty);
      expect(tokens.clears, 0);
      expect(sessionEndedCalls, 0);
    });

    test('does not try to refresh when there is no refresh token', () async {
      tokens = InMemoryTokenStore(access: 'expired-access');
      final http = FakeHttpClient((r) => (401, const {}));

      await expectLater(
        clientFor(http).get('/auth/me'),
        throwsA(isA<ApiException>()),
      );
      expect(http.requestsTo('/api/auth/refresh'), isEmpty);
    });
  });

  group('failures that are not the session', () {
    test('a dropped link during refresh is not mistaken for a good reply', () async {
      // The socket dying mid-refresh must not look like a renewed session: the
      // refresh token is still good, and the shop's link drops all day.
      final http = FakeHttpClient((r) => (401, const {}))
        ..failPaths.add('/api/auth/refresh');

      await expectLater(
        clientFor(http).get('/auth/me'),
        throwsA(isA<ApiException>()),
      );
      // It was attempted once, it failed, and the original 401 stands — nothing
      // retried the request as though the token had been renewed.
      expect(http.requestsTo('/api/auth/refresh'), hasLength(1));
      expect(http.requestsTo('/api/auth/me'), hasLength(1));
    });

    test('a changed payload is reported as drift, not swallowed', () async {
      // MOBILE.md's "one real risk": Dart cannot see Express, so a renamed field
      // has to fail loudly and say which one.
      final http = FakeHttpClient((r) {
        if (r.path == '/api/auth/refresh') {
          return (
            200,
            {
              'accessToken': 'access-2',
              'user': {'id': 1, 'name': 'x', 'role': 'owner'},
            },
          );
        }
        return (401, const {});
      });

      await expectLater(
        clientFor(http).get('/auth/me'),
        throwsA(
          isA<ApiContractException>().having(
            (e) => e.message,
            'message',
            contains('refreshToken'),
          ),
        ),
      );
    });
  });
}

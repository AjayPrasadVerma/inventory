/// Decoding the auth payloads.
///
/// MOBILE.md's "one real risk" is that nothing connects the Express payloads to
/// these classes: a field renamed in `backend/src/modules/**` still compiles
/// here and breaks on a phone, in the shop. These tests pin the shape the API
/// actually sends today, so a change to it fails on a laptop instead.
///
/// The payloads below are copied from a real response — see the contract table
/// in MOBILE.md.
library;

import 'package:acronix_inventory/src/models/auth.dart';
import 'package:acronix_inventory/src/models/json.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> loginResponse() => {
    'token': 'jwt-value',
    'accessToken': 'jwt-value',
    'refreshToken': 'opaque-value',
    'user': {'id': 3, 'name': 'Dev Owner', 'role': 'owner'},
  };

  group('Session', () {
    test('decodes what POST /api/auth/login returns', () {
      final session = Session.fromJson(loginResponse());

      expect(session.accessToken, 'jwt-value');
      expect(session.refreshToken, 'opaque-value');
      expect(session.user.id, 3);
      expect(session.user.name, 'Dev Owner');
      expect(session.user.role, Role.owner);
      expect(session.user.isOwner, isTrue);
    });

    test('reads accessToken in preference to the token alias', () {
      // The API sends the access token twice; `token` is the old name kept for
      // the web frontend. Mobile reads the new one, so that the day the alias is
      // dropped nothing here changes.
      final json = loginResponse()..['token'] = 'stale-alias';
      expect(Session.fromJson(json).accessToken, 'jwt-value');
    });

    test('still works if the token alias is the only one left', () {
      final json = loginResponse()..remove('accessToken');
      expect(Session.fromJson(json).accessToken, 'jwt-value');
    });

    test('names the missing field when the payload changes', () {
      final json = loginResponse()..remove('refreshToken');

      expect(
        () => Session.fromJson(json),
        throwsA(
          isA<ApiContractException>().having(
            (e) => e.message,
            'message',
            allOf(contains('Session'), contains('refreshToken')),
          ),
        ),
      );
    });

    test('does not accept a session without a user', () {
      final json = loginResponse()..remove('user');
      expect(
        () => Session.fromJson(json),
        throwsA(isA<ApiContractException>()),
      );
    });
  });

  group('AuthUser', () {
    test('decodes staff', () {
      final user = AuthUser.fromJson({
        'id': 9,
        'name': 'Ramesh',
        'role': 'staff',
      });
      expect(user.role, Role.staff);
      expect(user.isOwner, isFalse);
    });

    test('refuses a role it does not know rather than guessing', () {
      // Silently defaulting an unknown role to staff would hide a backend change
      // behind a permissions bug, which is the worst way to find one.
      expect(
        () => AuthUser.fromJson({'id': 1, 'name': 'X', 'role': 'manager'}),
        throwsA(
          isA<ApiContractException>().having(
            (e) => e.message,
            'message',
            contains('manager'),
          ),
        ),
      );
    });

    test('says which field is wrong when an id goes missing', () {
      expect(
        () => AuthUser.fromJson({'name': 'X', 'role': 'staff'}),
        throwsA(
          isA<ApiContractException>().having(
            (e) => e.message,
            'message',
            allOf(contains('AuthUser'), contains('id')),
          ),
        ),
      );
    });
  });
}

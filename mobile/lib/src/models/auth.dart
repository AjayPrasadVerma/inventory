import 'json.dart';

/// Everything `POST /api/auth/login`, `POST /api/auth/refresh` and
/// `GET /api/auth/me` return. One file per endpoint group, per MOBILE.md — and
/// nothing outside `lib/src/models/` may call `jsonDecode` on an API reply.

enum Role {
  owner,
  staff;

  static Role parse(String value, {required String owner}) {
    for (final role in Role.values) {
      if (role.name == value) return role;
    }
    throw ApiContractException(
      '$owner: role "$value" is not one of ${Role.values.map((r) => r.name).join(', ')}. '
      'If the backend has added a role, add it here too.',
    );
  }
}

class AuthUser {
  const AuthUser({required this.id, required this.name, required this.role});

  final int id;
  final String name;
  final Role role;

  bool get isOwner => role == Role.owner;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    const owner = 'AuthUser';
    return AuthUser(
      id: requireInt(json, 'id', owner: owner),
      name: requireString(json, 'name', owner: owner),
      role: Role.parse(requireString(json, 'role', owner: owner), owner: owner),
    );
  }

  @override
  String toString() => 'AuthUser(id: $id, name: $name, role: ${role.name})';
}

/// A signed-in session: the short access token, the long refresh token, and who
/// the tokens belong to.
class Session {
  const Session({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
  });

  final String accessToken;
  final String refreshToken;
  final AuthUser user;

  /// The API sends the access token twice, as `accessToken` and as `token`.
  /// `token` is the older name, kept because the web frontend reads exactly that
  /// field and renaming it would have signed everyone out at a deploy; MOBILE.md
  /// says mobile should read `accessToken`. Falling back to `token` costs one
  /// line and means the day the alias is finally dropped, nothing here breaks.
  factory Session.fromJson(Map<String, dynamic> json) {
    const owner = 'Session';
    final access = json.containsKey('accessToken') ? 'accessToken' : 'token';
    return Session(
      accessToken: requireString(json, access, owner: owner),
      refreshToken: requireString(json, 'refreshToken', owner: owner),
      user: AuthUser.fromJson(requireObject(json, 'user', owner: owner)),
    );
  }
}

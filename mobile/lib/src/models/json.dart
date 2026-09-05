/// Decoding helpers shared by every model.
///
/// MOBILE.md calls contract drift the one real risk of this app: nothing
/// connects the Express payloads to these classes, so a field renamed in
/// `backend/src/modules/**` compiles here perfectly and fails on a phone, in the
/// shop. Nothing in Dart can prevent that. What these helpers can do is make the
/// failure say which field, in which payload, instead of
/// "type 'Null' is not a subtype of type 'String'" thrown from somewhere in a
/// widget build.
library;

/// Thrown when the API sends a shape the models do not recognise.
///
/// Separate from [ApiException] on purpose: that one means the server said no,
/// this one means the server said something we could not read, which is a bug in
/// this app or a change in the API — never something the user did.
class ApiContractException implements Exception {
  ApiContractException(this.message);

  final String message;

  @override
  String toString() => 'ApiContractException: $message';
}

Never _drift(String owner, String key, Object? actual) {
  final saw = actual == null ? 'nothing' : '${actual.runtimeType} ($actual)';
  throw ApiContractException(
    '$owner: expected a value at "$key" but saw $saw. '
    'The API payload has probably changed — check the matching route in '
    'backend/src/modules/ and update the model in lib/src/models/.',
  );
}

String requireString(
  Map<String, dynamic> json,
  String key, {
  required String owner,
}) {
  final value = json[key];
  if (value is String && value.isNotEmpty) return value;
  _drift(owner, key, value);
}

int requireInt(Map<String, dynamic> json, String key, {required String owner}) {
  final value = json[key];
  if (value is int) return value;
  // JSON numbers arrive as double when they carry a decimal point; an id never
  // should, but tolerating it costs nothing and a crash here is expensive.
  if (value is num && value == value.roundToDouble()) return value.toInt();
  _drift(owner, key, value);
}

Map<String, dynamic> requireObject(
  Map<String, dynamic> json,
  String key, {
  required String owner,
}) {
  final value = json[key];
  if (value is Map<String, dynamic>) return value;
  _drift(owner, key, value);
}

/// An error the API reported, carrying the sentence it sent.
///
/// Every route in this backend answers a failure as `{ "error": "..." }`, and
/// those sentences are written for the shop rather than for a developer. They go
/// straight on screen; nothing here should invent its own wording when the server
/// has already provided one.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  /// The request never reached the API, or the reply was not a reply.
  factory ApiException.network(Object cause) => ApiException(
    0,
    'Could not reach the server. Check the connection and try again. ($cause)',
  );

  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => 'ApiException($statusCode): $message';
}

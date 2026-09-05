import 'json.dart';

/// What the karigar entry form needs from the API.
///
/// Two endpoints feed it: `/karigars/options` for who, and
/// `/karigars/suggest?direction=` for what — every item name the shop has used
/// in that direction, with the sizes and designs already recorded against each.
///
/// The direction decides which catalogue is searched, so an OUT form never
/// offers a finished box and an IN form never offers raw cloth. That is the
/// server's rule; the app just passes the direction along.

class KarigarOption {
  const KarigarOption({
    required this.id,
    required this.name,
    required this.phone,
  });

  final int id;
  final String name;
  final String? phone;

  factory KarigarOption.fromJson(Map<String, dynamic> json) => KarigarOption(
    id: requireInt(json, 'id', owner: 'KarigarOption'),
    name: requireString(json, 'name', owner: 'KarigarOption'),
    phone: json['phone'] as String?,
  );

  static List<KarigarOption> listFrom(Map<String, dynamic> body) =>
      _list(body, 'data', 'KarigarOption', KarigarOption.fromJson);
}

/// One item the shop has moved in this direction, and what it has been recorded
/// with before.
///
/// The sizes and designs matter more here than on the web. In this shop a big
/// entry is one item in many colours — thirty-five lines of Silk in meters,
/// differing only by design — so these lists are what turns each line into a
/// single tap instead of three fields of typing.
class ItemSuggestion {
  const ItemSuggestion({
    required this.name,
    required this.sizes,
    required this.designs,
  });

  final String name;
  final List<String> sizes;
  final List<String> designs;

  factory ItemSuggestion.fromJson(Map<String, dynamic> json) => ItemSuggestion(
    name: requireString(json, 'name', owner: 'ItemSuggestion'),
    sizes: _strings(json, 'sizes'),
    designs: _strings(json, 'designs'),
  );

  static List<ItemSuggestion> listFrom(Map<String, dynamic> body) =>
      _list(body, 'data', 'ItemSuggestion', ItemSuggestion.fromJson);
}

/// One line the owner has added but not yet saved.
///
/// Held in the app rather than posted one at a time: the route takes the whole
/// entry at once, and an entry half-written to the server would leave stock
/// moved for some lines and not others.
class DraftLine {
  const DraftLine({
    required this.name,
    required this.size,
    required this.design,
    required this.qty,
  });

  final String name;
  final String? size;
  final String? design;
  final double qty;

  /// "Maroon · meter", or whichever half exists.
  String get subtitle =>
      [design, size].where((s) => s != null && s.isNotEmpty).join(' · ');

  Map<String, dynamic> toJson() => {
    'name': name,
    'size': (size == null || size!.isEmpty) ? null : size,
    'design': (design == null || design!.isEmpty) ? null : design,
    'qty': qty,
  };
}

List<String> _strings(Map<String, dynamic> json, String key) {
  final raw = json[key];
  if (raw is! List) return const [];
  return raw
      .whereType<String>()
      .where((s) => s.isNotEmpty)
      .toList(growable: false);
}

List<T> _list<T>(
  Map<String, dynamic> json,
  String key,
  String owner,
  T Function(Map<String, dynamic>) item,
) {
  final raw = json[key];
  if (raw is! List) {
    throw ApiContractException(
      '$owner: expected a list at "$key", saw ${raw.runtimeType}.',
    );
  }
  return raw
      .map(
        (e) => e is Map<String, dynamic>
            ? item(e)
            : throw ApiContractException(
                '$owner: "$key" holds a ${e.runtimeType}.',
              ),
      )
      .toList(growable: false);
}

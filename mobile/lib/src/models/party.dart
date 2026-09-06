import 'json.dart';

/// Someone the shop pays.
///
/// Karigars and vendors live in separate tables and separate endpoints, but the
/// owner recording a payment is thinking of a person, not of which of two menus
/// that person lives under — so the pay form searches both and shows one list,
/// exactly as the website does.
///
/// The type travels with the row rather than being inferred later. A person can
/// be both a karigar and a vendor, and `party_type` is what the payments route
/// needs to know which account to move.
enum PartyType {
  karigar('karigar', 'Karigar'),
  vendor('vendor', 'Vendor');

  const PartyType(this.wire, this.label);

  /// What the API calls it.
  final String wire;
  final String label;
}

class Party {
  const Party({
    required this.type,
    required this.id,
    required this.name,
    required this.phone,
  });

  final PartyType type;
  final int id;
  final String name;
  final String? phone;

  /// Unique across both tables, where an id alone is not.
  String get key => '${type.wire}:$id';

  /// "Karigar · 9812345678", or just the type when there is no number.
  String get subtitle =>
      [type.label, phone].where((s) => s != null && s.isNotEmpty).join(' · ');

  factory Party.fromJson(Map<String, dynamic> json, PartyType type) => Party(
    type: type,
    id: requireInt(json, 'id', owner: 'Party'),
    name: requireString(json, 'name', owner: 'Party'),
    phone: json['phone'] as String?,
  );

  static List<Party> listFrom(Map<String, dynamic> body, PartyType type) {
    final raw = body['data'];
    if (raw is! List) {
      throw ApiContractException(
        'Party: expected a list at "data", saw ${raw.runtimeType}.',
      );
    }
    return raw
        .map(
          (e) => e is Map<String, dynamic>
              ? Party.fromJson(e, type)
              : throw ApiContractException(
                  'Party: "data" holds a ${e.runtimeType}.',
                ),
        )
        .toList(growable: false);
  }
}

/// How the money moved. The website offers exactly these four and stores the
/// label as typed, so the app has to match them rather than invent its own.
const paymentMethods = ['Cash', 'UPI', 'Bank', 'Cheque'];

import 'json.dart';

/// What `GET /api/reports/dashboard` returns.
///
/// One request answers the whole screen — counts, today's activity, category
/// rollups and the low-stock list. That is deliberate on the server side and it
/// is exactly what MOBILE.md asks for: on a slow link the cost is round trips,
/// not payload size, so a screen that needs five answers should ask once.
///
/// The payload also carries `customers` and `salesToday`. They are decoded here
/// because they are in the response, and deliberately not shown: CLAUDE.md §7
/// puts Sale and Customers out of scope.
class DashboardSummary {
  const DashboardSummary({
    required this.rawMaterials,
    required this.products,
    required this.vendors,
    required this.karigars,
    required this.openJobs,
    required this.purchasesToday,
    required this.issuesToday,
    required this.finishedTotal,
    required this.attention,
    required this.finishedByCategory,
    required this.rawByCategory,
  });

  final int rawMaterials;
  final int products;
  final int vendors;
  final int karigars;
  final int openJobs;
  final int purchasesToday;
  final int issuesToday;
  final int finishedTotal;
  final List<AttentionRow> attention;
  final List<CategoryCount> finishedByCategory;
  final List<CategoryCount> rawByCategory;

  int get lowStockCount => attention.length;
  bool get isQuietToday => purchasesToday == 0 && issuesToday == 0;

  /// The route answers `{ "data": { … } }`, so this takes the envelope and
  /// unwraps it — one place that knows the shape, per the models rule.
  factory DashboardSummary.fromEnvelope(Map<String, dynamic> body) =>
      DashboardSummary.fromJson(
        requireObject(body, 'data', owner: 'DashboardSummary'),
      );

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    const owner = 'DashboardSummary';
    return DashboardSummary(
      rawMaterials: requireInt(json, 'rawMaterials', owner: owner),
      products: requireInt(json, 'products', owner: owner),
      vendors: requireInt(json, 'vendors', owner: owner),
      karigars: requireInt(json, 'karigars', owner: owner),
      openJobs: requireInt(json, 'openJobs', owner: owner),
      purchasesToday: requireInt(json, 'purchasesToday', owner: owner),
      issuesToday: requireInt(json, 'issuesToday', owner: owner),
      finishedTotal: requireInt(json, 'finishedTotal', owner: owner),
      attention: _list(json, 'attention', owner, AttentionRow.fromJson),
      finishedByCategory: _list(
        json,
        'finishedByCategory',
        owner,
        CategoryCount.fromJson,
      ),
      rawByCategory: _list(
        json,
        'rawByCategory',
        owner,
        CategoryCount.fromJson,
      ),
    );
  }
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
                '$owner: "$key" holds a ${e.runtimeType}, not an object.',
              ),
      )
      .toList(growable: false);
}

/// One line of stock that needs restocking, or that has been sold past zero.
class AttentionRow {
  const AttentionRow({
    required this.kind,
    required this.name,
    required this.variant,
    required this.unit,
    required this.onHand,
    required this.status,
  });

  final String kind;
  final String name;
  final String? variant;
  final String? unit;

  /// Sent as a string because it is a numeric(…) column and rounding it in
  /// JavaScript would quietly change quantities. Parsed once, here.
  final double onHand;
  final String status;

  bool get isOversold => onHand < 0;

  /// "Velvet · Red · meter" — whichever parts exist.
  String get subtitle =>
      [variant, unit].where((s) => s != null && s.isNotEmpty).join(' · ');

  factory AttentionRow.fromJson(Map<String, dynamic> json) {
    const owner = 'AttentionRow';
    final raw = json['on_hand'];
    final onHand = raw is num ? raw.toDouble() : double.tryParse('$raw');
    if (onHand == null) {
      throw ApiContractException(
        '$owner: "on_hand" is not a number, saw "$raw".',
      );
    }
    return AttentionRow(
      kind: requireString(json, 'kind', owner: owner),
      name: requireString(json, 'name', owner: owner),
      variant: json['variant'] as String?,
      unit: json['unit'] as String?,
      onHand: onHand,
      status: requireString(json, 'status', owner: owner),
    );
  }
}

/// A category rollup — "Saree: 120".
class CategoryCount {
  const CategoryCount({required this.label, required this.value});

  final String label;
  final int value;

  factory CategoryCount.fromJson(Map<String, dynamic> json) => CategoryCount(
    label: requireString(json, 'label', owner: 'CategoryCount'),
    value: requireInt(json, 'value', owner: 'CategoryCount'),
  );
}

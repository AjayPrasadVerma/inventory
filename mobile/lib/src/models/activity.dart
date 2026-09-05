import 'json.dart';

/// What `GET /api/reports/activity?date=YYYY-MM-DD` returns — everything that
/// happened on one day, as a single feed.
///
/// The website calls this "Today's activity" and puts the date behind a control
/// so yesterday is one tap away rather than a different report. Same here.

/// Which of the three columns an event belongs to.
///
/// The shop already reads its khata this way — what came in, what went out, and
/// money — so the app uses the same three, and an event only ever belongs to one
/// of them.
enum ActivitySide { materialIn, materialOut, pay }

enum ActivityKind {
  purchase('Purchase'),
  issue('Material issued'),
  receipt('Goods received'),
  adjustment('Adjustment'),
  payment('Payment');

  const ActivityKind(this.label);

  final String label;

  static ActivityKind parse(String value, {required String owner}) {
    for (final k in ActivityKind.values) {
      if (k.name == value) return k;
    }
    throw ApiContractException(
      '$owner: kind "$value" is not one of ${ActivityKind.values.map((k) => k.name).join(', ')}. '
      'If the backend has added an event type, add it here too.',
    );
  }
}

class DayActivity {
  const DayActivity({required this.paid, required this.events});

  final double paid;
  final List<ActivityEvent> events;

  bool get isEmpty => events.isEmpty;

  List<ActivityEvent> ofSide(ActivitySide side) =>
      events.where((e) => e.side == side).toList(growable: false);

  factory DayActivity.fromEnvelope(Map<String, dynamic> body) {
    const owner = 'DayActivity';
    final data = requireObject(body, 'data', owner: owner);
    final raw = data['events'];
    if (raw is! List) {
      throw ApiContractException(
        '$owner: expected a list at "events", saw ${raw.runtimeType}.',
      );
    }
    final paid = data['paid'];
    return DayActivity(
      paid: paid is num ? paid.toDouble() : double.tryParse('$paid') ?? 0,
      events: raw
          .map(
            (e) => e is Map<String, dynamic>
                ? ActivityEvent.fromJson(e)
                : throw ApiContractException(
                    '$owner: "events" holds a ${e.runtimeType}.',
                  ),
          )
          .toList(growable: false),
    );
  }
}

class ActivityEvent {
  const ActivityEvent({
    required this.kind,
    required this.id,
    required this.party,
    required this.ref,
    required this.amount,
    required this.lines,
  });

  final ActivityKind kind;
  final int id;
  final String? party;
  final String ref;
  final double? amount;
  final List<ActivityLine> lines;

  /// Money is always "pay" and an issue is always "out". An **adjustment** has
  /// no fixed side: it is filed by the sign of its quantity, because a
  /// correction that adds stock is an arrival and one that removes it is not.
  /// Purchases and receipts both bring things into the shop.
  ActivitySide get side {
    switch (kind) {
      case ActivityKind.payment:
        return ActivitySide.pay;
      case ActivityKind.issue:
        return ActivitySide.materialOut;
      case ActivityKind.adjustment:
        return lines.any((l) => l.qty < 0)
            ? ActivitySide.materialOut
            : ActivitySide.materialIn;
      case ActivityKind.purchase:
      case ActivityKind.receipt:
        return ActivitySide.materialIn;
    }
  }

  factory ActivityEvent.fromJson(Map<String, dynamic> json) {
    const owner = 'ActivityEvent';
    final amount = json['amount'];
    final rawLines = json['lines'];
    return ActivityEvent(
      kind: ActivityKind.parse(
        requireString(json, 'kind', owner: owner),
        owner: owner,
      ),
      id: requireInt(json, 'id', owner: owner),
      party: json['party'] as String?,
      ref: requireString(json, 'ref', owner: owner),
      amount: amount == null
          ? null
          : (amount is num ? amount.toDouble() : double.tryParse('$amount')),
      // `lines` is absent for a payment and null-ish for some rows, which is not
      // drift — it is a payment having nothing to list.
      lines: rawLines is List
          ? rawLines
                .whereType<Map<String, dynamic>>()
                .map(ActivityLine.fromJson)
                .toList(growable: false)
          : const [],
    );
  }
}

class ActivityLine {
  const ActivityLine({
    required this.name,
    required this.variant,
    required this.unit,
    required this.qty,
  });

  final String name;
  final String? variant;
  final String? unit;
  final double qty;

  String get subtitle =>
      [variant, unit].where((s) => s != null && s.isNotEmpty).join(' · ');

  factory ActivityLine.fromJson(Map<String, dynamic> json) {
    const owner = 'ActivityLine';
    final raw = json['qty'];
    final qty = raw is num ? raw.toDouble() : double.tryParse('$raw');
    if (qty == null) {
      throw ApiContractException('$owner: "qty" is not a number, saw "$raw".');
    }
    return ActivityLine(
      name: requireString(json, 'name', owner: owner),
      variant: json['variant'] as String?,
      unit: json['unit'] as String?,
      qty: qty,
    );
  }
}

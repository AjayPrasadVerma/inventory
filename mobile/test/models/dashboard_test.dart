/// Decoding the dashboard payload, and the number formatting it feeds.
///
/// The payload below is the real shape of `GET /api/reports/dashboard` — see
/// `backend/src/modules/reports/reports.routes.ts`. Pinning it here is
/// mitigation 1 from MOBILE.md's "one real risk": Dart cannot see Express, so a
/// renamed field has to fail on a laptop rather than on a phone in the shop.
library;

import 'package:acronix_inventory/src/format.dart' as fmt;
import 'package:acronix_inventory/src/models/dashboard.dart';
import 'package:acronix_inventory/src/models/json.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> payload() => {
    'data': {
      'rawMaterials': 12,
      'products': 4,
      'vendors': 3,
      'karigars': 5,
      'customers': 0,
      'openJobs': 2,
      'purchasesToday': 1,
      'salesToday': 0,
      'issuesToday': 3,
      'lowStockCount': 2,
      'attention': [
        {
          'kind': 'raw',
          'name': 'Velvet',
          'variant': 'Red',
          'unit': 'meter',
          'on_hand': '-2.500',
          'status': 'Oversold',
        },
        {
          'kind': 'finished',
          'name': 'Box Large',
          'variant': null,
          'unit': null,
          'on_hand': '3',
          'status': 'Low',
        },
      ],
      'finishedTotal': 2480,
      'finishedByCategory': [
        {'label': 'Saree', 'value': 1200},
      ],
      'rawByCategory': [
        {'label': 'Kapda', 'value': 8},
      ],
    },
  };

  group('DashboardSummary', () {
    test('decodes the envelope the route actually sends', () {
      final d = DashboardSummary.fromEnvelope(payload());

      expect(d.rawMaterials, 12);
      expect(d.products, 4);
      expect(d.openJobs, 2);
      expect(d.finishedTotal, 2480);
      expect(d.finishedByCategory.single.label, 'Saree');
      expect(d.rawByCategory.single.value, 8);
    });

    test('counts attention rows itself rather than trusting lowStockCount', () {
      // The server sends both the list and a count. Deriving it from the list
      // means the badge can never disagree with the rows underneath it.
      final json = payload();
      (json['data']! as Map<String, dynamic>)['lowStockCount'] = 99;

      expect(DashboardSummary.fromEnvelope(json).lowStockCount, 2);
    });

    test('knows when nothing has happened today', () {
      final json = payload();
      final data = json['data']! as Map<String, dynamic>;
      expect(DashboardSummary.fromEnvelope(json).isQuietToday, isFalse);

      data['purchasesToday'] = 0;
      data['issuesToday'] = 0;
      expect(DashboardSummary.fromEnvelope(json).isQuietToday, isTrue);
    });

    test('names the field when the payload drifts', () {
      final json = payload();
      (json['data']! as Map<String, dynamic>).remove('openJobs');

      expect(
        () => DashboardSummary.fromEnvelope(json),
        throwsA(
          isA<ApiContractException>().having(
            (e) => e.message,
            'message',
            allOf(contains('DashboardSummary'), contains('openJobs')),
          ),
        ),
      );
    });

    test('refuses a list that is not a list', () {
      final json = payload();
      (json['data']! as Map<String, dynamic>)['attention'] = 'none';

      expect(
        () => DashboardSummary.fromEnvelope(json),
        throwsA(
          isA<ApiContractException>().having(
            (e) => e.message,
            'message',
            contains('attention'),
          ),
        ),
      );
    });
  });

  group('AttentionRow', () {
    test('parses on_hand from the string the API sends', () {
      // numeric(…) arrives as a string so JavaScript cannot round it. Reading it
      // as a double here is the one place that conversion happens.
      final rows = DashboardSummary.fromEnvelope(payload()).attention;

      expect(rows.first.onHand, -2.5);
      expect(rows.first.isOversold, isTrue);
      expect(rows.last.onHand, 3);
      expect(rows.last.isOversold, isFalse);
    });

    test('builds a subtitle from whichever parts exist', () {
      final rows = DashboardSummary.fromEnvelope(payload()).attention;

      expect(rows.first.subtitle, 'Red · meter');
      // Nulls must not become "null · null", which is what string interpolation
      // would have produced.
      expect(rows.last.subtitle, '');
    });

    test('rejects an unreadable quantity instead of showing zero', () {
      expect(
        () => AttentionRow.fromJson({
          'kind': 'raw',
          'name': 'X',
          'on_hand': 'lots',
          'status': 'Low',
        }),
        throwsA(isA<ApiContractException>()),
      );
    });
  });

  group('formatting matches the website', () {
    test('groups digits the Indian way', () {
      // toLocaleString("en-IN") — 1,23,456 rather than 123,456.
      expect(fmt.count(0), '0');
      expect(fmt.count(999), '999');
      expect(fmt.count(1234), '1,234');
      expect(fmt.count(123456), '1,23,456');
      expect(fmt.count(12345678), '1,23,45,678');
    });

    test('keeps the sign on oversold stock', () {
      expect(fmt.count(-5), '-5');
      expect(fmt.qty(-2.5), '-2.5');
    });

    test('trims trailing zeros off quantities', () {
      expect(fmt.qty(3), '3');
      expect(fmt.qty(2.5), '2.5');
      expect(fmt.qty(2.500), '2.5');
      expect(fmt.qty(1234.75), '1,234.75');
    });
  });
}

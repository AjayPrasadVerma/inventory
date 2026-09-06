/// Decoding the two picker payloads the pay form merges into one list.
///
/// The payloads below are the real shape of `GET /api/karigars/options` and
/// `GET /api/vendors/options` — see the `/options` route in each module. Pinning
/// them here is mitigation 1 from MOBILE.md's "one real risk": Dart cannot see
/// Express, so a renamed field has to fail on a laptop rather than on a phone in
/// the shop.
library;

import 'package:acronix_inventory/src/models/json.dart';
import 'package:acronix_inventory/src/models/party.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> karigars() => {
    'data': [
      {'id': 4, 'name': 'Salim', 'phone': '9812345678'},
      {'id': 7, 'name': 'Imran bhai', 'phone': null},
    ],
  };

  Map<String, dynamic> vendors() => {
    'data': [
      {
        'id': 2,
        'name': 'Ramesh Textiles',
        'phone': '9800000000',
        'city': 'Jaipur',
      },
    ],
  };

  group('Party', () {
    test('takes its type from the endpoint it came from', () {
      final k = Party.listFrom(karigars(), PartyType.karigar);
      final v = Party.listFrom(vendors(), PartyType.vendor);

      expect(k.map((p) => p.type), everyElement(PartyType.karigar));
      expect(v.single.type, PartyType.vendor);
      expect(v.single.name, 'Ramesh Textiles');
    });

    test('keys stay distinct when a karigar and a vendor share an id', () {
      // Two tables, two id sequences. Keyed on the id alone, a vendor would
      // silently replace a karigar in the merged list.
      final k = Party.listFrom({
        'data': [
          {'id': 4, 'name': 'Salim', 'phone': null},
        ],
      }, PartyType.karigar).single;
      final v = Party.listFrom({
        'data': [
          {'id': 4, 'name': 'Ramesh Textiles', 'phone': null},
        ],
      }, PartyType.vendor).single;

      expect(k.key, 'karigar:4');
      expect(v.key, 'vendor:4');
      expect(k.key == v.key, isFalse);
    });

    test('says which kind of party it is, with the phone when there is one', () {
      final all = Party.listFrom(karigars(), PartyType.karigar);
      expect(all[0].subtitle, 'Karigar · 9812345678');
      // No number recorded — the row still has to say what kind of party it is.
      expect(all[1].subtitle, 'Karigar');
    });

    test('sends the wire name the payments route expects', () {
      expect(PartyType.karigar.wire, 'karigar');
      expect(PartyType.vendor.wire, 'vendor');
    });

    test('refuses a payload whose shape has moved', () {
      expect(
        () => Party.listFrom({'data': 'nope'}, PartyType.karigar),
        throwsA(isA<ApiContractException>()),
      );
      expect(
        () => Party.listFrom({
          'data': [
            {'name': 'No id here'},
          ],
        }, PartyType.vendor),
        throwsA(isA<ApiContractException>()),
      );
    });
  });

  test('payment modes match the four the website offers', () {
    // The website stores the label as typed, so a fifth mode here would write a
    // value no khata page knows how to show.
    expect(paymentMethods, ['Cash', 'UPI', 'Bank', 'Cheque']);
  });
}

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../models/party.dart';
import '../auth/auth_controller.dart';

/// Who the shop can pay, searched on the server.
///
/// Two endpoints, one list. Both are asked at once rather than one after the
/// other — they are independent, and a payment form that takes two round trips
/// to show its first suggestion is a form nobody waits for.
class PartyDirectory {
  const PartyDirectory(this._api);

  final ApiClient _api;

  Future<List<Party>> search(String q) async {
    final results = await Future.wait([
      _api
          .get('/karigars/options', query: {'q': q, 'limit': 20})
          .then((b) => Party.listFrom(b, PartyType.karigar)),
      _api
          .get('/vendors/options', query: {'q': q, 'limit': 20})
          .then((b) => Party.listFrom(b, PartyType.vendor)),
    ]);
    // Interleaved by name rather than karigars-then-vendors: the owner is
    // looking for a person, and which table they sit in is not how they are
    // remembered.
    final all = [...results[0], ...results[1]]
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return all;
  }
}

final partyDirectoryProvider = Provider<PartyDirectory>(
  (ref) => PartyDirectory(ref.watch(apiClientProvider)),
);

/// A payment being written.
class PayDraft {
  const PayDraft({
    this.party,
    this.amount = 0,
    this.method = 'Cash',
    this.note = '',
    this.saving = false,
  });

  final Party? party;
  final double amount;
  final String method;
  final String note;
  final bool saving;

  bool get canSave => party != null && amount > 0 && !saving;

  PayDraft copyWith({
    Party? party,
    double? amount,
    String? method,
    String? note,
    bool? saving,
  }) => PayDraft(
    party: party ?? this.party,
    amount: amount ?? this.amount,
    method: method ?? this.method,
    note: note ?? this.note,
    saving: saving ?? this.saving,
  );
}

final payDraftProvider = NotifierProvider<PayDraftController, PayDraft>(
  PayDraftController.new,
);

class PayDraftController extends Notifier<PayDraft> {
  @override
  PayDraft build() => const PayDraft();

  void pickParty(Party p) => state = state.copyWith(party: p);
  void setAmount(double v) => state = state.copyWith(amount: v);
  void setMethod(String v) => state = state.copyWith(method: v);
  void setNote(String v) => state = state.copyWith(note: v);

  /// Money out. `direction: 'paid'` is the only value this screen ever sends —
  /// money coming *in* belongs to a customer, and the customer module is out of
  /// scope.
  Future<void> save() async {
    final draft = state;
    if (!draft.canSave) return;
    state = draft.copyWith(saving: true);
    try {
      await ref
          .read(apiClientProvider)
          .post(
            '/payments',
            body: {
              'party_type': draft.party!.type.wire,
              'party_id': draft.party!.id,
              'amount': draft.amount,
              'direction': 'paid',
              'method': draft.method,
              'ref_note': draft.note.trim().isEmpty ? null : draft.note.trim(),
            },
          );
    } finally {
      // Cleared either way: on success there is nothing left to send, and on
      // failure the amount stays so a dropped request costs no retyping.
      state = state.copyWith(saving: false);
    }
    state = const PayDraft();
  }
}

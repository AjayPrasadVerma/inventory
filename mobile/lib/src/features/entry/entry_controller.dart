import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../format.dart' as fmt;
import '../../models/karigar.dart';
import '../auth/auth_controller.dart';

/// Which way goods are moving. The server decides everything else from this —
/// which catalogue to suggest from, which stock table to move — so it is the
/// first thing every provider here is keyed on.
enum EntryDirection {
  materialIn('in', 'Item in', 'Goods received from a karigar'),
  materialOut('out', 'Material out', 'Material issued to a karigar');

  const EntryDirection(this.wire, this.title, this.hint);

  /// What the API calls it.
  final String wire;
  final String title;
  final String hint;
}

/// Every karigar with an open account.
///
/// Fetched whole and filtered on the device. That is the same call the website
/// makes for its picker, and the response is a name and a phone per karigar —
/// small enough at this shop's size that a round trip per keystroke would be the
/// slower choice. It has no server-side limit, so if the list ever grows past a
/// few thousand this is the place that has to change.
final karigarOptionsProvider = FutureProvider<List<KarigarOption>>((ref) async {
  final body = await ref.watch(apiClientProvider).get('/karigars/options');
  return KarigarOption.listFrom(body);
});

/// Item search, run on the server.
///
/// The catalogue is thousands of names, each carrying every size and colour it
/// has been recorded in, so it is not something to hold on the device. The route
/// already takes a search term and caps its own result set; the form sends what
/// has been typed and shows what comes back.
class EntryCatalogue {
  const EntryCatalogue(this._api);

  final ApiClient _api;

  Future<List<ItemSuggestion>> searchItems(
    EntryDirection direction,
    String q,
  ) async {
    final body = await _api.get(
      '/karigars/suggest',
      query: {'direction': direction.wire, 'q': q},
    );
    return ItemSuggestion.listFrom(body);
  }
}

final entryCatalogueProvider = Provider<EntryCatalogue>(
  (ref) => EntryCatalogue(ref.watch(apiClientProvider)),
);

/// The entry being written: who it is for, what has been added so far, and the
/// item and size the next line will inherit.
class EntryDraft {
  const EntryDraft({
    this.karigarId,
    this.karigarName,
    this.item = '',
    this.itemSizes = const [],
    this.itemDesigns = const [],
    this.size,
    this.lines = const [],
    this.remark = '',
    this.saving = false,
  });

  final int? karigarId;
  final String? karigarName;

  /// Sticky across lines. A thirty-five line entry is one item in one unit, so
  /// carrying these forward is the difference between three fields per line and
  /// one tap.
  final String item;
  final String? size;

  /// What the picked item has been recorded in before. Held on the draft rather
  /// than re-fetched, because these are what every line after the first is
  /// chosen from and a round trip per line would undo the point of the form.
  final List<String> itemSizes;
  final List<String> itemDesigns;

  final List<DraftLine> lines;
  final String remark;
  final bool saving;

  bool get canAddLine => item.trim().isNotEmpty;
  bool get canSave => karigarId != null && lines.isNotEmpty && !saving;

  /// Totals per size, so the running count says "875 meter" rather than a number
  /// that quietly added metres to sheets.
  String get total {
    final sums = <String, double>{};
    for (final l in lines) {
      final unit = l.size ?? '';
      sums[unit] = (sums[unit] ?? 0) + l.qty;
    }
    return sums.entries
        .map((e) => '${fmt.qty(e.value)}${e.key.isEmpty ? '' : ' ${e.key}'}')
        .join('  ·  ');
  }

  EntryDraft copyWith({
    int? karigarId,
    String? karigarName,
    String? item,
    List<String>? itemSizes,
    List<String>? itemDesigns,
    String? size,
    bool clearSize = false,
    List<DraftLine>? lines,
    String? remark,
    bool? saving,
  }) => EntryDraft(
    karigarId: karigarId ?? this.karigarId,
    karigarName: karigarName ?? this.karigarName,
    item: item ?? this.item,
    itemSizes: itemSizes ?? this.itemSizes,
    itemDesigns: itemDesigns ?? this.itemDesigns,
    size: clearSize ? null : (size ?? this.size),
    lines: lines ?? this.lines,
    remark: remark ?? this.remark,
    saving: saving ?? this.saving,
  );
}

/// One draft per direction, kept while the screen is open so a half-written
/// entry survives a glance at something else.
///
/// Two plain providers rather than a family: Riverpod 3 removed `FamilyNotifier`,
/// and with exactly two directions the family API buys nothing a map lookup does
/// not already give.
final _drafts = {
  for (final d in EntryDirection.values)
    d: NotifierProvider<EntryDraftController, EntryDraft>(
      () => EntryDraftController(d),
    ),
};

NotifierProvider<EntryDraftController, EntryDraft> entryDraftProvider(
  EntryDirection direction,
) => _drafts[direction]!;

class EntryDraftController extends Notifier<EntryDraft> {
  EntryDraftController(this.direction);

  final EntryDirection direction;

  @override
  EntryDraft build() => const EntryDraft();

  void pickKarigar(KarigarOption k) =>
      state = state.copyWith(karigarId: k.id, karigarName: k.name);

  /// Choosing an item replaces its sizes and colours, and clears the size — a
  /// "meter" left over from cloth has no business sitting on a box. One known
  /// size is not a choice worth asking for, so it is taken.
  void pickItem(ItemSuggestion item) => state = state.copyWith(
    item: item.name,
    itemSizes: item.sizes,
    itemDesigns: item.designs,
    size: item.sizes.length == 1 ? item.sizes.first : null,
    clearSize: item.sizes.length != 1,
  );

  /// A name the catalogue has never seen. The entry route creates it on save
  /// rather than refusing it — the same as the website — so nobody has to go and
  /// build a product first.
  void pickNewItem(String name) => state = state.copyWith(
    item: name.trim(),
    itemSizes: const [],
    itemDesigns: const [],
    clearSize: true,
  );

  void pickSize(String? size) =>
      state = state.copyWith(size: size, clearSize: size == null);

  void setRemark(String v) => state = state.copyWith(remark: v);

  /// Add the line. Item and size stay put for the next one; only design and
  /// quantity are expected to change.
  void addLine({String? design, required double qty}) {
    if (!state.canAddLine || qty <= 0) return;
    final colour = design?.trim();
    state = state.copyWith(
      lines: [
        ...state.lines,
        DraftLine(
          name: state.item.trim(),
          size: state.size,
          design: (colour == null || colour.isEmpty) ? null : colour,
          qty: qty,
        ),
      ],
      // A colour typed by hand is a colour this item now comes in, so the next
      // line can pick it without typing it again.
      itemDesigns:
          (colour == null ||
              colour.isEmpty ||
              state.itemDesigns.any(
                (d) => d.toLowerCase() == colour.toLowerCase(),
              ))
          ? null
          : ([...state.itemDesigns, colour]..sort()),
    );
  }

  void removeLine(int index) {
    final next = [...state.lines]..removeAt(index);
    state = state.copyWith(lines: next);
  }

  /// Post the whole entry in one request. The route takes it all at once, and it
  /// has to: half an entry on the server would move stock for some lines and not
  /// the others.
  Future<void> save() async {
    final draft = state;
    if (!draft.canSave) return;
    state = draft.copyWith(saving: true);
    try {
      await ref
          .read(apiClientProvider)
          .post(
            '/karigars/${draft.karigarId}/entries',
            body: {
              'direction': direction.wire,
              'remark': draft.remark.trim().isEmpty
                  ? null
                  : draft.remark.trim(),
              'lines': draft.lines.map((l) => l.toJson()).toList(),
            },
          );
    } finally {
      // Cleared either way: on success there is nothing left to write, and on
      // failure the lines stay so nothing typed is lost to a dropped request.
      state = state.copyWith(saving: false);
    }
    state = const EntryDraft();
  }
}

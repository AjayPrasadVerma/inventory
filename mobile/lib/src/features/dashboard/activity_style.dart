import 'package:flutter/material.dart';

import '../../models/activity.dart';
import '../../theme.dart';

/// How an activity event is dressed — shared by the feed row and the detail
/// page, so an entry looks the same in the list as it does when opened.
///
/// Its own file because both of those import each other's direction otherwise:
/// the row pushes the page, and the page would have to reach back into the row's
/// file for these.

/// The khata column an event belongs to, as a colour.
Color colourOfSide(ColorScheme scheme, ActivitySide side) => switch (side) {
  ActivitySide.materialIn => scheme.inColor,
  ActivitySide.materialOut => scheme.outColor,
  ActivitySide.pay => scheme.payColor,
};

IconData iconOfKind(ActivityKind kind) => switch (kind) {
  ActivityKind.purchase => Icons.local_shipping_rounded,
  ActivityKind.issue => Icons.north_east_rounded,
  ActivityKind.receipt => Icons.south_west_rounded,
  ActivityKind.adjustment => Icons.tune_rounded,
  ActivityKind.payment => Icons.currency_rupee_rounded,
};

/// What a line should be *called*, and what its quantity is measured in.
///
/// Trivial now, and deliberately so. A karigar line used to arrive with its size
/// and design glued into `variant` and `unit` sent empty, which put the word
/// "meter" where a colour belongs and left every quantity a bare number. That
/// was fixed at the source — `/reports/activity` now sends size as `unit` and
/// design as `variant`, exactly as a purchase line does — so nothing here has to
/// guess which half is which. This stays as one named place for the rule, so a
/// future shape change has somewhere to land.
({String label, String unit}) lineParts(ActivityLine line) =>
    (label: line.variant ?? '', unit: line.unit ?? '');

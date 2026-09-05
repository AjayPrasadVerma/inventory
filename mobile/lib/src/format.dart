/// Number formatting, matching the website.
///
/// The web uses `toLocaleString("en-IN")`, which groups the Indian way —
/// 1,23,456 rather than 123,456. The same owner reads both screens all day, so a
/// number must not change shape depending on which one they are looking at.
///
/// Written by hand rather than pulled from `intl`: this is the only formatting
/// the app does, and a package whose whole job is locale data is a lot to carry
/// for two functions.
library;

/// Indian digit grouping: last three digits, then twos.
///
///     1234    -> 1,234
///     123456  -> 1,23,456
String _group(String digits) {
  if (digits.length <= 3) return digits;
  final head = digits.substring(0, digits.length - 3);
  final tail = digits.substring(digits.length - 3);
  final buffer = StringBuffer();
  for (var i = 0; i < head.length; i++) {
    // A separator every two digits, counted from the right of the head.
    if (i > 0 && (head.length - i) % 2 == 0) buffer.write(',');
    buffer.write(head[i]);
  }
  return '$buffer,$tail';
}

/// A count, grouped. Negatives keep their sign — oversold stock is a real value
/// and must not be shown as though it were positive.
String count(num value) {
  final negative = value < 0;
  final digits = value.abs().round().toString();
  return '${negative ? '-' : ''}${_group(digits)}';
}

/// Money, matching the web's `rupees()`. Whole rupees only when the paise are
/// zero — a shop reads ₹1,200 faster than ₹1,200.00, and the decimals only earn
/// their place when they carry something.
String rupees(num value) {
  final negative = value < 0;
  final abs = value.abs();
  final paise = (abs * 100).round() % 100;
  final whole = _group(abs.truncate().toString());
  final body = paise == 0
      ? whole
      : '$whole.${paise.toString().padLeft(2, '0')}';
  return '${negative ? '-' : ''}₹$body';
}

/// A quantity, trimming trailing zeros so 2.500 reads as 2.5 and 3.000 as 3.
/// Matches the web's `qty()`, which allows up to three decimals.
String qty(num value) {
  final negative = value < 0;
  final abs = value.abs();
  var fraction = abs
      .toStringAsFixed(3)
      .split('.')
      .last
      .replaceAll(RegExp(r'0+$'), '');
  final whole = _group(abs.truncate().toString());
  if (fraction.isEmpty) return '${negative ? '-' : ''}$whole';
  return '${negative ? '-' : ''}$whole.$fraction';
}

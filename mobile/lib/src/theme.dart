import 'package:flutter/material.dart';

/// The app's design language, in one place.
///
/// **The colours are the website's**, token for token, from
/// `frontend/app/globals.css`. Not a coincidence and not laziness: one owner
/// moves between the two screens all day, and the shop's khata already reads in
/// three colours — green for what came in, gold for what went out, indigo for
/// money. Inventing a second palette would mean learning the app twice.
///
/// What is *not* borrowed is the layout. The website is already
/// mobile-responsive, so rebuilding it here would add nothing; the phone is for
/// what gets done **standing up in the shop** (MOBILE.md), which wants larger
/// targets and fewer things to read.
///
/// Two rules follow from the phone rather than the web. Depth comes from colour
/// and spacing rather than shadows and blurs, which are what make a list stutter
/// on a cheap Android GPU. And colour is spent, not sprinkled: the three action
/// blocks are saturated and everything around them stays quiet, because a screen
/// where everything is a bordered box reads as unfinished — and so does a
/// rainbow.
class AppTheme {
  const AppTheme._();

  /// One rhythm for every gap. Sizes are multiples of it.
  static const gap = 8.0;

  // ── The website's surfaces (globals.css) ───────────────────────────────
  static const _lightBg = Color(0xFFF2F4FA); // --surface-2
  static const _lightSurface = Color(0xFFFFFFFF); // --surface
  static const _lightInk = Color(0xFF1A1C2E); // --ink
  static const _lightMuted = Color(0xFF676D8C); // --muted
  static const _lightBorder = Color(0xFFDFE3EF); // --border

  // The page ground is the website's own surface colour, matched exactly. Rows
  // then sit on the site's next step up, so they still lift off the ground
  // without every one of them needing an outline drawn around it.
  static const _darkBg = Color(0xFF1A1C2B); // --surface
  static const _darkSurface = Color(0xFF232639); // --surface-2
  static const _darkInk = Color(0xFFECEDF5); // --ink
  static const _darkMuted = Color(0xFF979DBA); // --muted
  static const _darkBorder = Color(0xFF2A2D42); // --border

  static ThemeData light() => _base(Brightness.light);
  static ThemeData dark() => _base(Brightness.dark);

  static ThemeData _base(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final bg = isDark ? _darkBg : _lightBg;
    final surface = isDark ? _darkSurface : _lightSurface;
    final ink = isDark ? _darkInk : _lightInk;
    final muted = isDark ? _darkMuted : _lightMuted;
    final outline = isDark ? _darkBorder : _lightBorder;
    // --primary
    final primary = isDark ? const Color(0xFF4F5AC0) : const Color(0xFF2E3577);

    final scheme =
        ColorScheme.fromSeed(
          seedColor: primary,
          brightness: brightness,
        ).copyWith(
          primary: primary,
          surface: surface,
          onSurface: ink,
          onSurfaceVariant: muted,
          outlineVariant: outline,
        );

    return ThemeData(
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: ink,
          fontSize: 22,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.4,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: surface,
        surfaceTintColor: Colors.transparent,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(gap * 2),
          // No outline in dark: the surface already lifts off the background, and
          // a border on top of that is the "boxes everywhere" look. Light mode
          // needs one, because white on near-white does not separate itself.
          side: isDark ? BorderSide.none : BorderSide(color: outline),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(gap * 1.5),
          borderSide: BorderSide(color: outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(gap * 1.5),
          borderSide: BorderSide(color: outline),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: gap * 2,
          vertical: gap * 2.5,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          // 56 high. A finger is about 9mm across and the shop's hands are not
          // always clean or steady; Material's 48 minimum is a floor, not a target.
          minimumSize: const Size.fromHeight(56),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(gap * 1.5),
          ),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(gap * 1.5),
        ),
      ),
      dividerTheme: DividerThemeData(color: outline, space: 1, thickness: 1),
    );
  }
}

/// The khata colours, straight from the website.
///
/// `.khata-head-in` is `--success`, `.khata-head-raw` is `--accent` and
/// `.khata-head-pay` is `--primary` (globals.css). The shop already reads its
/// ledger in those three, so the app uses the same three for the same meanings.
///
/// Each has a light and a dark value — the website's own pair, not one colour
/// dimmed. A 600-weight green that looks confident on white glows against a
/// near-black ground, which is why globals.css carries two sets and so does this.
///
/// Kept off [ColorScheme] because they are not theme roles. A reader should not
/// have to work out whether `tertiary` happened to be the "money" one this week.
extension SemanticColors on ColorScheme {
  bool get _dark => brightness == Brightness.dark;

  /// Goods received from a karigar — the website's `--success`.
  Color get inColor =>
      _dark ? const Color(0xFF4FB07F) : const Color(0xFF2E7D5B);

  /// Material issued out to a karigar — `--accent`.
  Color get outColor =>
      _dark ? const Color(0xFFD4B15E) : const Color(0xFFA6822E);

  /// Money paid — `--primary`, the same colour as the brand, exactly as on the
  /// website's khata.
  Color get payColor =>
      _dark ? const Color(0xFF4F5AC0) : const Color(0xFF2E3577);

  /// Low or oversold stock — `--danger`.
  Color get warnColor =>
      _dark ? const Color(0xFFE0664F) : const Color(0xFFC0442E);

  /// Stock that is merely low rather than oversold — `--warning`.
  Color get lowColor =>
      _dark ? const Color(0xFFE0A03A) : const Color(0xFFC9871F);

  /// The wash behind a semantic colour. Dark needs more of it to register at all.
  Color tintOf(Color c) => c.withValues(alpha: _dark ? 0.20 : 0.12);
}

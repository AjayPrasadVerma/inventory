import 'package:flutter/material.dart';

/// The app's design language, in one place.
///
/// Two things shape every choice here, and both come from MOBILE.md rather than
/// taste. The app is for the things done **standing up in the shop** — so touch
/// targets are large, the important numbers are readable at arm's length, and
/// nothing needs a second hand. And it runs on cheap Android phones, so the look
/// leans on layout, weight and spacing rather than on shadows, blurs and
/// gradients, which are what make a list stutter on a weak GPU.
///
/// It is deliberately **not** a copy of the website. The website is already
/// mobile-responsive; rebuilding it here would add nothing. What a phone is for
/// is the walking-around work, and that wants a different shape.
class AppTheme {
  const AppTheme._();

  /// The same blue the website uses. Continuity is worth more than novelty —
  /// this is one business, and the owner moves between the two all day.
  static const seed = Color(0xFF2563EB);

  /// One rhythm for every gap in the app. Sizes are multiples of it, so spacing
  /// stays consistent without anyone having to remember a number.
  static const gap = 8.0;

  static ThemeData light() => _base(Brightness.light);
  static ThemeData dark() => _base(Brightness.dark);

  static ThemeData _base(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: brightness,
    );
    final isDark = brightness == Brightness.dark;

    return ThemeData(
      colorScheme: scheme,
      scaffoldBackgroundColor: isDark
          ? const Color(0xFF0F1115)
          : const Color(0xFFF7F8FA),
      appBarTheme: AppBarTheme(
        backgroundColor: isDark
            ? const Color(0xFF0F1115)
            : const Color(0xFFF7F8FA),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: scheme.onSurface,
          fontSize: 22,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.3,
        ),
      ),
      cardTheme: CardThemeData(
        // Flat with a hairline border rather than elevated. A shadow under every
        // card costs a real amount of GPU time per frame on a cheap phone, and
        // buys nothing a border does not already say.
        elevation: 0,
        color: isDark ? const Color(0xFF171A21) : Colors.white,
        surfaceTintColor: Colors.transparent,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(gap * 2),
          side: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: isDark ? 0.5 : 1),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? const Color(0xFF171A21) : Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(gap * 1.5),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(gap * 1.5),
          borderSide: BorderSide(color: scheme.outlineVariant),
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
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant,
        space: 1,
        thickness: 1,
      ),
    );
  }
}

/// Colours that carry meaning rather than brand: stock that needs attention,
/// material coming in, material going out, money paid.
///
/// Kept off [ColorScheme] because they are not theme roles — they mean the same
/// thing in light and dark, and a reader should not have to guess whether
/// `tertiary` happened to be the "money" one this week.
extension SemanticColors on ColorScheme {
  Color get inColor => const Color(0xFF16A34A); // goods received
  Color get outColor => const Color(0xFFD97706); // material issued
  Color get payColor => const Color(0xFF7C3AED); // money out
  Color get warnColor => const Color(0xFFDC2626); // low / oversold
}

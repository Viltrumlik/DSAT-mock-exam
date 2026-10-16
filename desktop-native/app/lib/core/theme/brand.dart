// The MasterSAT shield logo (frontend/public/images/logo.png, 434x500, 4.7 KB), embedded so the
// app needs no asset bundle entry for it. Tinted per use with a ColorFilter.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';

import 'app_theme.dart';
import 'tokens.dart';

const String _logoPngBase64 =
    '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';

final Uint8List brandLogoPng = base64Decode(_logoPngBase64);

/// The shield mark. [color] tints it (white on the brand panel); null keeps the brand blue.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.size = 28, this.color});

  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final image = Image.memory(
      brandLogoPng,
      width: size * 434 / 500,
      height: size,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
      gaplessPlayback: true,
      excludeFromSemantics: true,
    );
    final tint = color;
    if (tint == null) return image;
    return ColorFiltered(colorFilter: ColorFilter.mode(tint, BlendMode.srcIn), child: image);
  }
}

/// Logo plus the "MasterSAT" wordmark.
class BrandWordmark extends StatelessWidget {
  const BrandWordmark({super.key, this.size = 26, this.color = AppColors.ink, this.logoColor});

  final double size;
  final Color color;
  final Color? logoColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        BrandLogo(size: size, color: logoColor),
        SizedBox(width: size * 0.38),
        Text(
          'MasterSAT',
          // The shell's brand name: Geist extrabold, `tracking-tight` (-.025em).
          style: TextStyle(
            fontFamily: AppFonts.ui,
            fontFamilyFallback: AppFonts.fallback,
            fontSize: size * 0.68,
            fontWeight: FontWeight.w800,
            color: color,
            letterSpacing: size * 0.68 * -0.025,
            height: 1.2,
            decoration: TextDecoration.none,
          ),
        ),
      ],
    );
  }
}

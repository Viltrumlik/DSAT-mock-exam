// CSS `border-dashed` / `border-dotted` for the runner: Flutter has no dashed borders, so this
// paints them the way Chromium does — dashes 3 × the border width long with equal gaps (the
// pattern stretched so it closes evenly around the shape), dots as round caps one width apart.
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

enum CssBorderStyle { solid, dashed, dotted }

/// A rounded box with a 1 px (or [width]) dashed/dotted/solid border, painted inside the box
/// like a CSS border (the border takes layout space via [padding]).
class CssBorderBox extends StatelessWidget {
  const CssBorderBox({
    super.key,
    required this.color,
    this.style = CssBorderStyle.dashed,
    this.width = 1,
    this.radius = 0,
    this.background,
    this.child,
  });

  final Color color;
  final CssBorderStyle style;
  final double width;
  final double radius;
  final Color? background;
  final Widget? child;

  @override
  Widget build(BuildContext context) => CustomPaint(
    painter: CssBorderPainter(color: color, style: style, width: width, radius: radius, background: background),
    child: Padding(padding: EdgeInsets.all(width), child: child),
  );
}

class CssBorderPainter extends CustomPainter {
  const CssBorderPainter({required this.color, required this.style, this.width = 1, this.radius = 0, this.background});

  final Color color;
  final CssBorderStyle style;
  final double width;
  final double radius;
  final Color? background;

  @override
  void paint(Canvas canvas, Size size) {
    final outer = RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius));
    if (background != null) canvas.drawRRect(outer, Paint()..color = background!);
    final stroke = outer.deflate(width / 2);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = width
      ..isAntiAlias = true;
    final path = Path()..addRRect(stroke);
    if (style == CssBorderStyle.solid) {
      canvas.drawPath(path, paint);
      return;
    }
    if (style == CssBorderStyle.dotted) paint.strokeCap = StrokeCap.round;
    for (final metric in path.computeMetrics()) {
      _dash(canvas, metric, paint);
    }
  }

  void _dash(Canvas canvas, ui.PathMetric metric, Paint paint) {
    final total = metric.length;
    // Dotted: a zero-length round-capped segment every 2 widths. Dashed: 3w on, 3w off.
    final on = style == CssBorderStyle.dotted ? 0.0 : 3 * width;
    final period = style == CssBorderStyle.dotted ? 2 * width : 6 * width;
    final count = math.max(1, (total / period).round());
    final scale = total / (count * period);
    for (var i = 0; i < count; i++) {
      final start = i * period * scale;
      if (on == 0) {
        final t = metric.getTangentForOffset(start);
        if (t != null) canvas.drawPoints(ui.PointMode.points, [t.position], paint);
      } else {
        canvas.drawPath(metric.extractPath(start, start + on * scale), paint);
      }
    }
  }

  @override
  bool shouldRepaint(CssBorderPainter old) =>
      old.color != color ||
      old.style != style ||
      old.width != width ||
      old.radius != radius ||
      old.background != background;
}

/// A CSS `border-b-2 border-{solid,dashed,dotted}` line sample (the toolbar's underline buttons).
class CssLine extends StatelessWidget {
  const CssLine({super.key, required this.color, required this.style, this.width = 16, this.thickness = 2});

  final Color color;
  final CssBorderStyle style;
  final double width;
  final double thickness;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: width,
    height: thickness,
    child: CustomPaint(painter: _LinePainter(color, style, thickness)),
  );
}

class _LinePainter extends CustomPainter {
  _LinePainter(this.color, this.style, this.thickness);

  final Color color;
  final CssBorderStyle style;
  final double thickness;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    switch (style) {
      case CssBorderStyle.solid:
        canvas.drawRect(Offset.zero & size, paint);
      case CssBorderStyle.dashed:
        // Chromium: dashes 3 × thickness with equal gaps, starting and ending on a dash.
        final dash = 3 * thickness;
        final n = math.max(1, ((size.width + dash) / (2 * dash)).floor());
        final gap = n > 1 ? (size.width - n * dash) / (n - 1) : 0.0;
        for (var i = 0; i < n; i++) {
          final x = i * (dash + gap);
          canvas.drawRect(Rect.fromLTWH(x, 0, dash, size.height), paint);
        }
      case CssBorderStyle.dotted:
        final r = thickness / 2;
        for (var x = r; x <= size.width - r + 0.01; x += 2 * thickness) {
          canvas.drawCircle(Offset(x, size.height / 2), r, paint);
        }
    }
  }

  @override
  bool shouldRepaint(_LinePainter old) => old.color != color || old.style != style || old.thickness != thickness;
}

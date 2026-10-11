// Draws lucide icons from their vector nodes, the way lucide-react's <svg> does on the
// website: a 24×24 grid, stroke-width 2 (scaled with the icon, absoluteStrokeWidth=false),
// round caps and joins, fill none unless the website adds a `fill-*` class.
import 'package:flutter/widgets.dart';

import 'svg_path.dart';

/// One SVG element of a lucide icon, in the 24-unit coordinate space.
@immutable
class LucideNode {
  const LucideNode.path(String this.d)
    : kind = LucideNodeKind.path,
      a = 0,
      b = 0,
      c = 0,
      e = 0,
      rx = 0,
      ry = 0,
      points = null,
      closed = false;

  const LucideNode.circle(double cx, double cy, double r)
    : kind = LucideNodeKind.ellipse,
      d = null,
      a = cx,
      b = cy,
      c = r,
      e = r,
      rx = 0,
      ry = 0,
      points = null,
      closed = true;

  const LucideNode.ellipse(double cx, double cy, double rx, double ry)
    : kind = LucideNodeKind.ellipse,
      d = null,
      a = cx,
      b = cy,
      c = rx,
      e = ry,
      rx = 0,
      ry = 0,
      points = null,
      closed = true;

  const LucideNode.rect(double x, double y, double width, double height, this.rx, this.ry)
    : kind = LucideNodeKind.rect,
      d = null,
      a = x,
      b = y,
      c = width,
      e = height,
      points = null,
      closed = true;

  const LucideNode.line(double x1, double y1, double x2, double y2)
    : kind = LucideNodeKind.line,
      d = null,
      a = x1,
      b = y1,
      c = x2,
      e = y2,
      rx = 0,
      ry = 0,
      points = null,
      closed = false;

  const LucideNode.poly(List<double> this.points, {required this.closed})
    : kind = LucideNodeKind.poly,
      d = null,
      a = 0,
      b = 0,
      c = 0,
      e = 0,
      rx = 0,
      ry = 0;

  final LucideNodeKind kind;
  final String? d;
  final double a, b, c, e, rx, ry;
  final List<double>? points;
  final bool closed;

  Path toPath() {
    switch (kind) {
      case LucideNodeKind.path:
        return parseSvgPathData(d!);
      case LucideNodeKind.ellipse:
        return Path()..addOval(Rect.fromCenter(center: Offset(a, b), width: c * 2, height: e * 2));
      case LucideNodeKind.rect:
        final r = Rect.fromLTWH(a, b, c, e);
        return Path()..addRRect(RRect.fromRectXY(r, rx, ry));
      case LucideNodeKind.line:
        return Path()
          ..moveTo(a, b)
          ..lineTo(c, e);
      case LucideNodeKind.poly:
        final p = Path()..moveTo(points![0], points![1]);
        for (var i = 2; i + 1 < points!.length; i += 2) {
          p.lineTo(points![i], points![i + 1]);
        }
        if (closed) p.close();
        return p;
    }
  }
}

/// The SVG element a [LucideNode] stands for.
enum LucideNodeKind { path, ellipse, rect, line, poly }

/// A lucide icon: its name and nodes (see lucide_glyphs.dart).
@immutable
class LucideGlyph {
  const LucideGlyph(this.name, this.nodes);

  final String name;
  final List<LucideNode> nodes;

  static final Map<String, List<Path>> _cache = {};

  /// One path per SVG element, in 24-unit space (cached). Kept separate because SVG fills
  /// each element on its own (a filled map-pin keeps its inner circle filled).
  List<Path> get paths => _cache.putIfAbsent(name, () => [for (final n in nodes) n.toPath()]);
}

/// An icon drawn at [size]×[size] logical px. [fill] mirrors Tailwind's `fill-*` on the svg.
class LucideIcon extends StatelessWidget {
  const LucideIcon(this.glyph, {super.key, required this.size, required this.color, this.fill, this.strokeWidth = 2});

  final LucideGlyph glyph;
  final double size;
  final Color color;
  final Color? fill;

  /// In 24-unit space (lucide default 2).
  final double strokeWidth;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: size,
    child: CustomPaint(
      painter: LucidePainter(glyph, color: color, fill: fill, strokeWidth: strokeWidth),
    ),
  );
}

class LucidePainter extends CustomPainter {
  LucidePainter(this.glyph, {required this.color, this.fill, this.strokeWidth = 2});

  final LucideGlyph glyph;
  final Color color;
  final Color? fill;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 24, size.height / 24);
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = color
      ..isAntiAlias = true;
    final filler = fill == null
        ? null
        : (Paint()
            ..style = PaintingStyle.fill
            ..color = fill!
            ..isAntiAlias = true);
    for (final path in glyph.paths) {
      if (filler != null) canvas.drawPath(path, filler);
      canvas.drawPath(path, stroke);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(LucidePainter old) =>
      old.glyph != glyph || old.color != color || old.fill != fill || old.strokeWidth != strokeWidth;
}

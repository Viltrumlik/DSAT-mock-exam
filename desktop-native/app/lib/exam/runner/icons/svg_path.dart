// A small SVG path-data parser (the `d` attribute) producing a dart:ui Path.
//
// Only what lucide icons and the runner's own glyphs need, which is the whole SVG 1.1 path
// grammar: M/L/H/V/C/S/Q/T/A/Z in absolute and relative forms, implicit repeats, compact
// numbers (".4-.8", "1.5.5", "1e-3") and compact arc flags ("a1 1 0 011 1"). Arcs use
// Path.arcToPoint, which follows SVG's endpoint parameterisation.
import 'dart:ui';

/// Parses SVG path data. Throws [FormatException] on malformed input.
Path parseSvgPathData(String data) => _SvgPathParser(data).parse();

class _SvgPathParser {
  _SvgPathParser(this._s);

  final String _s;
  int _i = 0;
  final Path _path = Path();

  double _cx = 0, _cy = 0; // current point
  double _sx = 0, _sy = 0; // subpath start
  double? _lastCubicX, _lastCubicY; // second control point of the previous C/S
  double? _lastQuadX, _lastQuadY; // control point of the previous Q/T

  static bool _isCommand(int c) => 'MmLlHhVvCcSsQqTtAaZz'.codeUnits.contains(c);

  void _skipSeparators() {
    while (_i < _s.length) {
      final c = _s.codeUnitAt(_i);
      if (c == 0x20 || c == 0x2C || c == 0x09 || c == 0x0A || c == 0x0D) {
        _i++;
      } else {
        break;
      }
    }
  }

  double _number() {
    _skipSeparators();
    final start = _i;
    if (_i < _s.length && (_s[_i] == '-' || _s[_i] == '+')) _i++;
    var digits = 0;
    while (_i < _s.length && _isDigit(_s.codeUnitAt(_i))) {
      _i++;
      digits++;
    }
    if (_i < _s.length && _s[_i] == '.') {
      _i++;
      while (_i < _s.length && _isDigit(_s.codeUnitAt(_i))) {
        _i++;
        digits++;
      }
    }
    if (digits == 0) throw FormatException('Expected a number', _s, start);
    if (_i < _s.length && (_s[_i] == 'e' || _s[_i] == 'E')) {
      final save = _i;
      _i++;
      if (_i < _s.length && (_s[_i] == '-' || _s[_i] == '+')) _i++;
      var exp = 0;
      while (_i < _s.length && _isDigit(_s.codeUnitAt(_i))) {
        _i++;
        exp++;
      }
      if (exp == 0) _i = save; // not an exponent after all
    }
    return double.parse(_s.substring(start, _i));
  }

  bool _flag() {
    _skipSeparators();
    if (_i >= _s.length) throw FormatException('Expected an arc flag', _s, _i);
    final c = _s[_i++];
    if (c == '0') return false;
    if (c == '1') return true;
    throw FormatException('Bad arc flag "$c"', _s, _i - 1);
  }

  static bool _isDigit(int c) => c >= 0x30 && c <= 0x39;

  Path parse() {
    String? cmd;
    while (true) {
      _skipSeparators();
      if (_i >= _s.length) break;
      final c = _s.codeUnitAt(_i);
      if (_isCommand(c)) {
        cmd = _s[_i++];
      } else if (cmd == null) {
        throw FormatException('Path data must start with a command', _s, _i);
      } else if (cmd == 'M') {
        cmd = 'L'; // implicit lineto after moveto
      } else if (cmd == 'm') {
        cmd = 'l';
      } else if (cmd == 'Z' || cmd == 'z') {
        throw FormatException('Unexpected number after closepath', _s, _i);
      }
      _run(cmd);
    }
    return _path;
  }

  void _run(String cmd) {
    final rel = cmd.toLowerCase() == cmd;
    final ox = rel ? _cx : 0.0;
    final oy = rel ? _cy : 0.0;
    switch (cmd.toUpperCase()) {
      case 'M':
        final x = ox + _number(), y = oy + _number();
        _path.moveTo(x, y);
        _cx = _sx = x;
        _cy = _sy = y;
        _resetControls();
      case 'L':
        final x = ox + _number(), y = oy + _number();
        _path.lineTo(x, y);
        _set(x, y);
      case 'H':
        final x = ox + _number();
        _path.lineTo(x, _cy);
        _set(x, _cy);
      case 'V':
        final y = (rel ? _cy : 0.0) + _number();
        _path.lineTo(_cx, y);
        _set(_cx, y);
      case 'C':
        final x1 = ox + _number(), y1 = oy + _number();
        final x2 = ox + _number(), y2 = oy + _number();
        final x = ox + _number(), y = oy + _number();
        _path.cubicTo(x1, y1, x2, y2, x, y);
        _set(x, y);
        _lastCubicX = x2;
        _lastCubicY = y2;
      case 'S':
        final x1 = _lastCubicX == null ? _cx : 2 * _cx - _lastCubicX!;
        final y1 = _lastCubicY == null ? _cy : 2 * _cy - _lastCubicY!;
        final x2 = ox + _number(), y2 = oy + _number();
        final x = ox + _number(), y = oy + _number();
        _path.cubicTo(x1, y1, x2, y2, x, y);
        _set(x, y);
        _lastCubicX = x2;
        _lastCubicY = y2;
      case 'Q':
        final x1 = ox + _number(), y1 = oy + _number();
        final x = ox + _number(), y = oy + _number();
        _path.quadraticBezierTo(x1, y1, x, y);
        _set(x, y);
        _lastQuadX = x1;
        _lastQuadY = y1;
      case 'T':
        final x1 = _lastQuadX == null ? _cx : 2 * _cx - _lastQuadX!;
        final y1 = _lastQuadY == null ? _cy : 2 * _cy - _lastQuadY!;
        final x = ox + _number(), y = oy + _number();
        _path.quadraticBezierTo(x1, y1, x, y);
        _set(x, y);
        _lastQuadX = x1;
        _lastQuadY = y1;
      case 'A':
        final rx = _number().abs(), ry = _number().abs();
        final rotation = _number();
        final largeArc = _flag();
        final sweep = _flag();
        final x = ox + _number(), y = oy + _number();
        if (rx == 0 || ry == 0) {
          _path.lineTo(x, y);
        } else if (x != _cx || y != _cy) {
          _path.arcToPoint(Offset(x, y),
              radius: Radius.elliptical(rx, ry), rotation: rotation, largeArc: largeArc, clockwise: sweep);
        }
        _set(x, y);
      case 'Z':
        _path.close();
        _cx = _sx;
        _cy = _sy;
        _resetControls();
    }
    // Further coordinate groups repeat the command; parse()'s loop handles that.
  }

  void _set(double x, double y) {
    _cx = x;
    _cy = y;
    _resetControls();
  }

  void _resetControls() {
    _lastCubicX = _lastCubicY = _lastQuadX = _lastQuadY = null;
  }
}

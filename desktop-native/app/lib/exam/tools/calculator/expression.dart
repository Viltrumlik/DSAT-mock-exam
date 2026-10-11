// Port of frontend/src/features/testing-simulation/tools/calculator/expression.ts (185 lines):
// a safe math-expression evaluator (no eval) — a recursive-descent parser over a tokenizer.
// Powers the native scientific calculator (the offline / Desmos-failed fallback).
//
// Supports: + - * / ^, unary -, parentheses, factorial (!), percent (50% → 0.5), functions
// sin cos tan asin acos atan sqrt cbrt ln log abs exp, constants pi/e.
//
// Behaviour is kept identical to the TypeScript, including JavaScript's number formatting in
// [tryEvaluate] (`String(Number.parseFloat(v.toPrecision(12)))`) and the exact error cases.
import 'dart:math' as math;

/// Evaluation options (expression.ts:9-12).
class EvalOptions {
  const EvalOptions({this.degrees = false});

  /// Interpret trig args/results in degrees instead of radians.
  final bool degrees;
}

/// Thrown on any malformed input (the TS `throw new Error(...)`).
class ExpressionError implements Exception {
  const ExpressionError(this.message);
  final String message;

  @override
  String toString() => 'ExpressionError: $message';
}

enum _T { num, op, fn, constant, paren }

class _Tok {
  const _Tok(this.t, {this.n = 0, this.s = ''});
  final _T t;
  final double n;
  final String s;
}

const _funcs = {'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'cbrt', 'ln', 'log', 'abs', 'exp'};

bool _isDigitOrDot(String c) => (c.compareTo('0') >= 0 && c.compareTo('9') <= 0) || c == '.';
bool _isLetter(String c) => RegExp(r'[a-z]', caseSensitive: false).hasMatch(c);

/// JavaScript's `Number(s)` for a run of `[0-9.]` characters: NaN unless it is a decimal
/// literal (`5`, `5.`, `.5`, `5.25`).
double _jsNumber(String s) {
  if (!RegExp(r'^(\d+\.?\d*|\.\d+)$').hasMatch(s)) return double.nan;
  return double.parse(s.endsWith('.') ? '${s}0' : s);
}

List<_Tok> _tokenize(String input) {
  final s = input.replaceAll(RegExp(r'\s+'), '');
  final out = <_Tok>[];
  var i = 0;
  while (i < s.length) {
    final c = s[i];
    if (_isDigitOrDot(c)) {
      var j = i + 1;
      while (j < s.length && _isDigitOrDot(s[j])) {
        j++;
      }
      final num = _jsNumber(s.substring(i, j));
      if (!num.isFinite) throw const ExpressionError('Invalid number');
      out.add(_Tok(_T.num, n: num));
      i = j;
    } else if (_isLetter(c)) {
      var j = i + 1;
      while (j < s.length && _isLetter(s[j])) {
        j++;
      }
      final word = s.substring(i, j).toLowerCase();
      if (_funcs.contains(word)) {
        out.add(_Tok(_T.fn, s: word));
      } else if (word == 'pi' || word == 'e') {
        out.add(_Tok(_T.constant, s: word));
      } else {
        throw ExpressionError('Unknown name: $word');
      }
      i = j;
    } else if ('+-*/^!%'.contains(c)) {
      out.add(_Tok(_T.op, s: c));
      i++;
    } else if (c == '(' || c == ')') {
      out.add(_Tok(_T.paren, s: c));
      i++;
    } else {
      throw ExpressionError('Unexpected character: $c');
    }
  }
  return out;
}

class _Parser {
  _Parser(this._toks, this._opts);

  final List<_Tok> _toks;
  final EvalOptions _opts;
  int _pos = 0;

  double parse() {
    final v = _expr();
    if (_pos < _toks.length) throw const ExpressionError('Unexpected trailing input');
    return v;
  }

  _Tok? _peek() => _pos < _toks.length ? _toks[_pos] : null;

  bool _isOp(_Tok? t, String ops) => t != null && t.t == _T.op && ops.contains(t.s);

  double _expr() {
    var v = _term();
    for (var t = _peek(); _isOp(t, '+-'); t = _peek()) {
      _pos++;
      v = t!.s == '+' ? v + _term() : v - _term();
    }
    return v;
  }

  double _term() {
    var v = _unary();
    for (var t = _peek(); _isOp(t, '*/'); t = _peek()) {
      _pos++;
      final rhs = _unary();
      if (t!.s == '/' && rhs == 0) throw const ExpressionError('Division by zero');
      v = t.s == '*' ? v * rhs : v / rhs;
    }
    return v;
  }

  double _unary() {
    // Unary minus binds looser than ^, so -2^2 = -(2^2) = -4.
    final t = _peek();
    if (_isOp(t, '-+')) {
      _pos++;
      final v = _unary();
      return t!.s == '-' ? -v : v;
    }
    return _power();
  }

  double _power() {
    final base = _postfix();
    final t = _peek();
    if (_isOp(t, '^')) {
      _pos++;
      return math.pow(base, _unary()).toDouble(); // right-assoc; exponent may be signed
    }
    return base;
  }

  double _postfix() {
    var v = _primary();
    for (var t = _peek(); _isOp(t, '!%'); t = _peek()) {
      _pos++;
      v = t!.s == '!' ? _factorial(v) : v / 100;
    }
    return v;
  }

  double _primary() {
    final t = _peek();
    if (t == null) throw const ExpressionError('Unexpected end of input');
    if (t.t == _T.num) {
      _pos++;
      return t.n;
    }
    if (t.t == _T.constant) {
      _pos++;
      return t.s == 'pi' ? math.pi : math.e;
    }
    if (t.t == _T.fn) {
      _pos++;
      _expect('(');
      final arg = _expr();
      _expect(')');
      return _applyFn(t.s, arg);
    }
    if (t.t == _T.paren && t.s == '(') {
      _pos++;
      final v = _expr();
      _expect(')');
      return v;
    }
    throw const ExpressionError('Expected a value');
  }

  void _expect(String p) {
    final t = _peek();
    if (t == null || t.t != _T.paren || t.s != p) throw ExpressionError("Expected '$p'");
    _pos++;
  }

  double _applyFn(String name, double x) {
    double toRad(double v) => _opts.degrees ? (v * math.pi) / 180 : v;
    double fromRad(double v) => _opts.degrees ? (v * 180) / math.pi : v;
    switch (name) {
      case 'sin':
        return math.sin(toRad(x));
      case 'cos':
        return math.cos(toRad(x));
      case 'tan':
        return math.tan(toRad(x));
      case 'asin':
        return fromRad(math.asin(x));
      case 'acos':
        return fromRad(math.acos(x));
      case 'atan':
        return fromRad(math.atan(x));
      case 'sqrt':
        if (x < 0) throw const ExpressionError('sqrt of negative');
        return math.sqrt(x);
      case 'cbrt':
        return _cbrt(x);
      case 'ln':
        if (x <= 0) throw const ExpressionError('ln domain');
        return math.log(x);
      case 'log':
        if (x <= 0) throw const ExpressionError('log domain');
        return _log10(x);
      case 'abs':
        return x.abs();
      case 'exp':
        return math.exp(x);
      default:
        throw ExpressionError('Unknown function $name');
    }
  }
}

/// `Math.cbrt`: exact for perfect cubes (pow(27, 1/3) alone is 3.0000000000000004).
double _cbrt(double x) {
  if (x == 0 || !x.isFinite) return x;
  final a = x.abs();
  var r = math.pow(a, 1 / 3).toDouble();
  r = r - (r * r * r - a) / (3 * r * r); // one Newton step
  final rounded = r.roundToDouble();
  if (rounded * rounded * rounded == a) r = rounded;
  return x < 0 ? -r : r;
}

/// `Math.log10`: exact for powers of ten (log(1000)/ln10 alone is 2.9999999999999996).
double _log10(double x) {
  final r = math.log(x) / math.ln10;
  final rounded = r.roundToDouble();
  if ((r - rounded).abs() < 1e-9 && math.pow(10, rounded) == x) return rounded;
  return r;
}

double _factorial(double n) {
  if (n < 0 || n != n.truncateToDouble()) throw const ExpressionError('factorial needs a non-negative integer');
  if (n > 170) throw const ExpressionError('factorial too large');
  var r = 1.0;
  for (var k = 2; k <= n; k++) {
    r *= k;
  }
  return r;
}

/// Evaluate an expression string. Throws [ExpressionError] on any malformed input.
double evaluate(String input, [EvalOptions opts = const EvalOptions()]) {
  if (input.trim().isEmpty) throw const ExpressionError('Empty expression');
  final result = _Parser(_tokenize(input), opts).parse();
  if (!result.isFinite) throw const ExpressionError('Result is not finite');
  return result;
}

/// Convenience wrapper returning a display string or "Error" (expression.ts:177-185).
String tryEvaluate(String input, [EvalOptions opts = const EvalOptions()]) {
  try {
    return formatCalculatorResult(evaluate(input, opts));
  } on ExpressionError {
    return 'Error';
  }
}

/// `String(Number.parseFloat(v.toPrecision(12)))` — 12 significant digits, then JavaScript's
/// shortest round-trip formatting (no trailing ".0", "1e+21" style exponents).
String formatCalculatorResult(double v) => jsNumberToString(double.parse(v.toStringAsPrecision(12)));

/// JavaScript's `Number.prototype.toString()` for finite doubles.
String jsNumberToString(double v) {
  if (v == 0) return '0'; // also -0
  if (v.isNaN) return 'NaN';
  if (v.isInfinite) return v > 0 ? 'Infinity' : '-Infinity';
  var s = v.toString();
  // Dart prints integral doubles below 1e21 as "120.0"; JS prints "120".
  if (s.endsWith('.0')) s = s.substring(0, s.length - 2);
  // Dart writes "1e+21"/"1.5e-7" like JS already; normalise a bare "e21" just in case.
  s = s.replaceFirstMapped(RegExp(r'e(\d)'), (m) => 'e+${m[1]}');
  return s;
}

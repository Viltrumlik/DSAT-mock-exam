// Port of frontend/src/features/testing-simulation/tools/__tests__/expression.test.ts — every
// website case, with the same expectations — plus the JavaScript-number details the Dart port
// has to reproduce by hand (Number() literal parsing, Math.cbrt/log10 exactness, String(n)).
import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/exam/tools/calculator/expression.dart';

void main() {
  group('expression evaluator (website expression.test.ts)', () {
    test('respects operator precedence', () {
      expect(evaluate('2+3*4'), 14);
      expect(evaluate('(2+3)*4'), 20);
      expect(evaluate('10-2-3'), 5); // left assoc
    });

    test('handles powers (right-associative) and unary minus', () {
      expect(evaluate('2^3^2'), 512); // 2^(3^2)
      expect(evaluate('-2^2'), -4); // -(2^2)
      expect(evaluate('3*-2'), -6);
    });

    test('supports functions in radians and degrees', () {
      expect(evaluate('sin(0)'), closeTo(0, 1e-10));
      expect(evaluate('cos(0)'), 1);
      expect(evaluate('sin(90)', const EvalOptions(degrees: true)), closeTo(1, 1e-10));
      expect(evaluate('sqrt(16)'), 4);
      expect(evaluate('log(1000)'), closeTo(3, 1e-10));
      expect(evaluate('ln(e)'), closeTo(1, 1e-10));
    });

    test('handles constants, factorial and percent', () {
      expect(evaluate('pi'), closeTo(math.pi, 1e-10));
      expect(evaluate('5!'), 120);
      expect(evaluate('50%'), 0.5);
      expect(evaluate('200*10%'), 20);
    });

    test('throws on malformed / unsafe input (no eval)', () {
      expect(() => evaluate('2+'), throwsA(isA<ExpressionError>()));
      expect(() => evaluate('1/0'), throwsA(isA<ExpressionError>()));
      expect(() => evaluate('alert(1)'), throwsA(isA<ExpressionError>()));
      expect(() => evaluate('2**3'), throwsA(isA<ExpressionError>()));
      expect(() => evaluate(''), throwsA(isA<ExpressionError>()));
    });

    test("tryEvaluate returns a string or 'Error' and never throws", () {
      expect(tryEvaluate('2+2'), '4');
      expect(tryEvaluate('bad('), 'Error');
    });
  });

  group('JavaScript parity details', () {
    test('number literals follow Number(): "5." and ".5" parse, "." and "1.2.3" do not', () {
      expect(evaluate('5.+1'), 6);
      expect(evaluate('.5*4'), 2);
      expect(() => evaluate('.'), throwsA(isA<ExpressionError>()));
      expect(() => evaluate('1.2.3'), throwsA(isA<ExpressionError>()));
    });

    test('whitespace is ignored and names are case-insensitive', () {
      expect(evaluate(' 2 +\t3 '), 5);
      expect(evaluate('SQRT(9)+PI-pi'), 3);
    });

    test('exact error messages of the TypeScript', () {
      String msg(String s) {
        try {
          evaluate(s);
        } on ExpressionError catch (e) {
          return e.message;
        }
        return 'no error';
      }

      expect(msg(''), 'Empty expression');
      expect(msg('   '), 'Empty expression');
      expect(msg('foo'), 'Unknown name: foo');
      expect(msg('2#3'), 'Unexpected character: #');
      expect(msg('2+'), 'Unexpected end of input');
      expect(msg('(2'), "Expected ')'");
      expect(msg('sin 2'), "Expected '('");
      expect(msg('2)'), 'Unexpected trailing input');
      expect(msg('*2'), 'Expected a value');
      expect(msg('1/0'), 'Division by zero');
      expect(msg('sqrt(-1)'), 'sqrt of negative');
      expect(msg('ln(0)'), 'ln domain');
      expect(msg('log(-1)'), 'log domain');
      expect(msg('2.5!'), 'factorial needs a non-negative integer');
      expect(msg('171!'), 'factorial too large');
      expect(msg('10^400'), 'Result is not finite');
    });

    test('Math.cbrt and Math.log10 are exact where JavaScript is', () {
      expect(evaluate('cbrt(27)'), 3);
      expect(evaluate('cbrt(-8)'), -2);
      expect(evaluate('log(1000)'), 3);
      expect(evaluate('log(0.001)'), -3);
      expect(tryEvaluate('cbrt(2)'), '1.25992104989');
    });

    test('degrees mode converts inverse trig results back to degrees', () {
      expect(evaluate('asin(1)', const EvalOptions(degrees: true)), closeTo(90, 1e-10));
      expect(evaluate('atan(1)', const EvalOptions(degrees: true)), closeTo(45, 1e-10));
      expect(evaluate('acos(1)'), 0);
    });

    test('postfix operators chain and bind tighter than ^', () {
      expect(evaluate('3!!'), 720);
      expect(evaluate('2^3!'), 64); // 2^(3!)
      expect(evaluate('50%%'), 0.005);
      expect(evaluate('-3!'), -6);
      expect(evaluate('abs(-4)+exp(0)'), 5);
    });

    test('tryEvaluate formats like String(Number.parseFloat(v.toPrecision(12)))', () {
      expect(tryEvaluate('0.1+0.2'), '0.3');
      expect(tryEvaluate('1/3'), '0.333333333333');
      expect(tryEvaluate('2/3'), '0.666666666667');
      expect(tryEvaluate('10/4'), '2.5');
      expect(tryEvaluate('5!'), '120');
      expect(tryEvaluate('-0'), '0');
      expect(tryEvaluate('10^21'), '1e+21');
      expect(tryEvaluate('10^20'), '100000000000000000000');
      expect(tryEvaluate('1/10^7'), '1e-7');
      expect(tryEvaluate('1/10^6'), '0.000001');
      expect(tryEvaluate('sin(30)', const EvalOptions(degrees: true)), '0.5');
      expect(tryEvaluate('sin(pi)'), '1.22464679915e-16');
      expect(tryEvaluate('2^0.5'), '1.41421356237');
      expect(tryEvaluate('170!'), '7.25741561531e+306');
    });

    test('jsNumberToString matches Number.prototype.toString', () {
      expect(jsNumberToString(120), '120');
      expect(jsNumberToString(-2.5), '-2.5');
      expect(jsNumberToString(1e21), '1e+21');
      expect(jsNumberToString(1.5e-7), '1.5e-7');
      expect(jsNumberToString(123456789012), '123456789012');
    });
  });
}

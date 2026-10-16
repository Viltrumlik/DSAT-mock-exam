// The kit controls on their own: a field's label, hint and error (Field.tsx), the input's
// focus ring (Input.tsx), and a dialog that closes from its × (Modal.tsx).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mastersat_app/core/theme/app_theme.dart';
import 'package:mastersat_app/core/theme/controls.dart';
import 'package:mastersat_app/core/theme/tokens.dart';

Widget _host(Widget child) => MaterialApp(theme: buildAppTheme(), home: Scaffold(body: Center(child: SizedBox(width: 400, child: child))));

void main() {
  testWidgets('AppField shows the label and the hint, and the error instead of the hint', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(_host(AppField(label: 'Login', hint: 'The one your teacher gave you', child: AppTextField(controller: controller))));
    expect(find.text('Login'), findsOneWidget);
    expect(find.text('The one your teacher gave you'), findsOneWidget);

    await tester.pumpWidget(_host(AppField(
      label: 'Login',
      hint: 'The one your teacher gave you',
      error: 'Check the login and try again.',
      child: AppTextField(controller: controller),
    )));
    expect(find.text('The one your teacher gave you'), findsNothing);
    final error = tester.widget<Text>(find.text('Check the login and try again.'));
    expect(error.style!.color, AppColors.dangerForeground);
  });

  testWidgets('AppTextField takes the primary-soft ring while focused and drops it after', (tester) async {
    final controller = TextEditingController();
    final focus = FocusNode();
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    await tester.pumpWidget(_host(AppTextField(controller: controller, focusNode: focus)));
    List<BoxShadow>? shadows() => (tester
            .widget<DecoratedBox>(find.descendant(of: find.byType(AppTextField), matching: find.byType(DecoratedBox)).first)
            .decoration as BoxDecoration)
        .boxShadow;
    expect(shadows(), AppShadows.sm, reason: 'the resting card shadow');
    focus.requestFocus();
    await tester.pump();
    expect(shadows()!.single.color, AppColors.primarySoft);
    expect(shadows()!.single.spreadRadius, 3);
    focus.unfocus();
    await tester.pump();
    expect(shadows(), AppShadows.sm);
  });

  testWidgets('AppDialog closes from its × with no answer', (tester) async {
    Object? answer = 'unset';
    await tester.pumpWidget(_host(Builder(
      builder: (context) => AppButton(
        label: 'Open',
        onPressed: () async => answer = await showAppDialog<bool>(
          context,
          builder: (context) => AppDialog(
            title: 'Delete?',
            message: 'Gone for good.',
            actions: [AppButton(label: 'Delete', onPressed: () => Navigator.of(context).pop(true))],
          ),
        ),
      ),
    )));
    await tester.tap(find.text('Open'));
    await tester.pump();
    expect(find.text('Gone for good.'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Close').last);
    await tester.pump();
    expect(find.text('Gone for good.'), findsNothing);
    expect(answer, isNull);
  });
}

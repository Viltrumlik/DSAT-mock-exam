// Placeholder entry point. The app-core workstream replaces this file with the
// real app (sign-in, Home, library, runner). It exists so the scaffold builds,
// analyses and tests cleanly from the first commit.
import 'package:flutter/widgets.dart';

void main() {
  runApp(const PlaceholderApp());
}

/// A plain, non-Material placeholder window: no demo code, no browser habits.
class PlaceholderApp extends StatelessWidget {
  const PlaceholderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: Color(0xFFFFFFFF),
      child: Center(
        child: Text(
          'MasterSAT',
          textDirection: TextDirection.ltr,
          style: TextStyle(color: Color(0xFF0F172A), fontSize: 20),
        ),
      ),
    );
  }
}

// Which page of the signed-in shell is open: Past papers, Midterms or Settings (the website's
// student sidebar, components/shell/AppShell.tsx). Pages switch instantly — they are all drawn
// from the cached Home, nothing waits on the network.
//
// Landing rule: right after sign-in (or launch), the first Home the app has decides — Midterms
// when a midterm can be sat now, otherwise Past papers. Once the student picks a page, the app
// never moves them again.
import 'package:flutter/foundation.dart';

import '../../core/models/models.dart';
import '../home/midterm_model.dart';

enum ShellSection {
  pastPapers('Past papers'),
  midterms('Midterms'),
  settings('Settings');

  const ShellSection(this.label);

  /// The sidebar label and the top bar's title.
  final String label;
}

class ShellController extends ChangeNotifier {
  ShellSection _section = ShellSection.pastPapers;
  bool _landed = false;
  bool _chosen = false;

  ShellSection get section => _section;

  /// The student opened a page (the sidebar, Ctrl+F, Settings from anywhere).
  void select(ShellSection section) {
    _chosen = true;
    _landed = true;
    if (_section == section) return;
    _section = section;
    notifyListeners();
  }

  /// The landing rule, applied once to the first Home there is.
  void land(HomeResponse? home) {
    if (_landed || home == null) return;
    _landed = true;
    if (_chosen) return;
    final next = landingFor(home);
    if (next == _section) return;
    _section = next;
    notifyListeners();
  }

  /// Signed out: the next student lands afresh.
  void reset() {
    _landed = false;
    _chosen = false;
    if (_section == ShellSection.pastPapers) return;
    _section = ShellSection.pastPapers;
    notifyListeners();
  }
}

/// Midterms when one is available now (the website's "Available now" bucket), else Past papers.
ShellSection landingFor(HomeResponse home) =>
    bucketMidterms(home.midterms).available.isNotEmpty ? ShellSection.midterms : ShellSection.pastPapers;

/// How many midterms can be sat now (the sidebar's badge on Midterms).
int availableMidterms(HomeResponse? home) => home == null ? 0 : bucketMidterms(home.midterms).available.length;

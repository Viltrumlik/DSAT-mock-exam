// Past papers — the website's /pastpapers page (app/(main)/pastpapers/page.tsx) in the shell:
// "SIMULATION" over "Past papers", then the filters, the search and the booklet cards
// (library_section.dart). Before Home has ever arrived it shows the loading blocks, or why
// there is nothing.
import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../shell/shell_page.dart';
import 'library_section.dart';

class PastPapersPage extends StatelessWidget {
  const PastPapersPage({super.key, required this.searchFocus, this.searchKey, this.controller});

  final FocusNode searchFocus;
  final GlobalKey? searchKey;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    final home = AppScope.of(context).home;
    return ListenableBuilder(
      listenable: home,
      builder: (context, _) {
        final data = home.home;
        return ShellPage(
          controller: controller,
          children: [
            const HomeBanners(),
            const PageHeading(eyebrow: 'SIMULATION', title: 'Past papers'),
            const SizedBox(height: 10),
            Text('Full SAT sections, timed like test day.', style: AppText.bodyMuted.copyWith(fontSize: 15)),
            const SizedBox(height: 22),
            if (data == null)
              HomeNoData(home: home)
            else
              LibrarySection(papers: data.pastpapers, searchFocus: searchFocus, searchKey: searchKey),
          ],
        );
      },
    );
  }
}

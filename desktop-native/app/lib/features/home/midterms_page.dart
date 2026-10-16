// Midterms — the website's /midterm page (app/(main)/midterm/MidtermList.tsx) in the shell:
// "MIDTERM" over the title, the filter tabs (All / Available now / Scheduled / Past), then the
// midterms as a timeline (midterm_section.dart), at most 896 px wide.
import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import '../../core/theme/tokens.dart';
import '../shell/shell_page.dart';
import 'midterm_section.dart';

class MidtermsPage extends StatelessWidget {
  const MidtermsPage({super.key, this.controller});

  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final home = services.home;
    return ListenableBuilder(
      listenable: home,
      builder: (context, _) {
        final data = home.home;
        return ShellPage(
          controller: controller,
          // `max-w-4xl px-6 py-8` (896 with its padding) inside the shell's px-8 py-5.
          maxWidth: 848,
          padding: const EdgeInsets.fromLTRB(56, 52, 56, 52),
          children: [
            const HomeBanners(),
            PageHeading(
              eyebrow: 'MIDTERM',
              title: 'Midterms',
              eyebrowTracking: 0.16,
              eyebrowColor: AppColors.slate400,
              gap: 4,
              titleSize: 34,
              titleTracking: 0,
              titleHeight: 1.25,
            ),
            const SizedBox(height: 6),
            Text(
              'Each runs locked down — the app closes everything else until you finish.',
              style: AppText.body.copyWith(fontWeight: FontWeight.w500, color: AppColors.mute),
            ),
            const SizedBox(height: 20),
            if (data == null)
              HomeNoData(home: home, skeleton: const HomeSkeleton(heights: [74, 74, 74], grid: false))
            else
              MidtermSection(midterms: data.midterms, offline: home.offline, serverNow: services.serverClock.now),
          ],
        );
      },
    );
  }
}

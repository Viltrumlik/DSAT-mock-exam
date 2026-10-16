// Past papers (architecture §8; the website's pastpapers/page.tsx): Region / Year / Status /
// Subject chips with counts, a search that ignores case and accents (Ctrl+F focuses it, Esc
// clears it), "Clear filters", and booklet cards grouped by month, newest first, in as many
// 380 px+ columns as fit (gap 18).
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app.dart';
import '../../core/models/models.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/controls.dart';
import 'booklet_card.dart';
import 'library_controller.dart';
import 'pastpaper_model.dart';

class LibrarySection extends StatefulWidget {
  const LibrarySection({super.key, required this.papers, required this.searchFocus, this.searchKey});

  final List<PastpaperRow> papers;
  final FocusNode searchFocus;
  final GlobalKey? searchKey;

  @override
  State<LibrarySection> createState() => _LibrarySectionState();
}

class _LibrarySectionState extends State<LibrarySection> {
  late final TextEditingController _search;
  late final LibraryController _library;

  @override
  void initState() {
    super.initState();
    _library = AppScope.of(context).library;
    _search = TextEditingController(text: _library.filters.query);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _clearSearch() {
    _search.clear();
    _library.setQuery('');
  }

  void _clearAll() {
    _search.clear();
    _library.clear();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _library,
      builder: (context, _) {
        final view = _library.viewFor(widget.papers);
        final f = view.filters;
        if (_search.text != f.query) _search.text = f.query;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 24,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SegmentedFilter<RegionFilter>(
                  label: 'REGION',
                  selected: f.region,
                  onChanged: _library.setRegion,
                  options: [for (final r in RegionFilter.values) FilterOption(r, r.label, count: view.regionCounts[r])],
                ),
                if (view.years.isNotEmpty)
                  SegmentedFilter<String>(
                    label: 'YEAR',
                    selected: f.year,
                    onChanged: _library.setYear,
                    options: [
                      FilterOption(allYears, 'All', count: view.yearCounts[allYears]),
                      for (final y in view.years) FilterOption(y, y, count: view.yearCounts[y]),
                    ],
                  ),
                SegmentedFilter<StatusFilter>(
                  label: 'STATUS',
                  selected: f.status,
                  onChanged: _library.setStatus,
                  options: [for (final s in StatusFilter.values) FilterOption(s, s.label, count: view.statusCounts[s])],
                ),
                SegmentedFilter<SubjectFilter>(
                  label: 'SUBJECT',
                  selected: f.subject,
                  onChanged: _library.setSubject,
                  options: [for (final s in SubjectFilter.values) FilterOption(s, s.label, count: view.subjectCounts[s])],
                ),
              ],
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Flexible(
                  child: ConstrainedBox(
                    key: widget.searchKey,
                    constraints: const BoxConstraints(maxWidth: 560),
                    child: AppTextField(
                      controller: _search,
                      focusNode: widget.searchFocus,
                      look: AppFieldLook.search,
                      hint: 'Search past papers…',
                      prefixIcon: LucideIcons.search,
                      semanticLabel: 'Search past papers',
                      onChanged: _library.setQuery,
                      onClear: _clearSearch,
                      onEscape: _clearSearch,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                if (f.hasFilter) AppLinkButton(label: 'Clear filters', icon: LucideIcons.x, onPressed: _clearAll),
                const Spacer(),
                const SizedBox(width: 14),
                Text(
                  view.shown == view.total
                      ? '${view.total} ${view.total == 1 ? 'paper' : 'papers'}'
                      : '${view.shown} of ${view.total} papers',
                  style: AppText.caption.copyWith(fontSize: 13),
                ),
              ],
            ),
            const SizedBox(height: 24),
            if (view.groups.isEmpty)
              f.hasFilter
                  ? EmptyState(
                      icon: LucideIcons.fileText,
                      title: 'No matching papers',
                      message: 'Try a different region, year, status, subject, or search.',
                      actionLabel: 'Clear filters',
                      actionIcon: LucideIcons.x,
                      onAction: _clearAll,
                    )
                  : const EmptyState(
                      icon: LucideIcons.fileText,
                      title: 'No past papers yet',
                      message: 'Released SAT papers will appear here once added.',
                    )
            else
              for (final g in view.groups) ...[
                if (g != view.groups.first) const SizedBox(height: 30),
                GroupHeader(label: g.name, count: g.items.length),
                _CardGrid(items: g.items),
              ],
          ],
        );
      },
    );
  }
}

/// Booklet cards in equal-height rows: `repeat(auto-fill, minmax(380px, 1fr))`, gap 18.
class _CardGrid extends StatelessWidget {
  const _CardGrid({required this.items});

  final List<PaperItem> items;

  static const _gap = 18.0;
  static const _minWidth = 380.0;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final cols = ((c.maxWidth + _gap) / (_minWidth + _gap)).floor().clamp(1, 4);
      final rows = <Widget>[];
      for (var i = 0; i < items.length; i += cols) {
        final chunk = items.sublist(i, (i + cols).clamp(0, items.length));
        rows.add(Padding(
          padding: EdgeInsets.only(bottom: i + cols < items.length ? _gap : 0),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var j = 0; j < cols; j++) ...[
                  if (j > 0) const SizedBox(width: _gap),
                  Expanded(child: j < chunk.length ? BookletCard(item: chunk[j]) : const SizedBox.shrink()),
                ],
              ],
            ),
          ),
        ));
      }
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
    });
  }
}

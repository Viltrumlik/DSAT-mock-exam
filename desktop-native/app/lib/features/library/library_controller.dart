// The library's filter state: chips saved per student (settings table), the search text kept
// for the session. The view is recomputed in memory from `home.pastpapers` (about 45–60 rows),
// so filtering is instant and works offline.
import 'package:flutter/foundation.dart';

import '../../core/models/models.dart';
import '../../core/store/settings_store.dart';
import 'pastpaper_model.dart';

class LibraryController extends ChangeNotifier {
  LibraryFilters _filters = const LibraryFilters();
  SettingsStore? _settings;
  List<PastpaperRow>? _lastPapers;
  LibraryFilters? _lastFilters;
  LibraryView? _view;

  LibraryFilters get filters => _filters;

  /// Loads the saved chips of the student whose store just opened.
  void attach(SettingsStore settings) {
    _settings = settings;
    final saved = LibraryFilters.fromJson(settings.readMap(SettingsKeys.libraryFilters));
    _filters = saved.copyWith(query: _filters.query);
    notifyListeners();
  }

  /// Back to defaults (sign-out).
  void reset() {
    _settings = null;
    _filters = const LibraryFilters();
    _view = null;
    _lastPapers = null;
    notifyListeners();
  }

  /// The filtered, grouped view of [papers] (memoised on identity + filters).
  LibraryView viewFor(List<PastpaperRow> papers) {
    final v = _view;
    if (v != null && identical(papers, _lastPapers) && _filters == _lastFilters) return v;
    _lastPapers = papers;
    _lastFilters = _filters;
    return _view = LibraryView.compute(papers, _filters);
  }

  void setRegion(RegionFilter r) => _update(_filters.copyWith(region: r));
  void setYear(String y) => _update(_filters.copyWith(year: y));
  void setStatus(StatusFilter s) => _update(_filters.copyWith(status: s));
  void setSubject(SubjectFilter s) => _update(_filters.copyWith(subject: s));
  void setQuery(String q) => _update(_filters.copyWith(query: q), save: false);

  /// "Clear filters": every chip back to All and the search emptied.
  void clear() => _update(const LibraryFilters());

  void _update(LibraryFilters next, {bool save = true}) {
    if (next == _filters) return;
    final chipsChanged = next.toJson().toString() != _filters.toJson().toString();
    _filters = next;
    notifyListeners();
    if (save && chipsChanged) {
      _settings?.write(SettingsKeys.libraryFilters, next.toJson());
    }
  }
}

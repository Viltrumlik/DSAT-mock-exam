// Strict, hand-written JSON helpers shared by every v1 model.
//
// Conventions (see desktop-native/contracts/v1/README.md):
//  * a *required* key must be present; a missing one is a FormatException naming its path;
//  * an `...OrNull` read accepts a missing key or JSON null (so additive server fields and
//    optional fields both work);
//  * unknown keys are ignored when parsing (v1 evolves additively);
//  * timestamps are ISO-8601 UTC with milliseconds (`2026-10-11T09:00:00.000Z`).

/// A JSON object plus the path it was found at, for precise error messages.
class JsonReader {
  JsonReader(this.json, [this.path = r'$']);

  /// Parses [value] as a JSON object or throws a [FormatException].
  factory JsonReader.of(Object? value, [String path = r'$']) {
    if (value is Map<String, Object?>) return JsonReader(value, path);
    if (value is Map) return JsonReader(value.cast<String, Object?>(), path);
    throw FormatException('Expected a JSON object at $path, got ${_typeName(value)}');
  }

  final Map<String, Object?> json;
  final String path;

  bool has(String key) => json.containsKey(key);

  String _at(String key) => '$path.$key';

  Object? _required(String key) {
    if (!json.containsKey(key)) {
      throw FormatException('Missing required key ${_at(key)}');
    }
    return json[key];
  }

  T _as<T>(Object? v, String key) {
    if (v is T) return v;
    throw FormatException('Expected ${T.toString()} at ${_at(key)}, got ${_typeName(v)}');
  }

  int integer(String key) => _toInt(_required(key), _at(key));

  int? integerOrNull(String key) {
    final v = json[key];
    return v == null ? null : _toInt(v, _at(key));
  }

  double number(String key) => _toDouble(_required(key), _at(key));

  double? numberOrNull(String key) {
    final v = json[key];
    return v == null ? null : _toDouble(v, _at(key));
  }

  String string(String key) => _as<String>(_required(key), key);

  String? stringOrNull(String key) {
    final v = json[key];
    return v == null ? null : _as<String>(v, key);
  }

  bool boolean(String key) => _as<bool>(_required(key), key);

  bool? booleanOrNull(String key) {
    final v = json[key];
    return v == null ? null : _as<bool>(v, key);
  }

  DateTime timestamp(String key) => parseTimestamp(string(key), _at(key));

  DateTime? timestampOrNull(String key) {
    final s = stringOrNull(key);
    return s == null ? null : parseTimestamp(s, _at(key));
  }

  JsonReader object(String key) => JsonReader.of(_required(key), _at(key));

  JsonReader? objectOrNull(String key) {
    final v = json[key];
    return v == null ? null : JsonReader.of(v, _at(key));
  }

  /// The raw value (any JSON) — for opaque payloads such as Desmos state.
  Object? raw(String key) => json[key];

  List<T> list<T>(String key, T Function(Object? item, String path) parse) =>
      _list(_required(key), _at(key), parse);

  List<T>? listOrNull<T>(String key, T Function(Object? item, String path) parse) {
    final v = json[key];
    return v == null ? null : _list(v, _at(key), parse);
  }

  List<T> objects<T>(String key, T Function(JsonReader r) parse) =>
      list(key, (item, p) => parse(JsonReader.of(item, p)));

  List<T>? objectsOrNull<T>(String key, T Function(JsonReader r) parse) =>
      listOrNull(key, (item, p) => parse(JsonReader.of(item, p)));

  List<int> ints(String key) => list(key, (v, p) => _toInt(v, p));

  /// A JSON object used as a map: `{"301": ...}`. Insertion order is preserved.
  Map<String, T> map<T>(String key, T Function(Object? value, String path) parse) {
    final r = object(key);
    return {for (final e in r.json.entries) e.key: parse(e.value, '${r.path}.${e.key}')};
  }

  Map<String, T>? mapOrNull<T>(String key, T Function(Object? value, String path) parse) {
    if (json[key] == null) return null;
    return map(key, parse);
  }

  static List<T> _list<T>(Object? v, String path, T Function(Object? item, String path) parse) {
    if (v is! List) throw FormatException('Expected a JSON array at $path, got ${_typeName(v)}');
    return [for (var i = 0; i < v.length; i++) parse(v[i], '$path[$i]')];
  }
}

int _toInt(Object? v, String path) {
  if (v is int) return v;
  if (v is double && v == v.roundToDouble()) return v.toInt();
  throw FormatException('Expected an integer at $path, got ${_typeName(v)}');
}

double _toDouble(Object? v, String path) {
  if (v is num) return v.toDouble();
  throw FormatException('Expected a number at $path, got ${_typeName(v)}');
}

String _typeName(Object? v) => v == null ? 'null' : v.runtimeType.toString();

/// Integer parse of a JSON value (for list/map element parsers).
int jsonInt(Object? v, String path) => _toInt(v, path);

/// String parse of a JSON value (for list/map element parsers).
String jsonString(Object? v, String path) {
  if (v is String) return v;
  throw FormatException('Expected a string at $path, got ${_typeName(v)}');
}

/// A JSON array of integers.
List<int> jsonIntList(Object? v, String path) {
  if (v is! List) throw FormatException('Expected a JSON array at $path, got ${_typeName(v)}');
  return [for (var i = 0; i < v.length; i++) _toInt(v[i], '$path[$i]')];
}

/// A JSON object whose values are all strings (e.g. an answer map).
Map<String, String> jsonStringMap(Object? v, String path) {
  final r = JsonReader.of(v, path);
  return {for (final e in r.json.entries) e.key: jsonString(e.value, '$path.${e.key}')};
}

/// Parses an ISO-8601 timestamp and normalises it to UTC.
DateTime parseTimestamp(String s, [String path = r'$']) {
  final dt = DateTime.tryParse(s);
  if (dt == null) throw FormatException('Expected an ISO-8601 timestamp at $path, got "$s"');
  return dt.toUtc();
}

/// Formats a timestamp the v1 way: UTC, millisecond precision, `Z` suffix.
String formatTimestamp(DateTime dt) {
  final u = dt.toUtc();
  String two(int n) => n.toString().padLeft(2, '0');
  final ms = u.millisecond.toString().padLeft(3, '0');
  return '${u.year.toString().padLeft(4, '0')}-${two(u.month)}-${two(u.day)}'
      'T${two(u.hour)}:${two(u.minute)}:${two(u.second)}.${ms}Z';
}

String? formatTimestampOrNull(DateTime? dt) => dt == null ? null : formatTimestamp(dt);

/// `{301: x}` → `{"301": x}` for JSON encoding of int-keyed maps.
Map<String, V> stringKeys<V>(Map<int, V> m) => {for (final e in m.entries) '${e.key}': e.value};

/// `{"301": x}` → `{301: x}`.
Map<int, V> intKeys<V>(Map<String, V> m, [String path = r'$']) {
  return {
    for (final e in m.entries)
      (int.tryParse(e.key) ?? (throw FormatException('Expected an integer key at $path.${e.key}'))): e.value,
  };
}

/// Looks up a wire value in an enum that exposes `wire`, or throws.
T enumFromWire<T extends Enum>(List<T> values, String wire, String Function(T) wireOf, String path) {
  for (final v in values) {
    if (wireOf(v) == wire) return v;
  }
  throw FormatException('Unknown value "$wire" at $path (expected one of ${values.map(wireOf).join(', ')})');
}

/// Tiny scope helper used by the parsers (`x?.let(f)`).
extension LetExtension<T> on T {
  R let<R>(R Function(T it) f) => f(this);
}

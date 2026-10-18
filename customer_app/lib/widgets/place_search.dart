import 'dart:async';

import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../api.dart';
import '../models.dart';

/// 주소·장소 이름으로 위치 찾기 (카카오 로컬 검색). 고른 장소를 돌려준다.
Future<Place?> searchPlace(BuildContext context, {required String title, LatLng? near}) {
  return Navigator.of(context).push<Place>(MaterialPageRoute(builder: (_) => _PlaceSearch(title: title, near: near)));
}

class _PlaceSearch extends StatefulWidget {
  const _PlaceSearch({required this.title, this.near});
  final String title;
  final LatLng? near;
  @override
  State<_PlaceSearch> createState() => _PlaceSearchState();
}

class _PlaceSearchState extends State<_PlaceSearch> {
  final _q = TextEditingController();
  Timer? _debounce;
  List<Place> _places = [];
  String? _message;
  bool _loading = false;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _changed(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => _search(v));
  }

  Future<void> _search(String v) async {
    final q = v.trim();
    if (q.length < 2) {
      setState(() { _places = []; _message = null; });
      return;
    }
    setState(() => _loading = true);
    try {
      final r = await Api.instance.searchPlaces(q, lat: widget.near?.latitude, lng: widget.near?.longitude);
      if (!mounted || _q.text.trim() != q) return;
      setState(() {
        _places = r.places;
        _message = !r.enabled ? '주소 검색이 아직 연결되지 않았어요. 지도에서 골라 주세요.' : r.places.isEmpty ? '찾는 곳이 없어요. 다르게 적어 보세요.' : null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() { _places = []; _message = e.message; });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: TextField(
            controller: _q,
            autofocus: true,
            textInputAction: TextInputAction.search,
            onChanged: _changed,
            onSubmitted: _search,
            decoration: InputDecoration(
              hintText: '도로명, 지번, 건물·장소 이름',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _loading ? const Padding(padding: EdgeInsets.all(14), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))) : null,
            ),
          ),
        ),
        if (_message != null) Padding(padding: const EdgeInsets.all(16), child: Text(_message!, style: const TextStyle(color: Colors.black54))),
        Expanded(
          child: ListView.separated(
            itemCount: _places.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (_, i) {
              final p = _places[i];
              return ListTile(
                leading: const Icon(Icons.place_outlined),
                title: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(p.label),
                onTap: () => Navigator.pop(context, p),
              );
            },
          ),
        ),
      ]),
    );
  }
}

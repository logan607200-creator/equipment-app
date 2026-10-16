import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

/// 위치를 못 받으면 쓰는 기본 위치 (강남역)
const fallbackLocation = LatLng(37.4979, 127.0276);

Future<LatLng> currentLocation() async {
  try {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return fallbackLocation;
    final p = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 8)),
    );
    return LatLng(p.latitude, p.longitude);
  } catch (_) {
    return fallbackLocation;
  }
}

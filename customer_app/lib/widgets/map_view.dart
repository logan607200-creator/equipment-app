import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../theme.dart';

class MapPin {
  const MapPin(this.point, this.icon, {this.color = ink, this.label});
  final LatLng point;
  final IconData icon;
  final Color color;
  final String? label;
}

/// 지도. 지금은 OpenStreetMap 타일을 쓰고, 출시 전에 카카오맵·네이버지도로 바꾼다.
class MapView extends StatelessWidget {
  const MapView({super.key, required this.center, this.pins = const [], this.zoom = 15, this.onTap, this.controller});
  final LatLng center;
  final List<MapPin> pins;
  final double zoom;
  final void Function(LatLng)? onTap;
  final MapController? controller;

  @override
  Widget build(BuildContext context) {
    return FlutterMap(
      mapController: controller,
      options: MapOptions(
        initialCenter: center,
        initialZoom: zoom,
        backgroundColor: const Color(0xFFE9E6DF),
        onTap: onTap == null ? null : (_, p) => onTap!(p),
      ),
      children: [
        TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'kr.equipmentcall.customer_app'),
        MarkerLayer(markers: [
          for (final pin in pins)
            Marker(
              point: pin.point,
              width: 120,
              height: 64,
              alignment: Alignment.topCenter,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (pin.label != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(color: ink, borderRadius: BorderRadius.circular(8)),
                    child: Text(pin.label!, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
                  ),
                Icon(pin.icon, color: pin.color, size: 36),
              ]),
            ),
        ]),
      ],
    );
  }
}

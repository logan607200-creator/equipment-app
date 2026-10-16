import 'package:intl/intl.dart';

final _won = NumberFormat('#,###', 'ko');
String won(int v) => '${_won.format(v)}원';
String wonRange(int min, int max) => min == max ? won(min) : '${won(min)} ~ ${won(max)}';
String dateTime(DateTime d) => DateFormat('M월 d일 (E) a h:mm', 'ko').format(d);

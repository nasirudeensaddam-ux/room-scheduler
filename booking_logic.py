from __future__ import annotations

import datetime
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP

MAX_ROOM_NAME_LENGTH = 120


OCCUPANCY_WINDOW_START_MIN = 9 * 60
OCCUPANCY_WINDOW_END_MIN = 18 * 60
OCCUPANCY_WINDOW_SPAN_MIN = OCCUPANCY_WINDOW_END_MIN - OCCUPANCY_WINDOW_START_MIN


def parse_time_to_minutes(time_value: str | None) -> int | None:
    if not time_value or not isinstance(time_value, str):
        return None
    parts = time_value.strip().split(":")
    if len(parts) < 2:
        return None
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except ValueError:
        return None
    return hours * 60 + minutes


def intervals_overlap_half_open(
    start_a: int, end_a: int, start_b: int, end_b: int
) -> bool:
    return start_a < end_b and start_b < end_a


def fetch_bookings_for_room_and_day(
    db: Any, room_id: str, date_iso: str
) -> list[dict[str, Any]]:
    q = (
        db.collection("bookings")
        .where("roomId", "==", room_id)
        .where("dateIso", "==", date_iso)
    )
    return [{"id": s.id, **s.to_dict()} for s in q.stream()]


def assert_no_booking_clash(
    db: Any,
    room_id: str,
    date_iso: str,
    start_time: str,
    end_time: str,
    exclude_booking_id: str | None = None,
) -> None:
    start_m = parse_time_to_minutes(start_time)
    end_m = parse_time_to_minutes(end_time)
    if start_m is None or end_m is None:
        raise ValueError("Start and end times must be valid.")
    if end_m <= start_m:
        raise ValueError("End time must be after start time.")

    for b in fetch_bookings_for_room_and_day(db, room_id, date_iso):
        if exclude_booking_id and b.get("id") == exclude_booking_id:
            continue
        b_start = parse_time_to_minutes(str(b.get("startTime") or ""))
        b_end = parse_time_to_minutes(str(b.get("endTime") or ""))
        if b_start is None or b_end is None:
            continue
        if intervals_overlap_half_open(start_m, end_m, b_start, b_end):
            raise ValueError("This time overlaps an existing booking for that room.")


def get_or_create_day(db: Any, room_id: str, date_iso: str) -> str:
    q = (
        db.collection("days")
        .where("roomId", "==", room_id)
        .where("dateIso", "==", date_iso)
        .limit(1)
    )
    for snap in q.stream():
        return snap.id

    doc_ref = db.collection("days").document()
    doc_ref.set(
        {
            "roomId": room_id,
            "dateIso": date_iso,
            "createdAt": SERVER_TIMESTAMP,
        }
    )
    return doc_ref.id


def room_has_any_booking(db: Any, room_id: str) -> bool:
    q = db.collection("bookings").where("roomId", "==", room_id).limit(1)
    return any(True for _ in q.stream())


def normalize_room_name(name: str) -> str:
    return name.strip().lower()


def room_name_exists(db: Any, normalized: str) -> bool:
    q = (
        db.collection("rooms")
        .where("normalizedName", "==", normalized)
        .limit(1)
    )
    return any(True for _ in q.stream())


def create_room(db: Any, user_uid: str, name: str) -> None:
    trimmed = name.strip()
    if not trimmed:
        raise ValueError("Room name is required.")
    if len(trimmed) > MAX_ROOM_NAME_LENGTH:
        raise ValueError(
            f"Room name must be at most {MAX_ROOM_NAME_LENGTH} characters."
        )
    normalized = normalize_room_name(trimmed)
    if room_name_exists(db, normalized):
        raise ValueError("A room with this name already exists.")

    db.collection("rooms").document().set(
        {
            "name": trimmed,
            "normalizedName": normalized,
            "ownerUid": user_uid,
            "createdAt": SERVER_TIMESTAMP,
        }
    )


def list_rooms_sorted(db: Any) -> list[dict[str, Any]]:
    rooms: list[dict[str, Any]] = []
    for snap in db.collection("rooms").stream():
        rooms.append({"id": snap.id, **(snap.to_dict() or {})})
    rooms.sort(key=lambda r: str(r.get("name") or ""))
    return rooms


def list_user_bookings(db: Any, user_uid: str) -> list[dict[str, Any]]:
    q = db.collection("bookings").where("userUid", "==", user_uid)
    items = [{"id": s.id, **(s.to_dict() or {})} for s in q.stream()]
    items.sort(
        key=lambda b: (
            str(b.get("dateIso") or ""),
            str(b.get("startTime") or ""),
        )
    )
    return items


def list_user_bookings_for_room(
    db: Any, user_uid: str, room_id: str
) -> list[dict[str, Any]]:
    q = (
        db.collection("bookings")
        .where("userUid", "==", user_uid)
        .where("roomId", "==", room_id)
    )
    items = [{"id": s.id, **(s.to_dict() or {})} for s in q.stream()]
    items.sort(
        key=lambda b: (
            str(b.get("dateIso") or ""),
            str(b.get("startTime") or ""),
        )
    )
    return items


def get_booking(db: Any, booking_id: str) -> dict[str, Any] | None:
    snap = db.collection("bookings").document(booking_id).get()
    if not snap.exists:
        return None
    return {"id": snap.id, **(snap.to_dict() or {})}


def create_booking(
    db: Any, user_uid: str, room_id: str, date_iso: str, start: str, end: str
) -> None:
    assert_no_booking_clash(db, room_id, date_iso, start, end, None)
    day_id = get_or_create_day(db, room_id, date_iso)
    db.collection("bookings").document().set(
        {
            "roomId": room_id,
            "dayId": day_id,
            "dateIso": date_iso,
            "startTime": start,
            "endTime": end,
            "userUid": user_uid,
            "createdAt": SERVER_TIMESTAMP,
        }
    )


def update_booking(
    db: Any,
    booking_id: str,
    user_uid: str,
    room_id: str,
    date_iso: str,
    start: str,
    end: str,
) -> None:
    snap = db.collection("bookings").document(booking_id).get()
    if not snap.exists:
        raise ValueError("Booking not found.")
    data = snap.to_dict() or {}
    if data.get("userUid") != user_uid:
        raise PermissionError("You can only edit your own bookings.")

    assert_no_booking_clash(db, room_id, date_iso, start, end, booking_id)
    day_id = get_or_create_day(db, room_id, date_iso)
    snap.reference.update(
        {
            "roomId": room_id,
            "dayId": day_id,
            "dateIso": date_iso,
            "startTime": start,
            "endTime": end,
        }
    )


def delete_booking(db: Any, booking_id: str, user_uid: str) -> None:
    snap = db.collection("bookings").document(booking_id).get()
    if not snap.exists:
        raise ValueError("Booking not found.")
    if (snap.to_dict() or {}).get("userUid") != user_uid:
        raise PermissionError("You can only delete your own bookings.")
    snap.reference.delete()


def delete_room(db: Any, room_id: str, user_uid: str) -> None:
    snap = db.collection("rooms").document(room_id).get()
    if not snap.exists:
        raise ValueError("Room not found.")
    data = snap.to_dict() or {}
    if data.get("ownerUid") != user_uid:
        raise PermissionError("Only the creator can delete this room.")
    if room_has_any_booking(db, room_id):
        raise ValueError("Cannot delete a room that still has bookings.")
    snap.reference.delete()


def room_name_by_id(rooms: list[dict[str, Any]], room_id: str) -> str:
    for r in rooms:
        if r.get("id") == room_id:
            return str(r.get("name") or room_id)
    return room_id


def normalize_time_for_input(value: str | None) -> str:
    s = str(value or "").strip()
    if not s:
        return ""
    parts = s.split(":")
    if len(parts) < 2:
        return ""
    return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}"


def get_room(db: Any, room_id: str) -> dict[str, Any] | None:
    snap = db.collection("rooms").document(room_id).get()
    if not snap.exists:
        return None
    return {"id": snap.id, **(snap.to_dict() or {})}


def list_bookings_on_date_all_rooms(db: Any, date_iso: str) -> list[dict[str, Any]]:
    q = db.collection("bookings").where("dateIso", "==", date_iso)
    return [{"id": s.id, **(s.to_dict() or {})} for s in q.stream()]


def sort_day_bookings_for_display(
    bookings: list[dict[str, Any]], rooms: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    return sorted(
        bookings,
        key=lambda b: (
            room_name_by_id(rooms, str(b.get("roomId") or "")),
            str(b.get("startTime") or ""),
        ),
    )


def list_all_bookings_for_room(db: Any, room_id: str) -> list[dict[str, Any]]:
    q = db.collection("bookings").where("roomId", "==", room_id)
    items = [{"id": s.id, **(s.to_dict() or {})} for s in q.stream()]
    items.sort(
        key=lambda b: (
            str(b.get("dateIso") or ""),
            str(b.get("startTime") or ""),
        )
    )
    return items


def minutes_to_hhmm(total_minutes: int) -> str:
    h, m = divmod(int(total_minutes), 60)
    return f"{h:02d}:{m:02d}"


def _merged_intervals_in_window(
    bookings: list[dict[str, Any]],
    date_iso: str,
    win_lo: int,
    win_hi: int,
) -> list[tuple[int, int]]:
    """Booked intervals clipped to [win_lo, win_hi), merged."""
    raw: list[tuple[int, int]] = []
    for b in bookings:
        if str(b.get("dateIso") or "") != date_iso:
            continue
        s = parse_time_to_minutes(str(b.get("startTime") or ""))
        e = parse_time_to_minutes(str(b.get("endTime") or ""))
        if s is None or e is None or e <= s:
            continue
        lo = max(s, win_lo)
        hi = min(e, win_hi)
        if hi > lo:
            raw.append((lo, hi))
    if not raw:
        return []
    raw.sort()
    merged: list[tuple[int, int]] = []
    cur_lo, cur_hi = raw[0]
    for lo, hi in raw[1:]:
        if lo < cur_hi:
            cur_hi = max(cur_hi, hi)
        else:
            merged.append((cur_lo, cur_hi))
            cur_lo, cur_hi = lo, hi
    merged.append((cur_lo, cur_hi))
    return merged


def _merged_minutes_in_window(
    bookings: list[dict[str, Any]],
    date_iso: str,
    win_lo: int,
    win_hi: int,
) -> int:
    merged = _merged_intervals_in_window(bookings, date_iso, win_lo, win_hi)
    return sum(hi - lo for lo, hi in merged)


def _slot_touches_merged(slot_lo: int, slot_hi: int, merged: list[tuple[int, int]]) -> bool:
    for lo, hi in merged:
        if slot_lo < hi and lo < slot_hi:
            return True
    return False


CALENDAR_SLOT_MINUTES = 30
CALENDAR_SLOT_COUNT = OCCUPANCY_WINDOW_SPAN_MIN // CALENDAR_SLOT_MINUTES


def earliest_free_start_next_five_days(
    db: Any,
    room_id: str,
    anchor: datetime.date,
) -> dict[str, str] | None:
    for i in range(5):
        d = anchor + datetime.timedelta(days=i)
        date_iso = d.isoformat()
        day_bookings = fetch_bookings_for_room_and_day(db, room_id, date_iso)
        merged = _merged_intervals_in_window(
            day_bookings,
            date_iso,
            OCCUPANCY_WINDOW_START_MIN,
            OCCUPANCY_WINDOW_END_MIN,
        )
        cursor = OCCUPANCY_WINDOW_START_MIN
        for lo, hi in merged:
            if cursor < lo:
                return {"date_iso": date_iso, "time": minutes_to_hhmm(cursor)}
            cursor = max(cursor, hi)
        if cursor < OCCUPANCY_WINDOW_END_MIN:
            return {"date_iso": date_iso, "time": minutes_to_hhmm(cursor)}
    return None


def calendar_grid_next_five_days(
    db: Any,
    room_id: str,
    anchor: datetime.date,
) -> list[dict[str, Any]]:
    days_out: list[dict[str, Any]] = []
    for i in range(5):
        d = anchor + datetime.timedelta(days=i)
        date_iso = d.isoformat()
        day_bookings = fetch_bookings_for_room_and_day(db, room_id, date_iso)
        merged = _merged_intervals_in_window(
            day_bookings,
            date_iso,
            OCCUPANCY_WINDOW_START_MIN,
            OCCUPANCY_WINDOW_END_MIN,
        )
        slots: list[dict[str, Any]] = []
        for j in range(CALENDAR_SLOT_COUNT):
            slot_lo = OCCUPANCY_WINDOW_START_MIN + j * CALENDAR_SLOT_MINUTES
            slot_hi = slot_lo + CALENDAR_SLOT_MINUTES
            slots.append(
                {
                    "start": minutes_to_hhmm(slot_lo),
                    "end": minutes_to_hhmm(slot_hi),
                    "booked": _slot_touches_merged(slot_lo, slot_hi, merged),
                }
            )
        days_out.append(
            {
                "date_iso": date_iso,
                "weekday": d.strftime("%a"),
                "slots": slots,
            }
        )
    return days_out


def occupancy_for_room_next_five_days(
    db: Any,
    room_id: str,
    anchor: datetime.date,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(5):
        d = anchor + datetime.timedelta(days=i)
        date_iso = d.isoformat()
        day_bookings = fetch_bookings_for_room_and_day(db, room_id, date_iso)
        booked = _merged_minutes_in_window(
            day_bookings,
            date_iso,
            OCCUPANCY_WINDOW_START_MIN,
            OCCUPANCY_WINDOW_END_MIN,
        )
        pct = round(
            (booked / OCCUPANCY_WINDOW_SPAN_MIN) * 100.0,
            1,
        )
        if pct > 100.0:
            pct = 100.0
        rows.append(
            {
                "date_iso": date_iso,
                "booked_minutes": booked,
                "percent": pct,
            }
        )
    return rows

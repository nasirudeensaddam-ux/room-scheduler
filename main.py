from __future__ import annotations

import datetime
import os
import secrets
from functools import wraps

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials, firestore
from flask import (
    Flask,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

import booking_logic as bl

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-insecure-change-me")

_firestore_client = None


def init_firebase() -> None:
    if firebase_admin._apps:
        return
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if path and os.path.isfile(path):
        cred = credentials.Certificate(path)
    else:
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)


def get_db():
    global _firestore_client
    if _firestore_client is None:
        init_firebase()
        db_id = os.environ.get("FIRESTORE_DATABASE_ID")
        if db_id:
            _firestore_client = firestore.client(database_id=db_id)
        else:
            _firestore_client = firestore.client()
    return _firestore_client


@app.before_request
def ensure_csrf_token() -> None:
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)


@app.context_processor
def inject_csrf():
    return {"csrf_token": session.get("csrf_token", "")}


@app.template_filter("room_name")
def room_name_filter(rooms, room_id):
    return bl.room_name_by_id(rooms, room_id or "")


def validate_csrf() -> None:
    if request.form.get("csrf_token") != session.get("csrf_token"):
        abort(403)


def validate_csrf_api() -> None:
    token = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
    if token != session.get("csrf_token"):
        abort(403)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_uid"):
            flash("Please sign in with Google (Firebase).", "error")
            return redirect(url_for("index"))
        return view(*args, **kwargs)

    return wrapped


@app.post("/auth/firebase-session")
def firebase_session():
    """Accept Firebase ID token from firebase-login.js; set or clear Flask session."""
    validate_csrf_api()
    init_firebase()

    payload = request.get_json(silent=True) or {}
    id_token = payload.get("id_token")

    had_server_user = bool(session.get("user_uid"))

    if not id_token:
        session.pop("user_uid", None)
        session.pop("user_email", None)
        return jsonify(reload=had_server_user)

    try:
        decoded = firebase_auth.verify_id_token(id_token)
    except Exception:
        session.pop("user_uid", None)
        session.pop("user_email", None)
        return jsonify(reload=True, error="Invalid or expired token"), 401

    uid = decoded.get("uid")
    email = (decoded.get("email") or "") if isinstance(decoded.get("email"), str) else ""
    if not uid:
        session.pop("user_uid", None)
        session.pop("user_email", None)
        return jsonify(reload=True, error="Missing uid"), 400

    if session.get("user_uid") == uid:
        return jsonify(reload=False)

    session["user_uid"] = uid
    session["user_email"] = email
    return jsonify(reload=True)


@app.get("/")
def index():
    db = get_db()
    rooms = bl.list_rooms_sorted(db)
    user_uid = session.get("user_uid")
    my_bookings = None
    my_room_bookings = None
    if user_uid and request.args.get("show") == "mine":
        my_bookings = bl.list_user_bookings(db, user_uid)
    room_filter = request.args.get("room_filter", "").strip()
    if user_uid and room_filter:
        my_room_bookings = bl.list_user_bookings_for_room(db, user_uid, room_filter)

    today_iso = datetime.date.today().isoformat()
    return render_template(
        "index.html",
        rooms=rooms,
        user_uid=user_uid,
        user_email=session.get("user_email", ""),
        my_bookings=my_bookings,
        my_room_bookings=my_room_bookings,
        room_filter=room_filter,
        today_iso=today_iso,
    )


@app.post("/room/create")
@login_required
def room_create():
    validate_csrf()
    name = request.form.get("room_name", "")
    try:
        bl.create_room(get_db(), session["user_uid"], name)
        flash("Room created.", "success")
    except ValueError as e:
        flash(str(e), "error")
    return redirect(url_for("index"))


@app.post("/room/<room_id>/delete")
@login_required
def room_delete(room_id: str):
    validate_csrf()
    try:
        bl.delete_room(get_db(), room_id, session["user_uid"])
        flash("Room deleted.", "success")
    except (ValueError, PermissionError) as e:
        flash(str(e), "error")
    return redirect(url_for("index"))


@app.post("/booking/create")
@login_required
def booking_create():
    validate_csrf()
    room_id = request.form.get("room_id", "").strip()
    date_iso = request.form.get("date", "").strip()
    start = request.form.get("start_time", "").strip()
    end = request.form.get("end_time", "").strip()
    if not room_id or not date_iso:
        flash("Room and day are required.", "error")
        return redirect(url_for("index"))
    try:
        bl.create_booking(get_db(), session["user_uid"], room_id, date_iso, start, end)
        flash("Booking created.", "success")
    except ValueError as e:
        flash(str(e), "error")
    return redirect(url_for("index"))


@app.post("/booking/<booking_id>/delete")
@login_required
def booking_delete(booking_id: str):
    validate_csrf()
    try:
        bl.delete_booking(get_db(), booking_id, session["user_uid"])
        flash("Booking deleted.", "success")
    except (ValueError, PermissionError) as e:
        flash(str(e), "error")
    return redirect(url_for("index"))


@app.get("/booking/<booking_id>/edit")
@login_required
def booking_edit(booking_id: str):
    db = get_db()
    booking = bl.get_booking(db, booking_id)
    if not booking:
        flash("Booking not found.", "error")
        return redirect(url_for("index"))
    if booking.get("userUid") != session["user_uid"]:
        flash("You can only edit your own bookings.", "error")
        return redirect(url_for("index"))
    rooms = bl.list_rooms_sorted(db)
    return render_template(
        "edit_booking.html",
        booking=booking,
        rooms=rooms,
        start_val=bl.normalize_time_for_input(str(booking.get("startTime") or "")),
        end_val=bl.normalize_time_for_input(str(booking.get("endTime") or "")),
    )


@app.post("/booking/<booking_id>/update")
@login_required
def booking_update(booking_id: str):
    validate_csrf()
    room_id = request.form.get("room_id", "").strip()
    date_iso = request.form.get("date", "").strip()
    start = request.form.get("start_time", "").strip()
    end = request.form.get("end_time", "").strip()
    try:
        bl.update_booking(
            get_db(),
            booking_id,
            session["user_uid"],
            room_id,
            date_iso,
            start,
            end,
        )
        flash("Booking updated.", "success")
    except (ValueError, PermissionError) as e:
        flash(str(e), "error")
        return redirect(url_for("booking_edit", booking_id=booking_id))
    return redirect(url_for("index"))


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)


if __name__ == "__main__":
    main()

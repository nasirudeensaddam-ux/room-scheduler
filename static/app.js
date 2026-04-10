import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, handleAuthState, login, logout } from "/static/firebase-login.js";

const MAX_ROOM_NAME_LENGTH = 120;

const authStatusEl = document.getElementById("auth-status");
const authControlsEl = document.getElementById("auth-controls");
const roomFormEl = document.getElementById("room-form");
const roomNameEl = document.getElementById("room-name");
const roomErrorEl = document.getElementById("room-error");
const roomSuccessEl = document.getElementById("room-success");
const roomsListEl = document.getElementById("rooms-list");
const roomsEmptyEl = document.getElementById("rooms-empty");

const bookingFormEl = document.getElementById("booking-form");
const bookingRoomEl = document.getElementById("booking-room");
const bookingDateEl = document.getElementById("booking-date");
const bookingStartEl = document.getElementById("booking-start");
const bookingEndEl = document.getElementById("booking-end");
const bookingErrorEl = document.getElementById("booking-error");
const bookingSuccessEl = document.getElementById("booking-success");

const allBookingsFormEl = document.getElementById("all-bookings-form");
const myBookingsAllEl = document.getElementById("my-bookings-all");
const myBookingsAllEmptyEl = document.getElementById("my-bookings-all-empty");

const roomBookingsFormEl = document.getElementById("room-bookings-form");
const filterBookingRoomEl = document.getElementById("filter-booking-room");
const myBookingsRoomEl = document.getElementById("my-bookings-room");
const myBookingsRoomEmptyEl = document.getElementById("my-bookings-room-empty");

/** @type {(() => void) | null} */
let unsubMyBookingsAll = null;
/** @type {(() => void) | null} */
let unsubMyBookingsRoom = null;

let currentUser = null;
const roomNameSet = new Set();
/** @type {{ id: string, name: string, normalizedName?: string, ownerUid?: string }[]} */
let cachedRooms = [];

function normalizeRoomName(roomName) {
  return roomName.trim().toLowerCase();
}

function validateRoomName(roomNameRaw) {
  const trimmedName = roomNameRaw.trim();

  if (trimmedName.length === 0) {
    return { ok: false, message: "Room name is required." };
  }

  if (trimmedName.length > MAX_ROOM_NAME_LENGTH) {
    return {
      ok: false,
      message: `Room name must be at most ${MAX_ROOM_NAME_LENGTH} characters.`,
    };
  }

  if (roomNameSet.has(normalizeRoomName(trimmedName))) {
    return { ok: false, message: "A room with this name already exists." };
  }

  return { ok: true, value: trimmedName };
}

function renderAuthControls() {
  authControlsEl.innerHTML = "";
  const button = document.createElement("button");
  if (currentUser) {
    button.type = "button";
    button.textContent = "Logout";
    button.addEventListener("click", async () => {
      await logout();
    });
  } else {
    button.type = "button";
    button.textContent = "Login with Google";
    button.addEventListener("click", async () => {
      await login();
    });
  }

  authControlsEl.append(button);
}

function populateRoomSelects(rooms) {
  const previousBookingRoom = bookingRoomEl.value;
  const previousFilterRoom = filterBookingRoomEl.value;

  bookingRoomEl.innerHTML = '<option value="">Select a room</option>';
  filterBookingRoomEl.innerHTML = '<option value="">Select a room</option>';

  rooms.forEach((r) => {
    const opt1 = document.createElement("option");
    opt1.value = r.id;
    opt1.textContent = r.name;
    bookingRoomEl.append(opt1);

    const opt2 = document.createElement("option");
    opt2.value = r.id;
    opt2.textContent = r.name;
    filterBookingRoomEl.append(opt2);
  });

  if (rooms.some((r) => r.id === previousBookingRoom)) {
    bookingRoomEl.value = previousBookingRoom;
  }
  if (rooms.some((r) => r.id === previousFilterRoom)) {
    filterBookingRoomEl.value = previousFilterRoom;
  }
}

function renderRooms(rooms) {
  roomsListEl.innerHTML = "";
  roomNameSet.clear();
  cachedRooms = rooms;

  rooms.forEach((room) => {
    roomNameSet.add(normalizeRoomName(room.name));

    const listItem = document.createElement("li");
    listItem.textContent = room.name;
    roomsListEl.append(listItem);
  });

  roomsEmptyEl.style.display = rooms.length === 0 ? "block" : "none";
  populateRoomSelects(rooms);
}

function roomNameById(roomId) {
  const found = cachedRooms.find((r) => r.id === roomId);
  return found ? found.name : roomId;
}

function parseTimeToMinutes(timeValue) {
  if (!timeValue || typeof timeValue !== "string") {
    return null;
  }
  const parts = timeValue.trim().split(":");
  if (parts.length < 2) {
    return null;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}


function intervalsOverlapHalfOpen(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

async function createRoom(roomName) {
  if (!currentUser) {
    throw new Error("You must be logged in to create a room.");
  }

  const normalizedName = normalizeRoomName(roomName);
  const duplicateQuery = query(
    collection(db, "rooms"),
    where("normalizedName", "==", normalizedName),
    limit(1)
  );
  const duplicateSnapshot = await getDocs(duplicateQuery);

  if (!duplicateSnapshot.empty) {
    throw new Error("A room with this name already exists.");
  }

  await addDoc(collection(db, "rooms"), {
    name: roomName,
    normalizedName,
    ownerUid: currentUser.uid,
    createdAt: serverTimestamp(),
  });
}

async function getOrCreateDay(roomId, dateIso) {
  const daysRef = collection(db, "days");
  const dayQuery = query(
    daysRef,
    where("roomId", "==", roomId),
    where("dateIso", "==", dateIso),
    limit(1)
  );
  const snapshot = await getDocs(dayQuery);

  if (!snapshot.empty) {
    return snapshot.docs[0].id;
  }

  const createdDay = await addDoc(daysRef, {
    roomId,
    dateIso,
    createdAt: serverTimestamp(),
  });

  return createdDay.id;
}

async function fetchBookingsForRoomAndDay(roomId, dateIso) {
  const bookingsQuery = query(
    collection(db, "bookings"),
    where("roomId", "==", roomId),
    where("dateIso", "==", dateIso)
  );
  const snapshot = await getDocs(bookingsQuery);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function assertNoBookingClash(roomId, dateIso, startTime, endTime) {
  const startM = parseTimeToMinutes(startTime);
  const endM = parseTimeToMinutes(endTime);
  if (startM === null || endM === null) {
    throw new Error("Start and end times must be valid.");
  }
  if (endM <= startM) {
    throw new Error("End time must be after start time.");
  }

  const existing = await fetchBookingsForRoomAndDay(roomId, dateIso);
  for (const b of existing) {
    const bStart = parseTimeToMinutes(String(b.startTime ?? ""));
    const bEnd = parseTimeToMinutes(String(b.endTime ?? ""));
    if (bStart === null || bEnd === null) {
      continue;
    }
    if (intervalsOverlapHalfOpen(startM, endM, bStart, bEnd)) {
      throw new Error("This time overlaps an existing booking for that room.");
    }
  }
}

async function createBooking({ roomId, dateIso, startTime, endTime }) {
  if (!currentUser) {
    throw new Error("You must be logged in to create a booking.");
  }

  await assertNoBookingClash(roomId, dateIso, startTime, endTime);

  const dayId = await getOrCreateDay(roomId, dateIso);

  const bookingRef = await addDoc(collection(db, "bookings"), {
    roomId,
    dayId,
    dateIso,
    startTime,
    endTime,
    userUid: currentUser.uid,
    createdAt: serverTimestamp(),
  });

  return bookingRef.id;
}

function sortBookingsForDisplay(bookings) {
  return [...bookings].sort((a, b) => {
    const dateCmp = String(a.dateIso ?? "").localeCompare(String(b.dateIso ?? ""));
    if (dateCmp !== 0) {
      return dateCmp;
    }
    return String(a.startTime ?? "").localeCompare(String(b.startTime ?? ""));
  });
}

function formatBookingLine(b) {
  const room = roomNameById(b.roomId);
  return `${b.dateIso ?? "?"} · ${room} · ${b.startTime ?? "?"}–${b.endTime ?? "?"}`;
}

function renderBookingsList(listEl, emptyEl, bookings, { showRoomName }) {
  listEl.innerHTML = "";
  if (bookings.length === 0) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  sortBookingsForDisplay(bookings).forEach((b) => {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "booking-meta";
    meta.textContent = showRoomName
      ? formatBookingLine(b)
      : `${b.dateIso ?? "?"} · ${b.startTime ?? "?"}–${b.endTime ?? "?"}`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-booking";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      if (!currentUser) {
        return;
      }
      if (b.userUid && b.userUid !== currentUser.uid) {
        return;
      }
      del.disabled = true;
      try {
        await deleteDoc(doc(db, "bookings", b.id));
      } catch (err) {
        del.disabled = false;
        const code = err && err.code;
        if (code === "permission-denied") {
          alert("Permission denied. Check Firestore rules for booking delete.");
        } else {
          alert(err.message || "Could not delete booking.");
        }
      }
    });

    li.append(meta, del);
    listEl.append(li);
  });
}

function teardownMyBookingsListeners() {
  if (unsubMyBookingsAll) {
    unsubMyBookingsAll();
    unsubMyBookingsAll = null;
  }
  if (unsubMyBookingsRoom) {
    unsubMyBookingsRoom();
    unsubMyBookingsRoom = null;
  }
}

/**
 * Group 2 task 6: form shows all of the current user's bookings (live after first submit).
 */
function startMyBookingsAllListener() {
  if (!currentUser) {
    myBookingsAllEl.innerHTML = "";
    myBookingsAllEmptyEl.textContent = "Sign in to see your bookings.";
    myBookingsAllEmptyEl.style.display = "block";
    return;
  }

  if (unsubMyBookingsAll) {
    unsubMyBookingsAll();
    unsubMyBookingsAll = null;
  }

  const q = query(
    collection(db, "bookings"),
    where("userUid", "==", currentUser.uid)
  );

  unsubMyBookingsAll = onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderBookingsList(myBookingsAllEl, myBookingsAllEmptyEl, items, {
        showRoomName: true,
      });
    },
    (error) => {
      myBookingsAllEl.innerHTML = "";
      myBookingsAllEmptyEl.textContent = firestoreErrorMessage(
        error,
        "Could not load bookings."
      );
      myBookingsAllEmptyEl.style.display = "block";
    }
  );
}

/**
 * Group 2 task 7: form shows current user's bookings for one room (live after submit).
 */
function startMyBookingsRoomListener(roomId) {
  if (!currentUser) {
    myBookingsRoomEl.innerHTML = "";
    myBookingsRoomEmptyEl.textContent = "Sign in to see your bookings.";
    myBookingsRoomEmptyEl.style.display = "block";
    return;
  }

  if (unsubMyBookingsRoom) {
    unsubMyBookingsRoom();
    unsubMyBookingsRoom = null;
  }

  const q = query(
    collection(db, "bookings"),
    where("userUid", "==", currentUser.uid),
    where("roomId", "==", roomId)
  );

  unsubMyBookingsRoom = onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderBookingsList(myBookingsRoomEl, myBookingsRoomEmptyEl, items, {
        showRoomName: false,
      });
    },
    (error) => {
      myBookingsRoomEl.innerHTML = "";
      myBookingsRoomEmptyEl.textContent = firestoreErrorMessage(
        error,
        "Could not load bookings."
      );
      myBookingsRoomEmptyEl.style.display = "block";
    }
  );
}

function setBookingFormDisabled(disabled) {
  Array.from(bookingFormEl.elements).forEach((el) => {
    el.disabled = disabled;
  });
}

function firestoreErrorMessage(error, fallback) {
  const code = error && error.code;
  if (code === "permission-denied") {
    return "Permission denied. Publish Firestore rules (see firestore.rules) and sign in.";
  }
  return error.message || fallback;
}

roomFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  roomErrorEl.textContent = "";
  roomSuccessEl.textContent = "";

  const roomNameRaw = roomNameEl.value;
  const validation = validateRoomName(roomNameRaw);

  if (!validation.ok) {
    roomErrorEl.textContent = validation.message;
    return;
  }

  try {
    await createRoom(validation.value);
    roomNameEl.value = "";
    roomSuccessEl.textContent = "Room created successfully.";
  } catch (error) {
    roomErrorEl.textContent = firestoreErrorMessage(error, "Unable to create room.");
  }
});

bookingFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  bookingErrorEl.textContent = "";
  bookingSuccessEl.textContent = "";

  if (!currentUser) {
    bookingErrorEl.textContent = "You must be logged in to book.";
    return;
  }

  const roomId = bookingRoomEl.value.trim();
  const dateIso = bookingDateEl.value;
  const startTime = bookingStartEl.value;
  const endTime = bookingEndEl.value;

  if (!roomId) {
    bookingErrorEl.textContent = "Select a room.";
    return;
  }
  if (!dateIso) {
    bookingErrorEl.textContent = "Select a day.";
    return;
  }

  try {
    await createBooking({ roomId, dateIso, startTime, endTime });
    bookingSuccessEl.textContent = "Booking created.";
  } catch (error) {
    bookingErrorEl.textContent = firestoreErrorMessage(error, "Unable to create booking.");
  }
});

allBookingsFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  startMyBookingsAllListener();
});

roomBookingsFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const roomId = filterBookingRoomEl.value.trim();
  if (!roomId) {
    myBookingsRoomEmptyEl.textContent = "Select a room.";
    myBookingsRoomEmptyEl.style.display = "block";
    myBookingsRoomEl.innerHTML = "";
    return;
  }
  startMyBookingsRoomListener(roomId);
});

handleAuthState((user) => {
  currentUser = user;
  renderAuthControls();
  setBookingFormDisabled(!user);

  if (currentUser) {
    authStatusEl.textContent = `Logged in as ${currentUser.email || currentUser.uid}`;
  } else {
    authStatusEl.textContent = "You are logged out.";
    teardownMyBookingsListeners();
    myBookingsAllEl.innerHTML = "";
    myBookingsRoomEl.innerHTML = "";
    myBookingsAllEmptyEl.textContent = "Sign in to see your bookings.";
    myBookingsAllEmptyEl.style.display = "block";
    myBookingsRoomEmptyEl.textContent =
      "Choose a room and submit the form to see your bookings there.";
    myBookingsRoomEmptyEl.style.display = "block";
  }
});

const roomsQuery = query(collection(db, "rooms"));
onSnapshot(roomsQuery, (snapshot) => {
  const rooms = snapshot.docs
    .map((item) => ({
      id: item.id,
      ...item.data(),
    }))
    .sort((a, b) => {
      const aName = a.name || "";
      const bName = b.name || "";
      return aName.localeCompare(bName);
    });

  renderRooms(rooms);
});

function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

bookingDateEl.min = localIsoDate(new Date());

window.group1Debug = {
  createBooking,
  createRoom,
  getOrCreateDay,
  toTimestamp(dateString) {
    return Timestamp.fromDate(new Date(dateString));
  },
};

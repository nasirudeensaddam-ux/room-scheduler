import { Timestamp, addDoc, collection, doc, getDocs, limit, onSnapshot, query, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, handleAuthState, login, logout } from "./firebase-login.js";

const MAX_ROOM_NAME_LENGTH = 120;

const authStatusEl = document.getElementById("auth-status");
const authControlsEl = document.getElementById("auth-controls");
const roomFormEl = document.getElementById("room-form");
const roomNameEl = document.getElementById("room-name");
const roomErrorEl = document.getElementById("room-error");
const roomSuccessEl = document.getElementById("room-success");
const roomsListEl = document.getElementById("rooms-list");
const roomsEmptyEl = document.getElementById("rooms-empty");

let currentUser = null;
const roomNameSet = new Set();

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

function renderRooms(rooms) {
  roomsListEl.innerHTML = "";
  roomNameSet.clear();

  rooms.forEach((room) => {
    roomNameSet.add(normalizeRoomName(room.name));

    const listItem = document.createElement("li");
    listItem.textContent = room.name;
    roomsListEl.append(listItem);
  });

  roomsEmptyEl.style.display = rooms.length === 0 ? "block" : "none";
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

async function createBooking({ roomId, dateIso, startTime, endTime }) {
  if (!currentUser) {
    throw new Error("You must be logged in to create a booking.");
  }

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
    roomErrorEl.textContent = error.message || "Unable to create room.";
  }
});

handleAuthState((user) => {
  currentUser = user;
  renderAuthControls();

  if (currentUser) {
    authStatusEl.textContent = `Logged in as ${currentUser.email || currentUser.uid}`;
  } else {
    authStatusEl.textContent = "You are logged out.";
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

window.group1Debug = {
  createBooking,
  createRoom,
  getOrCreateDay,
  // This helper avoids needing Firestore Date transforms when testing.
  toTimestamp(dateString) {
    return Timestamp.fromDate(new Date(dateString));
  },
};

import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.get("/health/healthcheck", (req, res) => {
  res.send("OK");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
  },
});

type Point = {
  x: number;
  y: number;
};

type DrawLine = {
  prevPoint: Point | null;
  currentPoint: Point | null;
  color: string;
  canvasWidth: number;
  canvasHeight: number;
};

type User = {
  id: string;
  name: string;
};

type Dic = {
  [key: string]: Array<User>;
};

const rooms: Dic = {};

io.on("connection", (socket) => {
  socket.on(
    "draw_line",
    (
      { prevPoint, currentPoint, color, canvasWidth, canvasHeight }: DrawLine,
      room: string
    ) => {
      io.to(room).emit("draw_line", {
        prevPoint,
        currentPoint,
        color,
        canvasWidth,
        canvasHeight,
      });
    }
  );

  socket.on("clear", (room) => io.to(room).emit("clear")); // emit to all clients - change to broadcast later for rooms

  socket.on(
    "join_room",
    (room: string, name: string, callback: (success: boolean) => void) => {
      if (!rooms[room]) {
        socket.emit("room_does_not_exist");
        callback(false);
        return;
      }
      socket.join(room);
      rooms[room].push({ id: socket.id, name: name });
      io.to(room).emit("joined_room", room, name);
      console.log("joined room", room);
      callback(true);
    }
  );

  socket.on("room_user_update", (room: string) => {
    io.to(room).emit(
      "users_room_update",
      rooms[room].map((user) => user.name)
    );
  });

  socket.on(
    "create_room",
    (room: string, name: string, callback: (success: boolean) => void) => {
      if (rooms[room]) {
        socket.emit("room_exists");
        callback(false);
        return;
      }
      rooms[room] = [];
      rooms[room].push({ id: socket.id, name: name });
      socket.join(room);
      io.to(room).emit("created_room", room, name);
      callback(true);
    }
  );

  socket.on("leave_room", (room: string, name: string) => {
    if (!rooms[room]) {
      return;
    }
    rooms[room] = rooms[room].filter((user) => user.id !== socket.id);
    socket.leave(room);
    io.to(room).emit("left_room", room, name);
    console.log("left room", room);

    if (rooms[room].length === 0) {
      delete rooms[room];
    }
  });

  socket.on("chat_room", (room: string, message: string, name: string) => {
    socket.to(room).emit("chat_room", message, name);
  });

  /**
   * Does not work well when scaling the canvas to different sizes, cannot do for now
   */

  // socket.on("client_ready", () => {
  //   console.log("client read", socket.id);
  //   socket.broadcast.emit("get_canvas_state");
  // });

  // socket.on("canvas_state", (data: string) => {
  //   socket.broadcast.emit("canvas_state_from_server", data);
  // });

  socket.on("disconnect", () => {
    console.log("user disconnected", socket.id);
    // find user name based on their id
    const room = Object.keys(rooms).find((room) =>
      rooms[room].find((user) => user.id === socket.id)
    );
    if (!room) {
      return;
    }
    const username = rooms[room].find((user) => user.id === socket.id)?.name;

    io.emit("left_room_dc", username);
  });

  console.log("a user connected", socket.id);
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});

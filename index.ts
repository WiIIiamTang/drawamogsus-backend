import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import wordlist from "./fruitsandvegetables.js";
import { stringify } from "querystring";

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
  role?: string | null;
  firstdraw?: boolean;
  hasDrawn?: boolean;
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
    (
      room: string,
      name: string,
      callback: (success: boolean, takenNickname: boolean) => void
    ) => {
      if (!rooms[room]) {
        socket.emit("room_does_not_exist");
        callback(false, false);
        return;
      }
      // check if name is taken
      const takenNickname = rooms[room].find((user) => user.name === name);
      if (takenNickname) {
        callback(false, true);
        return;
      }
      socket.join(room);
      rooms[room].push({ id: socket.id, name: name });
      io.to(room).emit("joined_room", room, name);
      console.log("joined room", room);
      callback(true, false);
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

  socket.on("game_start", (room: string, name: string) => {
    if (!rooms[room]) {
      console.log("room does not exist");
      return;
    }
    // add a role to each user in the room
    const imposterIndex = Math.floor(Math.random() * rooms[room].length);
    // pick a random index to draw first
    const firstDrawIndex = Math.floor(Math.random() * rooms[room].length);
    rooms[room].forEach((user, index) => {
      // pick a random index to be the imposter
      if (index === imposterIndex) {
        user.role = "imposter";
      } else {
        user.role = "artist"; // others are normal
      }

      if (index === firstDrawIndex) {
        user.firstdraw = true;
        user.hasDrawn = true;
      } else {
        user.firstdraw = false;
        user.hasDrawn = false;
      }
    });
    io.to(room).emit("game_start", name);

    // pick a random word from the wordlist
    // this is using a sample wordlist for now
    // need to change to grab from a database or api
    const word = wordlist[Math.floor(Math.random() * wordlist.length)];

    // get the user who is drawing
    const firstdrawer = rooms[room].find((user) => user.firstdraw);

    // assign roles to each user through a private message to each socket in the room
    rooms[room].forEach((user) => {
      io.to(user.id).emit(
        "assign_role",
        user.role,
        user.firstdraw,
        user.role === "artist" ? word : null,
        firstdrawer?.name
      );
    });
  });

  // callback for when drawing is done
  socket.on(
    "done_drawing",
    (
      room: string,
      nickname: string,
      word: string,
      round: number,
      callback: (shouldDrawNext: boolean, round: number) => void
    ) => {
      console.log("server for room:", room, " at round: ", round);
      let newround = round;
      // find a random user who has not drawn yet
      const nextdrawer = rooms[room].find((user) => !user.hasDrawn);
      if (!nextdrawer) {
        // if no one left to draw, increment the round number
        newround++;
        console.log("new round", newround);
        // if round is >= 2, then 2 rounds are complete, so end the game
        if (newround >= 2) {
          // reset hasDrawn, firstDraw for everyone
          rooms[room].forEach((user) => {
            user.hasDrawn = false;
            user.firstdraw = false;
          });
          io.to(room).emit("game_end");
          return;
        }
        // otherwise, reset the hasDrawn flag for everyone
        rooms[room].forEach((user) => (user.hasDrawn = false));
        // and find a new drawer
        const newdrawer = rooms[room].find((user) => !user.hasDrawn);

        if (newdrawer) {
          callback(newdrawer.name === nickname, newround);
          // emit to all other users the new drawer
          socket.to(room).emit("new_drawer", newdrawer.name, newround);
          newdrawer.hasDrawn = true;
        }
      } else {
        // this means the round is not over, since more people need to draw
        callback(nextdrawer.name === nickname, newround);
        // emit to all other users the new drawer
        socket.to(room).emit("new_drawer", nextdrawer.name, newround);
        nextdrawer.hasDrawn = true;
      }
    }
  );

  console.log("a user connected", socket.id);
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});
